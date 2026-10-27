use super::*;
use asterlyn_plugin_dependencies::PluginDependency;

fn package(id: &str) -> PackageIdentity {
    PackageIdentity {
        id: id.into(),
        version: "1.0.0".into(),
        archive_digest: content_digest(id.as_bytes()),
        content_digest: content_digest(b"contents"),
    }
}
struct Fixture {
    nodes: Vec<DependencyNode>,
    packages: Vec<PackageIdentity>,
    key: ModelKey,
    services: Vec<ProvidedService>,
}
impl Fixture {
    fn new() -> Self {
        let packages = vec![package("producer"), package("consumer"), package("second")];
        let nodes = packages
            .iter()
            .map(|package| DependencyNode {
                id: package.id.clone(),
                versions: vec![package.version.clone()],
                enabled: true,
                available: true,
                dependencies: if package.id == "producer" {
                    vec![]
                } else {
                    vec![PluginDependency {
                        id: "producer".into(),
                        minimum: "1.0.0".into(),
                        maximum_exclusive: None,
                    }]
                },
            })
            .collect();
        let key = ModelKey {
            scope: Scope {
                owner: "window".into(),
                activation: 1,
                workspace_digest: content_digest(b"workspace"),
            },
            producer: packages[0].clone(),
            service: "build-model".into(),
            schema: 1,
            build_root_digest: content_digest(b"build-root"),
            input_digest: content_digest(b"inputs"),
            selection_digest: content_digest(b"debug"),
            tool_digest: content_digest(b"tool"),
        };
        let services = vec![ProvidedService {
            producer: packages[0].clone(),
            id: key.service.clone(),
            schema: key.schema,
        }];
        Self {
            nodes,
            packages,
            key,
            services,
        }
    }
    fn authority(&self) -> ModelAuthority<'_> {
        ModelAuthority {
            nodes: &self.nodes,
            packages: &self.packages,
            scope: &self.key.scope,
            services: &self.services,
        }
    }
    fn grant(&self, index: usize) -> ModelGrant {
        ModelGrant::admit(
            &self.authority(),
            self.packages[index].clone(),
            self.key.clone(),
        )
        .unwrap()
    }
}

#[test]
fn consumers_share_a_job_and_last_release_cancels_it() {
    let f = Fixture::new();
    let mut broker = ModelBroker::default();
    let now = Instant::now();
    let first = broker.request(&f.grant(1), &f.authority(), now).unwrap();
    let second = broker.request(&f.grant(2), &f.authority(), now).unwrap();
    let ticket = first.work.unwrap();
    assert!(second.work.is_none());
    assert_eq!(broker.retained_jobs(), 1);
    assert_eq!(broker.release(&first.lease), Ok(None));
    assert!(!ticket.is_cancelled());
    assert_eq!(broker.release(&second.lease), Ok(Some(ticket.generation())));
    assert!(ticket.is_cancelled());
    assert_eq!(
        broker.publish(
            &f.grant(2),
            &f.authority(),
            &ticket,
            content_digest(b"model"),
            5,
            now
        ),
        Err(ModelError::Stale)
    );
}

#[test]
fn exact_references_are_consumer_scope_package_and_schema_bound() {
    let mut f = Fixture::new();
    let mut broker = ModelBroker::default();
    let now = Instant::now();
    let grant = f.grant(1);
    let request = broker.request(&grant, &f.authority(), now).unwrap();
    assert_eq!(
        broker.status(&grant, &f.authority(), &request.lease, now),
        Ok(JobStatus::Running)
    );
    let reference = broker
        .publish(
            &grant,
            &f.authority(),
            request.work.as_ref().unwrap(),
            content_digest(b"model"),
            5,
            now,
        )
        .unwrap();
    assert_eq!(
        broker.resolve(&grant, &f.authority(), &request.lease, &reference, now),
        Ok(())
    );
    let changed = ArtifactRef {
        schema: 2,
        ..reference.clone()
    };
    assert_eq!(
        broker.resolve(&grant, &f.authority(), &request.lease, &changed, now),
        Err(ModelError::ArtifactMismatch)
    );
    assert_eq!(
        broker.resolve(&f.grant(2), &f.authority(), &request.lease, &reference, now),
        Err(ModelError::Stale)
    );
    f.packages[0].content_digest = content_digest(b"tampered-package");
    assert_eq!(
        broker.resolve(&grant, &f.authority(), &request.lease, &reference, now),
        Err(ModelError::Unavailable)
    );
    f.packages[0] = f.key.producer.clone();
    f.key.scope.activation += 1;
    assert_eq!(
        broker.resolve(&grant, &f.authority(), &request.lease, &reference, now),
        Err(ModelError::Unavailable)
    );
}

#[test]
fn changing_inputs_or_selection_revokes_late_completions_and_old_leases() {
    let mut f = Fixture::new();
    let mut broker = ModelBroker::default();
    let now = Instant::now();
    let old_grant = f.grant(1);
    let old = broker.request(&old_grant, &f.authority(), now).unwrap();
    let ticket = old.work.unwrap();
    f.key.selection_digest = content_digest(b"release");
    f.key.input_digest = content_digest(b"new inputs");
    let next = broker.request(&f.grant(1), &f.authority(), now).unwrap();
    assert_eq!(next.retired, vec![ticket.generation()]);
    assert!(ticket.is_cancelled());
    assert!(next.work.is_some());
    assert_eq!(
        broker.publish(
            &old_grant,
            &f.authority(),
            &ticket,
            content_digest(b"late"),
            4,
            now
        ),
        Err(ModelError::Stale)
    );
    assert_eq!(
        broker.status(&old_grant, &f.authority(), &old.lease, now),
        Err(ModelError::Stale)
    );
}

#[test]
fn disabled_or_quarantined_producers_cannot_publish_or_be_consumed() {
    let mut f = Fixture::new();
    let mut broker = ModelBroker::default();
    let now = Instant::now();
    let grant = f.grant(1);
    let request = broker.request(&grant, &f.authority(), now).unwrap();
    f.nodes[0].available = false;
    assert_eq!(
        broker.publish(
            &grant,
            &f.authority(),
            request.work.as_ref().unwrap(),
            content_digest(b"x"),
            1,
            now
        ),
        Err(ModelError::Unavailable)
    );
    f.nodes[0].available = true;
    f.nodes[0].enabled = false;
    assert!(ModelGrant::admit(&f.authority(), f.packages[1].clone(), f.key.clone()).is_err());
    broker.invalidate(|key| key.producer.id == "producer");
    assert!(request.work.as_ref().unwrap().is_cancelled());
    assert_eq!(broker.retained_jobs(), 0);
}

#[test]
fn timeout_failure_and_drop_revoke_writers_without_resurrection() {
    let f = Fixture::new();
    let mut broker = ModelBroker::default();
    let now = Instant::now();
    let grant = f.grant(1);
    let first = broker.request(&grant, &f.authority(), now).unwrap();
    let ticket = first.work.unwrap();
    broker.fail(&ticket).unwrap();
    assert_eq!(
        broker.status(&grant, &f.authority(), &first.lease, now),
        Ok(JobStatus::Failed)
    );
    assert_eq!(
        broker.publish(
            &grant,
            &f.authority(),
            &ticket,
            content_digest(b"x"),
            1,
            now
        ),
        Err(ModelError::Stale)
    );
    broker.release(&first.lease).unwrap();
    let next = broker.request(&grant, &f.authority(), now).unwrap();
    let ticket = next.work.unwrap();
    assert_eq!(
        broker.expire(now + MAX_JOB_DURATION),
        vec![ticket.generation()]
    );
    assert!(ticket.is_cancelled());
    let last = broker
        .request(&grant, &f.authority(), now)
        .unwrap()
        .work
        .unwrap();
    drop(broker);
    assert!(last.is_cancelled());
}

#[test]
fn job_lease_payload_and_aggregate_limits_fail_closed() {
    let f = Fixture::new();
    let grant = f.grant(1);
    let mut broker = ModelBroker::default();
    let now = Instant::now();
    let request = broker.request(&grant, &f.authority(), now).unwrap();
    let ticket = request.work.unwrap();
    assert_eq!(
        broker.publish(
            &grant,
            &f.authority(),
            &ticket,
            content_digest(b"x"),
            MAX_ARTIFACT_BYTES + 1,
            now
        ),
        Err(ModelError::Limit)
    );
    for _ in 1..MAX_LEASES {
        broker.request(&grant, &f.authority(), now).unwrap();
    }
    assert!(matches!(
        broker.request(&grant, &f.authority(), now),
        Err(ModelError::Limit)
    ));
    let mut jobs = ModelBroker::default();
    for i in 0..MAX_JOBS {
        let mut key = f.key.clone();
        key.build_root_digest = content_digest(i.to_string().as_bytes());
        let grant = ModelGrant::admit(&f.authority(), f.packages[1].clone(), key).unwrap();
        let work = jobs
            .request(&grant, &f.authority(), now)
            .unwrap()
            .work
            .unwrap();
        let result = jobs.publish(
            &grant,
            &f.authority(),
            &work,
            content_digest(b"x"),
            MAX_ARTIFACT_BYTES,
            now,
        );
        if i < (MAX_RETAINED_BYTES / MAX_ARTIFACT_BYTES) as usize {
            assert!(result.is_ok());
        } else {
            assert_eq!(result, Err(ModelError::Limit));
        }
    }
    let mut key = f.key.clone();
    key.build_root_digest = content_digest(b"overflow");
    let grant = ModelGrant::admit(&f.authority(), f.packages[1].clone(), key).unwrap();
    assert!(matches!(
        jobs.request(&grant, &f.authority(), now),
        Err(ModelError::Limit)
    ));
}

#[test]
fn arbitrary_packages_services_and_invalid_metadata_never_receive_grants() {
    let mut f = Fixture::new();
    f.nodes[1].dependencies.clear();
    assert!(ModelGrant::admit(&f.authority(), f.packages[1].clone(), f.key.clone()).is_err());
    let mut f = Fixture::new();
    f.key.schema = 2;
    assert!(ModelGrant::admit(&f.authority(), f.packages[1].clone(), f.key.clone()).is_err());
    f.key.schema = 1;
    f.key.input_digest = "../../model.json".into();
    assert!(ModelGrant::admit(&f.authority(), f.packages[1].clone(), f.key.clone()).is_err());
}

#[test]
fn disabling_the_first_consumer_does_not_cancel_a_remaining_consumers_work() {
    let mut f = Fixture::new();
    let now = Instant::now();
    let mut broker = ModelBroker::default();
    let first_grant = f.grant(1);
    let second_grant = f.grant(2);
    let first = broker.request(&first_grant, &f.authority(), now).unwrap();
    let second = broker.request(&second_grant, &f.authority(), now).unwrap();
    let ticket = first.work.unwrap();
    f.nodes[1].enabled = false;
    broker.release(&first.lease).unwrap();
    assert!(!ticket.is_cancelled());
    assert_eq!(
        broker.publish(
            &first_grant,
            &f.authority(),
            &ticket,
            content_digest(b"model"),
            5,
            now
        ),
        Err(ModelError::Unavailable)
    );
    let reference = broker
        .publish(
            &second_grant,
            &f.authority(),
            &ticket,
            content_digest(b"model"),
            5,
            now,
        )
        .unwrap();
    assert_eq!(
        broker.resolve(
            &second_grant,
            &f.authority(),
            &second.lease,
            &reference,
            now
        ),
        Ok(())
    );
}

#[test]
fn a_ready_leased_model_does_not_expire_at_the_execution_deadline() {
    let f = Fixture::new();
    let grant = f.grant(1);
    let mut broker = ModelBroker::default();
    let now = Instant::now();
    let request = broker.request(&grant, &f.authority(), now).unwrap();
    let ticket = request.work.unwrap();
    let reference = broker
        .publish(
            &grant,
            &f.authority(),
            &ticket,
            content_digest(b"model"),
            5,
            now,
        )
        .unwrap();
    let later = now + MAX_JOB_DURATION + Duration::from_secs(1);
    assert!(broker.expire(later).is_empty());
    assert_eq!(
        broker.resolve(&grant, &f.authority(), &request.lease, &reference, later),
        Ok(())
    );
    let same = broker.request(&grant, &f.authority(), later).unwrap();
    assert!(same.work.is_none());
    assert_eq!(same.status, JobStatus::Ready(reference));
}
