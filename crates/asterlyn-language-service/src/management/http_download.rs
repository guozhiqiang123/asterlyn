use super::{
    ManagedArchiveExtraction, ManagedArtifact, ManagedContentInventory, ManagedDownloadPolicy,
    ManagedInstallError, ManagedInstallationContentStore,
};
use reqwest::{
    StatusCode,
    blocking::{Client, ClientBuilder, Response},
    header::{ACCEPT_ENCODING, CONTENT_ENCODING, HeaderValue},
    redirect, tls,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    io,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs},
    sync::{Arc, Mutex},
    time::Duration,
};
use url::Url;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const MAX_RESOLVED_ADDRESSES_PER_HOST: usize = 16;
type ObservedRedirectChain = Arc<Mutex<Vec<Url>>>;

/// Blocking native transport. Callers must run it outside the state-owner and
/// UI threads, and must pass the ticket cancellation/progress closures.
pub fn download_and_stage_managed_archive_blocking(
    store: &mut ManagedInstallationContentStore,
    artifact: &ManagedArtifact,
    extraction: &ManagedArchiveExtraction,
    policy: &ManagedDownloadPolicy,
    mut is_cancelled: impl FnMut() -> bool,
    progress: impl FnMut(u64) -> Result<(), ManagedInstallError>,
) -> Result<ManagedContentInventory, ManagedInstallError> {
    artifact.validate()?;
    extraction.validate()?;
    if is_cancelled() {
        return Err(ManagedInstallError::Cancelled);
    }
    let resolved = resolve_public_policy_hosts(policy, system_resolve)?;
    let (client, observed_chain) = build_client(policy, &resolved)?;
    let mut response = client
        .get(policy.source().clone())
        .header(ACCEPT_ENCODING, HeaderValue::from_static("identity"))
        .send()
        .map_err(|_| ManagedInstallError::StorageFailed)?;
    if is_cancelled() {
        return Err(ManagedInstallError::Cancelled);
    }
    validate_observed_chain(policy, &observed_chain, response.url())?;
    validate_response(&response, extraction.download_bytes, &resolved)?;
    store.stage_archive_stream(artifact, extraction, &mut response, is_cancelled, progress)
}

fn build_client(
    policy: &ManagedDownloadPolicy,
    resolved: &BTreeMap<String, Vec<SocketAddr>>,
) -> Result<(Client, ObservedRedirectChain), ManagedInstallError> {
    let observed_chain = Arc::new(Mutex::new(vec![policy.source().clone()]));
    let redirect_chain = observed_chain.clone();
    let redirect_policy = policy.clone();
    let redirect = redirect::Policy::custom(move |attempt| {
        let mut chain = attempt.previous().to_vec();
        chain.push(attempt.url().clone());
        if redirect_policy.validate_chain(&chain).is_err() {
            return attempt.error(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "managed language download redirect rejected",
            ));
        }
        match redirect_chain.lock() {
            Ok(mut observed) => *observed = chain,
            Err(_) => {
                return attempt.error(io::Error::other(
                    "managed language redirect state unavailable",
                ));
            }
        }
        attempt.follow()
    });
    let mut builder = ClientBuilder::new()
        .https_only(true)
        .min_tls_version(tls::Version::TLS_1_2)
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .redirect(redirect)
        .retry(reqwest::retry::never())
        .referer(false)
        .no_proxy()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .http1_only()
        .pool_max_idle_per_host(0)
        .user_agent(concat!(
            "Asterlyn/",
            env!("CARGO_PKG_VERSION"),
            " managed-language"
        ));
    for (host, addresses) in resolved {
        builder = builder.resolve_to_addrs(host, addresses);
    }
    let client = builder
        .build()
        .map_err(|_| ManagedInstallError::StorageFailed)?;
    Ok((client, observed_chain))
}

fn resolve_public_policy_hosts(
    policy: &ManagedDownloadPolicy,
    mut resolver: impl FnMut(&str, u16) -> Result<Vec<SocketAddr>, ManagedInstallError>,
) -> Result<BTreeMap<String, Vec<SocketAddr>>, ManagedInstallError> {
    let mut resolved: BTreeMap<String, Vec<SocketAddr>> = BTreeMap::new();
    for origin in policy.allowed_origins() {
        let url = Url::parse(origin).map_err(|_| ManagedInstallError::InvalidRequest)?;
        let host = url
            .host_str()
            .ok_or(ManagedInstallError::InvalidRequest)?
            .to_owned();
        let port = url
            .port_or_known_default()
            .ok_or(ManagedInstallError::InvalidRequest)?;
        if let Some(addresses) = resolved.get(&host) {
            if addresses.iter().any(|address| address.port() != port) {
                return Err(ManagedInstallError::InvalidRequest);
            }
            continue;
        }
        let addresses = resolver(&host, port)?;
        if addresses.is_empty() || addresses.len() > MAX_RESOLVED_ADDRESSES_PER_HOST {
            return Err(ManagedInstallError::ResourceLimit);
        }
        let unique: BTreeSet<_> = addresses.into_iter().collect();
        if unique.len() > MAX_RESOLVED_ADDRESSES_PER_HOST
            || unique.iter().any(|address| !public_ip(address.ip()))
        {
            return Err(ManagedInstallError::PermissionDenied);
        }
        resolved.insert(host, unique.into_iter().collect());
    }
    Ok(resolved)
}

fn system_resolve(host: &str, port: u16) -> Result<Vec<SocketAddr>, ManagedInstallError> {
    (host, port)
        .to_socket_addrs()
        .map(|addresses| addresses.collect())
        .map_err(|_| ManagedInstallError::StorageFailed)
}

fn validate_observed_chain(
    policy: &ManagedDownloadPolicy,
    observed: &Mutex<Vec<Url>>,
    final_url: &Url,
) -> Result<(), ManagedInstallError> {
    let chain = observed
        .lock()
        .map_err(|_| ManagedInstallError::StorageFailed)?;
    if chain.last() != Some(final_url) {
        return Err(ManagedInstallError::PermissionDenied);
    }
    policy.validate_chain(&chain)
}

fn validate_response(
    response: &Response,
    expected_bytes: u64,
    resolved: &BTreeMap<String, Vec<SocketAddr>>,
) -> Result<(), ManagedInstallError> {
    let final_host = response
        .url()
        .host_str()
        .ok_or(ManagedInstallError::PermissionDenied)?;
    let encoding = response.headers().get(CONTENT_ENCODING);
    validate_response_metadata(
        response.status(),
        response.content_length(),
        encoding,
        response.remote_addr(),
        final_host,
        expected_bytes,
        resolved,
    )
}

fn validate_response_metadata(
    status: StatusCode,
    content_length: Option<u64>,
    content_encoding: Option<&HeaderValue>,
    remote_address: Option<SocketAddr>,
    final_host: &str,
    expected_bytes: u64,
    resolved: &BTreeMap<String, Vec<SocketAddr>>,
) -> Result<(), ManagedInstallError> {
    if status != StatusCode::OK
        || content_length != Some(expected_bytes)
        || content_encoding.is_some_and(|value| value != HeaderValue::from_static("identity"))
    {
        return Err(ManagedInstallError::IntegrityMismatch);
    }
    let remote = remote_address.ok_or(ManagedInstallError::PermissionDenied)?;
    let final_addresses = resolved
        .get(final_host)
        .ok_or(ManagedInstallError::PermissionDenied)?;
    if !public_ip(remote.ip())
        || !final_addresses
            .iter()
            .any(|address| address.ip() == remote.ip())
    {
        return Err(ManagedInstallError::PermissionDenied);
    }
    Ok(())
}

fn public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => public_ipv4(address),
        IpAddr::V6(address) => public_ipv6(address),
    }
}

fn public_ipv4(address: Ipv4Addr) -> bool {
    let [a, b, c, _] = address.octets();
    !(a == 0
        || a == 10
        || a == 100 && (64..=127).contains(&b)
        || a == 127
        || a == 169 && b == 254
        || a == 172 && (16..=31).contains(&b)
        || a == 192 && b == 0 && c == 0
        || a == 192 && b == 0 && c == 2
        || a == 192 && b == 168
        || a == 198 && (b == 18 || b == 19)
        || a == 198 && b == 51 && c == 100
        || a == 203 && b == 0 && c == 113
        || a >= 224)
}

fn public_ipv6(address: Ipv6Addr) -> bool {
    if let Some(embedded) = address.to_ipv4() {
        return public_ipv4(embedded);
    }
    let segments = address.segments();
    !(address.is_unspecified()
        || address.is_loopback()
        || address.is_multicast()
        || segments[0] & 0xfe00 == 0xfc00
        || segments[0] & 0xffc0 == 0xfe80
        || segments[0] & 0xffc0 == 0xfec0
        || segments[0] == 0x2001 && segments[1] == 0x0db8)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> ManagedDownloadPolicy {
        ManagedDownloadPolicy::new(
            "https://downloads.example.com/server.gz",
            &["https://cdn.example.com".into()],
        )
        .unwrap()
    }

    #[test]
    fn resolver_pins_every_allowed_host_and_rejects_private_or_unbounded_answers() {
        let resolved = resolve_public_policy_hosts(&policy(), |host, port| {
            let ip = if host == "downloads.example.com" {
                [93, 184, 216, 34]
            } else {
                [104, 16, 1, 2]
            };
            Ok(vec![SocketAddr::from((ip, port))])
        })
        .unwrap();
        assert_eq!(resolved.len(), 2);
        assert!(
            resolved
                .values()
                .flatten()
                .all(|address| address.port() == 443)
        );

        assert_eq!(
            resolve_public_policy_hosts(&policy(), |_, port| {
                Ok(vec![SocketAddr::from(([127, 0, 0, 1], port))])
            }),
            Err(ManagedInstallError::PermissionDenied)
        );
        assert_eq!(
            resolve_public_policy_hosts(&policy(), |_, port| {
                Ok((0..=MAX_RESOLVED_ADDRESSES_PER_HOST)
                    .map(|last| SocketAddr::from(([8, 8, 8, last as u8], port)))
                    .collect())
            }),
            Err(ManagedInstallError::ResourceLimit)
        );

        let multiple_ports = ManagedDownloadPolicy::new(
            "https://downloads.example.com/server.gz",
            &["https://downloads.example.com:8443".into()],
        )
        .unwrap();
        assert_eq!(
            resolve_public_policy_hosts(&multiple_ports, |_, port| {
                Ok(vec![SocketAddr::from(([93, 184, 216, 34], port))])
            }),
            Err(ManagedInstallError::InvalidRequest)
        );
    }

    #[test]
    fn public_address_filter_rejects_special_ipv4_and_ipv6_ranges() {
        for address in [
            "0.0.0.1",
            "10.0.0.1",
            "100.64.0.1",
            "127.0.0.1",
            "169.254.1.1",
            "172.16.0.1",
            "192.168.0.1",
            "198.18.0.1",
            "192.0.2.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "::1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
            "::127.0.0.1",
            "::ffff:127.0.0.1",
        ] {
            assert!(!public_ip(address.parse().unwrap()), "{address}");
        }
        for address in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(public_ip(address.parse().unwrap()), "{address}");
        }
    }

    #[test]
    fn response_requires_exact_identity_encoding_length_and_pinned_public_peer() {
        let peer = SocketAddr::from(([93, 184, 216, 34], 443));
        let other_peer = SocketAddr::from(([104, 16, 1, 2], 443));
        let resolved = BTreeMap::from([
            ("cdn.example.com".into(), vec![other_peer]),
            ("downloads.example.com".into(), vec![peer]),
        ]);
        assert_eq!(
            validate_response_metadata(
                StatusCode::OK,
                Some(10),
                None,
                Some(peer),
                "downloads.example.com",
                10,
                &resolved,
            ),
            Ok(())
        );
        for (status, length, encoding, remote) in [
            (StatusCode::PARTIAL_CONTENT, Some(10), None, Some(peer)),
            (StatusCode::OK, Some(9), None, Some(peer)),
            (
                StatusCode::OK,
                Some(10),
                Some(HeaderValue::from_static("gzip")),
                Some(peer),
            ),
            (
                StatusCode::OK,
                Some(10),
                None,
                Some(SocketAddr::from(([127, 0, 0, 1], 443))),
            ),
        ] {
            assert!(
                validate_response_metadata(
                    status,
                    length,
                    encoding.as_ref(),
                    remote,
                    "downloads.example.com",
                    10,
                    &resolved
                )
                .is_err()
            );
        }
        assert_eq!(
            validate_response_metadata(
                StatusCode::OK,
                Some(10),
                None,
                Some(other_peer),
                "downloads.example.com",
                10,
                &resolved,
            ),
            Err(ManagedInstallError::PermissionDenied)
        );
    }
}
