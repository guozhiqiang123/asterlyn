//! Metadata-only measurement; this does not simulate Gradle or payload storage.
use asterlyn_plugin_dependencies::{DependencyNode, PluginDependency};
use asterlyn_plugin_models::*;
use std::time::Instant;

fn main() {
    let package = |id: &str| PackageIdentity {
        id: id.into(),
        version: "1.0.0".into(),
        archive_digest: content_digest(id.as_bytes()),
        content_digest: content_digest(b"contents"),
    };
    let producer = package("producer");
    let consumer = package("consumer");
    let packages = vec![producer.clone(), consumer.clone()];
    let nodes = vec![
        DependencyNode {
            id: producer.id.clone(),
            versions: vec![producer.version.clone()],
            enabled: true,
            available: true,
            dependencies: vec![],
        },
        DependencyNode {
            id: consumer.id.clone(),
            versions: vec![consumer.version.clone()],
            enabled: true,
            available: true,
            dependencies: vec![PluginDependency {
                id: producer.id.clone(),
                minimum: "1.0.0".into(),
                maximum_exclusive: None,
            }],
        },
    ];
    let scope = Scope {
        owner: "window".into(),
        activation: 1,
        workspace_digest: content_digest(b"workspace"),
    };
    let services = vec![ProvidedService {
        producer: producer.clone(),
        id: "model".into(),
        schema: 1,
    }];
    let authority = ModelAuthority {
        nodes: &nodes,
        packages: &packages,
        scope: &scope,
        services: &services,
    };
    let key = ModelKey {
        scope: scope.clone(),
        producer,
        service: "model".into(),
        schema: 1,
        build_root_digest: content_digest(b"build"),
        input_digest: content_digest(b"inputs"),
        selection_digest: content_digest(b"debug"),
        tool_digest: content_digest(b"tool"),
    };
    let grant = ModelGrant::admit(&authority, consumer, key).unwrap();
    let mut broker = ModelBroker::default();
    let started = Instant::now();
    for _ in 0..10_000 {
        let now = Instant::now();
        let request = broker.request(&grant, &authority, now).unwrap();
        let joined = broker.request(&grant, &authority, now).unwrap();
        let reference = broker
            .publish(
                &grant,
                &authority,
                request.work.as_ref().unwrap(),
                content_digest(b"model"),
                5,
                now,
            )
            .unwrap();
        broker
            .resolve(&grant, &authority, &joined.lease, &reference, now)
            .unwrap();
        broker.release(&request.lease).unwrap();
        broker.release(&joined.lease).unwrap();
    }
    println!(
        "iterations=10000 elapsedUs={} retainedJobs={} metadataOnly=true",
        started.elapsed().as_micros(),
        broker.retained_jobs()
    );
}
