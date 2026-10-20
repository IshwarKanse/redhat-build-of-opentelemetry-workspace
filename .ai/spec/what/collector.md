# Collector

The OpenTelemetry Collector is a vendor-agnostic telemetry pipeline that receives, processes, and exports traces, metrics, and logs. The Red Hat distribution includes a curated subset of upstream components selected via a declarative manifest. Each component has an explicit support level: GA, TP, or not supported (present in source but undocumented).

## Behavioral Rules

### Pipeline Architecture

1. A collector pipeline flows: Receivers → Processors → Exporters.
2. Connectors bridge two pipelines, acting as both exporter (from source pipeline) and receiver (to destination pipeline).
3. Extensions provide non-pipeline capabilities (health checks, authentication, storage).
4. The Service section of the config defines which pipelines exist and which components they use.

### Component Selection (Red Hat Distro)

5. The Red Hat distro selects components from upstream core and contrib via `manifest.yaml` in `redhat-opentelemetry-collector`.
6. The OpenTelemetry Collector Builder (OCB) generates Go source from `manifest.yaml` and compiles the binary.
7. Generated source is committed to `_build/` so downstream Konflux builds can compile from pre-generated sources.

### Receivers

The distro includes 15 receivers in source. Support levels per documentation:

| Receiver | Support Level | Notes |
|---|---|---|
| OTLP | **GA** | |
| Jaeger | **GA** | |
| Host Metrics | **GA** | |
| Prometheus | **GA** | |
| Zipkin | **GA** | |
| Kafka | **GA** | Promoted from TP in 3.10.0 |
| Filelog | **GA** | |
| Kubernetes Events | **GA** | Promoted from TP in 3.9.0 |
| Kubernetes Objects | **GA** | Promoted from TP in 3.10.0 |
| Kubelet Stats | **GA** | |
| Prometheus Remote Write | **TP** | |
| OTLP JSON File | **TP** | |
| Journald | **TP** | |
| Kubernetes Cluster | **TP** | |
| OBI | **TP** | Added in 3.11.0. eBPF-based zero-code instrumentation. See `what/obi.md`. |

### Exporters

The distro includes 12 exporters in source. Support levels per documentation:

| Exporter | Support Level | Notes |
|---|---|---|
| OTLP gRPC | **GA** | Name `otlp` deprecated in 3.9.0 in favor of `otlp_grpc` |
| OTLP HTTP | **GA** | Name `otlphttp` deprecated in 3.9.0 in favor of `otlp_http` |
| Debug | **GA** | |
| Prometheus | **GA** | Promoted from TP in 3.9.0 |
| Prometheus Remote Write | **GA** | Promoted from TP in 3.9.0/3.10.0 |
| Kafka | **GA** | |
| Load Balancing | **TP** | |
| AWS CloudWatch Logs | **TP** | |
| AWS EMF | **TP** | |
| AWS X-Ray | **TP** | |
| File | **TP** | |
| Google Cloud | **TP** | Deprecated in 3.11.0; use OTLP HTTP Exporter + Google Client Auth Extension instead |

### Processors

The distro includes 14 processors in source. Support levels per documentation:

| Processor | Support Level | Notes |
|---|---|---|
| Batch | **GA** | |
| Memory Limiter | **GA** | |
| Attributes | **GA** | |
| Resource | **GA** | |
| Kubernetes Attributes | **GA** | |
| Filter | **GA** | Promoted from TP in 3.9.0 |
| Transform | **GA** | Promoted from TP in 3.9.0 |
| Tail Sampling | **GA** | Promoted from TP in 3.10.0 |
| Probabilistic Sampling | **GA** | Promoted from TP in 3.10.0 |
| Metric Start Time | **GA** | Introduced in 3.9.0 |
| Resource Detection | **TP** | |
| Span | **TP** | |
| Cumulative-to-Delta | **TP** | |
| Group-by-Attributes | **TP** | |

### Connectors

The distro includes 4 connectors in source. Support levels per documentation:

| Connector | Support Level | Notes |
|---|---|---|
| Span Metrics | **GA** | |
| Count | **TP** | |
| Routing | **TP** | |
| Forward | **TP** | |

### Extensions

The distro includes 10 extensions in source. Support levels per documentation:

| Extension | Support Level | Notes |
|---|---|---|
| Bearer Token Auth | **GA** | |
| Google Client Auth | **GA** | |
| OAuth2 Client | **TP** | |
| File Storage | **TP** | |
| OIDC Auth | **TP** | |
| Jaeger Remote Sampling | **TP** | |
| Performance Profiler (pprof) | **TP** | |
| Health Check | **TP** | |
| zPages | **TP** | |
| Memory Limiter (extension) | **Not supported** | Present in source but not documented |

### Configuration

8. In the v1beta1 API, collector config is a structured object with typed fields for receivers, exporters, processors, connectors, extensions, and service.
9. In the deprecated v1alpha1 API, collector config is a raw YAML string.

### Receiving OpenShift Platform Metrics

Two options export the OpenShift platform metrics to the collector; design in `docs/superpowers/specs/2026-10-18-ocp-monitoring-metrics-export-design.md`, PoC assets in github.com/IshwarKanse/demo `otel-ocp-metrics-export`.

#### Option 1: remote write v2 from the monitoring stack

The in-cluster (platform) and user workload monitoring (UWM) Prometheus instances export their metrics to the collector with Prometheus remote write v2; the collector forwards them to any backend (OTLP, vendor exporters). Verified on OpenShift 5.0 (TRACING-6909); design in `docs/superpowers/specs/2026-10-18-ocp-monitoring-metrics-export-design.md`; PoC manifests and the sizing benchmark harness in github.com/IshwarKanse/demo `otel-ocp-metrics-export`.

10. The monitoring side is configured only through the Cluster Monitoring Operator config maps: `cluster-monitoring-config` (`prometheusK8s.remoteWrite`) and `user-workload-monitoring-config` (`prometheus.remoteWrite`) with `messageVersion: V2.0`. `messageVersion` exists since OpenShift 5.0; on earlier versions only the federation endpoint (Prometheus receiver) is available.
11. The collector side uses the `prometheus_remote_write` receiver (TP; `prometheusremotewrite` is a deprecated alias). The receiver accepts only the v2 message. The receiver port must be listed in `spec.ports` of the `OpenTelemetryCollector` CR because the operator does not infer it.
12. Until MON-4412 lands, CMO does not expose `metadata-wal-records`, `scrapeNativeHistograms` and `convertClassicHistogramsToNHCB`: all series arrive with an unspecified type and are emitted as untyped gauges (counters, classic histogram `_bucket`/`_sum`/`_count` and summary quantiles included); native histograms are not exported. No series is dropped.
13. Both replicas of each Prometheus instance send every sample; they differ only in the `prometheus_replica` label. Deduplication is the backend's job.
14. Documented resilience settings for the exporter: `retry_on_failure.max_elapsed_time: 0`, `sending_queue.sizer: items` with a bounded `queue_size`, `block_on_overflow: true` and exporter-side `sending_queue.batch` instead of the batch processor, plus the `memory_limiter` processor. With the defaults a 5 minute backend outage OOM-killed the collector and dropped batches; with these settings back-pressure reaches Prometheus, which retries from its WAL, and no sample is lost.
15. No additional collector component is needed: the receiver, the OTLP exporters, `memory_limiter`, `filter`, `resource` and `transform` are in the 0.158 distro manifest.
16. AWS CloudWatch is a validated third-party backend for this flow through the AWS EMF exporter (`awsemf`, TP); the receiver maps the Prometheus `job`/`instance` labels to the `service.name`/`service.instance.id` resource attributes, which become CloudWatch dimensions. The `awsemf` exporter has no `sending_queue`/`retry_on_failure` settings (it retries itself through `max_retries`).
17. Sizing (product collector 0.158.0, OpenShift 5.0): about 1 CPU core per 100,000 samples/s and under 250 MiB in steady state per replica; documented requests 500m / 512Mi and limits 2 CPU / 2Gi (the limits absorb the recovery burst after a backend outage); one replica up to 95,000 samples/s (measured 2026-10-20: 1.06 cores at 96,000 samples/s), add replicas beyond that; the docs present the figures as a table by remote write rate.

#### Option 2: collector-only collection without the monitoring stack

The collector and the operator collect the platform metrics without any component of `openshift-monitoring` (TRACING-6910; OBSDA-863 "the monitoring system might be optional", TRACING-5052). Works on every supported OpenShift version. Verified on OpenShift 5.0 (upstream operator, product collector image) and 4.22 (GA operator 0.158.0-3).

18. Two collectors: a DaemonSet with the `host_metrics` receiver (GA; `root_path: /hostfs`, host filesystem mounted read-only) and the `kubelet_stats` receiver (GA), and a Deployment with the `k8s_cluster` receiver (TP, `distribution: openshift`) and the `prometheus` receiver (GA). `hostmetrics`, `kubeletstats` and `resourcedetection` are deprecated aliases of `host_metrics`, `kubelet_stats` and `resource_detection` in collector 0.158.
19. The kubelet is reached through the API server node proxy: `kubelet_stats` with `auth_type: kubeConfig` and `endpoint: ${env:K8S_NODE_NAME}` (in-cluster configuration, TLS verified with the service account `ca.crt`), `prometheus` receiver jobs with `__metrics_path__` `/api/v1/nodes/<node>/proxy/metrics[/cadvisor|/resource|/probes]`. No kubelet CA copy (the `kubelet-serving-ca` config map is namespaced and rotates) and no `insecure_skip_verify`. RBAC: `nodes/proxy`, `nodes/stats`, `nodes/metrics` get.
20. The control plane and operator `/metrics` endpoints are scraped with the collector service account token: ClusterRole with `nonResourceURLs: ["/metrics", "/metrics/resources"]`, `namespace/metrics` get (machine-config and machine-api kube-rbac-proxy), `route.openshift.io routers/metrics`, `image.openshift.io registry/metrics`, `operator.openshift.io dnses`, plus `services`, `endpoints`, `pods`, `namespaces`, `nodes`, `endpointslices` list/watch for the discovery. The kube-apiserver is scraped through the `kubernetes` endpoint in `default` with the kube root CA (`server_name: kubernetes`) and the CMO drop list; every other endpoint with the service CA from the `openshift-service-ca.crt` config map. One job per endpoint family because the service CA certificates carry only `<svc>.<ns>.svc` and `tls_config.server_name` is per job. These jobs are best effort: the component owners can restrict the endpoints (NetworkPolicy, authentication, certificate) in any release, so the docs recommend remote write v2 from CMO or COO for the control plane metrics where available and position option 2 for the node, kubelet and cAdvisor metrics, OpenShift 4.x, typed metrics and metrics outside the active collection profile.
21. Node collector SCC: unprivileged (hostPath read-only, no privileged container, no host PID or network, all capabilities dropped) with `runAsUser: 0` and SELinux `spc_t`; every `host_metrics` scraper works, the filesystem scraper included.
22. Scale-out of the cluster collector: `mode: statefulset`, target allocator with `prometheusCR.enabled: false` (shards the `kubernetes_sd` jobs without ServiceMonitor CRDs; needs its own service account and ClusterRole for the discovery) and the `k8s_leader_elector` extension (TP) for `k8s_cluster`. `spec.observability.metrics.enableMetrics` stays false because it creates Prometheus Operator ServiceMonitors.
23. Not collected without the stack: etcd (client certificate only, by decision); cluster-version-operator, node-tuning-operator, cluster-samples-operator, marketplace-operator, the CSI controller kube-rbac-proxy, openshift-apiserver check-endpoints and, on 4.22, network-check-source (client certificate only or certificate for localhost); dns-default, dns-operator and ingress-operator (NetworkPolicy admits only the `openshift-monitoring` namespace); kube-state-metrics and openshift-state-metrics names, recording and alerting rules, Alertmanager, console Observe pages, metrics-server (`metrics.k8s.io`, HPA, `oc adm top`), Telemeter. Custom resource metrics (kube-state-metrics reports VerticalPodAutoscaler, Gateway and GatewayClass for CMO; `k8s_cluster` cannot report custom resources, open-telemetry/opentelemetry-collector-contrib#50196). Hosted control planes have no in-cluster scheduler, controller-manager, machine-config daemon or OVN control plane to scrape.
24. The exporter keeps the resilient settings of rule 14; the difference is that pull receivers have no upstream WAL: when the bounded queue is full, scrapes are skipped and their samples are gone. The `file_storage` extension persists the queue.
25. Sizing (product collector 0.158.0, OpenShift 5.0, measured up to 1,471 pods on 7 nodes): node collector 5 millicores and about 75 MiB working set per node at 250 pods per node (documented 50m / 192Mi requests, 500m / 512Mi limits); cluster collector in the documented shape (k8s_cluster plus the control plane and operator jobs) 0.05 cores and about 630 MiB at 1,461 pods; with the optional kubelet and cAdvisor node-proxy jobs about 550 MiB plus 1.3 GiB and 0.12 cores per 1,000 pods (2.5 GiB at 1,471 pods), CPU proportional to the scrape rate. Documented requests 500m / 1Gi and limits 2 CPU / 4Gi cover the documented shape up to at least 1,500 pods and the kubelet jobs up to about 1,000 pods; beyond that 6Gi (an outage drain at 1,461 pods peaked at 3.2 GiB, 3.9 GiB with `file_storage`), fewer jobs or the scale-out variant. The item-sized `sending_queue` must exceed the largest single scrape (200,000 items for the cluster collector, 50,000 for the node collector), or the exporter rejects it with `element size too large`; 200,000 items hold about 50 s of scrapes at 1,471 pods with the kubelet jobs and about 80 s without.
26. No additional product component is needed; the feature parity table is in `FEATURE-PARITY.md` of the demo repository directory `otel-ocp-metrics-export/collector-only`.

## Summary

| Category | GA | TP | Not Supported |
|---|---|---|---|
| Receivers | 10 | 5 | 0 |
| Exporters | 6 | 6 | 0 |
| Processors | 10 | 4 | 0 |
| Connectors | 1 | 3 | 0 |
| Extensions | 2 | 7 | 1 |
| **Total** | **29** | **25** | **1** |

## Configuration Surface

| Field | Type | Default | Description |
|---|---|---|---|
| spec.config.receivers | map | — | Receiver configurations keyed by name |
| spec.config.processors | map | — | Processor configurations keyed by name |
| spec.config.exporters | map | — | Exporter configurations keyed by name |
| spec.config.connectors | map | — | Connector configurations keyed by name |
| spec.config.extensions | map | — | Extension configurations keyed by name |
| spec.config.service.pipelines | map | — | Pipeline definitions mapping signal types to component names |
| spec.config.service.extensions | list | — | Extensions to enable |

### Planned Components

| Component | Type | Support Level | Ticket |
|---|---|---|---|
| Signature Validation | Processor | **[PLANNED: TRACING-6499]** TP | Validates non-repudiation signatures on incoming spans. See `what/signing.md`. |
| Log Deduplication | Processor | **[PLANNED: TRACING-6697]** TP | Aggregates identical logs over a time interval. See `what/collector-3.12-components.md`. |
| Syslog | Exporter | **[PLANNED: TRACING-6788]** TP | Exports logs via syslog protocol (RFC 5424/3164). See `what/collector-3.12-components.md`. |
| Webhook Event | Receiver | **[PLANNED: TRACING-6641]** TP | Receives logs over HTTP webhooks. New in 3.12: it is not in any 3.11 build (`manifest.yaml`, release notes and docs have no entry). See `what/collector-3.12-components.md`. |

### Excluded Components (Evaluated and Rejected)

| Component | Type | Reason | Ticket |
|---|---|---|---|
| Logs Transform | Processor | Upstream stability `development` (lowest tier). Explicitly slated for deprecation (#19775). Not in any upstream distribution. Use the Transform Processor (GA) + OTTL instead. | TRACING-6698 (cancelled) |

## Constraints

1. Adding or removing a component from the Red Hat distro requires updating `manifest.yaml` in `redhat-opentelemetry-collector` and regenerating `_build/`.
2. Each component has independent stability levels per signal (e.g., a receiver can be Stable for traces but Alpha for metrics).
3. The collector binary exposes OTLP gRPC on port 4317 by default.
4. The OpenCensus Receiver was removed in version 3.9.0.
