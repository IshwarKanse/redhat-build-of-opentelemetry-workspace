# Exporting OpenShift Platform Metrics to the OpenTelemetry Collector

**Date:** 2026-10-18 (option 1), 2026-10-19 (option 2)
**Ticket:** TRACING-4524 (epic); option 1: TRACING-6909 (PoC), TRACING-6789 (docs), TRACING-6790 (e2e), MON-4412 (monitoring stack); option 2: TRACING-6910 (PoC), TRACING-6912 (docs), TRACING-6911 (e2e), TRACING-5052 (customer request)
**Status:** Design, both options verified by a PoC on OpenShift 5.0.0-0.nightly-2026-10-16-110515

Two options export the OpenShift platform metrics to the Red Hat build of OpenTelemetry collector and from there to any backend:

| | Option 1: remote write v2 from the monitoring stack | Option 2: collector-only, no monitoring stack |
|---|---|---|
| Source | The platform and user workload Prometheus instances of the Cluster Monitoring Operator (CMO) | The kubelet, the host filesystem, the Kubernetes API and the platform `/metrics` endpoints, read directly by the collector |
| OpenShift | 5.0 or later (`remoteWrite[].messageVersion`) | any supported version (4.x and 5.0) |
| Metric names | The Prometheus names of the stack (`node_cpu_seconds_total`, `kube_pod_status_phase`, recording rules) | OpenTelemetry semantic names for node, pod, container and cluster state (`system.cpu.time`, `k8s.pod.phase`); the Prometheus names of the control plane and operator endpoints |
| Metric types today | All untyped until MON-4412 | Typed (sums, histograms, summaries) |
| Needs the monitoring stack | Yes (Prometheus, node-exporter, kube-state-metrics, ServiceMonitors) | No; nothing in `openshift-monitoring` is read, copied or modified |
| Use when | The stack exists and the backend needs the Prometheus names, recording rules or every platform series | Typed metrics today, OpenShift 4.x, the node, kubelet and cAdvisor metrics with OpenTelemetry names, or metrics outside the active collection profile of the stack; the control plane and operator endpoints are best effort from outside `openshift-monitoring` (prefer remote write v2 for them where available); both options can run side by side |

## Option 1: Prometheus remote write v2 from the monitoring stack

### Summary

Customers want the in-cluster (platform) and user workload monitoring (UWM) metrics of OpenShift exported to OTLP-native backends (Dynatrace, Google Cloud Monitoring, ...). The supported path is:

```
CMO Prometheus (platform, UWM)  --remote write v2-->  OpenTelemetry collector  --OTLP / vendor exporter-->  backend
   cluster-monitoring-config /                        prometheus_remote_write receiver
   user-workload-monitoring-config                    (Red Hat build of OpenTelemetry)
   remoteWrite[].messageVersion: V2.0
```

Only supported configuration is used: the Cluster Monitoring Operator (CMO) config maps on the monitoring side and the `OpenTelemetryCollector` CR on the collector side. The 2025 PoC that relayed the platform metrics through a COO `MonitoringStack` is obsolete.

### Decisions

| Decision | Rationale |
|---|---|
| Remote write v2 only, no federation, no COO relay | The `prometheus_remote_write` receiver accepts only the v2 message; CMO exposes `messageVersion` since OpenShift 5.0 (MON-4390). Federation stays documented for OpenShift < 5.0. |
| No new collector component | `prometheusremotewritereceiver`, `otlp`/`otlphttp` exporters, `memory_limiter`, `filter`/`resource`/`transform` processors are all in the 0.158 distro manifest. |
| Collector CR must set the receiver port in `spec.ports` and a contrib/product image | The operator does not infer the receiver port; the operator default (core) image lacks the receiver. |
| Resilient exporter settings are part of the documented configuration | With the defaults (`sending_queue` of 5000 requests, `retry_on_failure.max_elapsed_time` 5m, batch processor) a 5 minute backend outage OOM-killed the collector 4 times and dropped batches. With `retry_on_failure.max_elapsed_time: 0`, `sending_queue.sizer: items`, a bounded `queue_size`, `block_on_overflow: true` and exporter-side `sending_queue.batch`, back-pressure reaches the receiver; Prometheus retries from its WAL and no sample is lost. |
| E2e tests in `distributed-tracing-qe/tests/e2e-otel/prometheusremotewritereceiver-cluster-monitoring` (Prometheus exporter check) and `awsemfexporter-cluster-monitoring` (AWS CloudWatch via the AWS EMF exporter) | Product suite, next to the existing collector-to-collector receiver test; `concurrent: false`; the shared CMO config maps are saved before the test and restored in `catch`/`finally`; only `prometheus_remote_storage_samples_failed_total` is asserted (`_dropped_total` counts the samples removed by `writeRelabelConfigs`). They fail early on OpenShift < 5.0: the upstream 4.x jobs in `openshift/release` skip the first one (openshift/release#87266), the AWS one matches the existing `*aws*` pattern, and the Konflux integration tests run the `rhosdt-0.158` branch and do not pick them up. AWS CloudWatch is the validated third-party backend; Amazon Managed Prometheus would need the `sigv4auth` extension, which the distro does not ship. |
| Sizing recommendation per collector replica (product collector 0.158.0, benchmark harness and results in github.com/IshwarKanse/demo `otel-ocp-metrics-export`) | About 1 CPU core per 100,000 samples/s in steady state, memory under 250 MiB in steady state; requests 500m / 512Mi, limits 2 CPU / 2Gi (used while catching up after a backend outage: a 5 minute backlog at 47k samples/s drained in 203 s at the 2-core limit with the working set peaking at 1.97 GiB under the `memory_limiter`, no loss). One replica handles 95,000 samples/s (extended run of 2026-10-20 on a cluster with 4 workers of 15.5 CPU: 1.06 cores at 96,000 samples/s, working set 98 to 151 MiB between 28,000 and 96,000 samples/s, two replicas at 62,000 samples/s used 0.70 cores and 231 MiB together, a 5 minute outage at 40,000 samples/s drained in 245 s with a 2 GiB working-set peak); replicas share the Prometheus shards evenly. The docs carry the figures as a resource table by remote write rate. |
| PoC and benchmark assets live in the team-readable demo repository github.com/IshwarKanse/demo, directory `otel-ocp-metrics-export` | `poc/`: the manifests used for the PoC (namespace, vendor stand-in Prometheus with the OTLP receiver, collector CR, CMO and UWM config maps, sample app with every metric type, debug collector for the type check, product-image validation CR, avalanche load generator). `manifests/`, `scripts/`, `results/`: the sizing benchmark (OTLP sink collector, collector under test with the recommended configuration, load tiers, outage test, measured numbers). The 2025 COO-relay manifests in `openshift-observability-manifests` are superseded and not updated. |
| Docs: new module for remote write, federate module kept for OpenShift < 5.0 | Customer-likely configuration only (CMO snippets, collector CR, resilience settings, replica duplication, type limitation, sizing). |
| Epic TRACING-4524 stays focused on the remote write v2 path | The epic description holds only problem, goal, scope, acceptance criteria, dependencies and references; progress and status go in epic comments. TRACING-4667, TRACING-4668, TRACING-4669 (closed spikes) and TRACING-6723 (PRW exporter bug) were unparented from the epic. Child tasks: TRACING-6909 (PoC and sizing), TRACING-6789 (docs), TRACING-6790 (e2e), MON-4412 (monitoring stack). |
| Release as Technology Preview with the limitations documented; GA after MON-4412 | The transport is production-grade (no loss under a backend outage, bounded resources, verified with the product image), but until CMO exposes the three settings the exported data is semantically incomplete for OTLP-native backends (untyped counters, no histograms), which is the main use case. Posted on the epic TRACING-4524. |

### Monitoring stack gaps (MON-4412)

Supported by CMO on 5.0: `remoteWrite[].messageVersion` for `prometheusK8s` and the UWM `prometheus`.

Not exposed by CMO (verified against `pkg/manifests/types.go` on `release-5.0`): `enableFeatures` (so no `metadata-wal-records`, no `type-and-unit-labels`), `scrapeNativeHistograms`, `convertClassicHistogramsToNHCB`. Consequence, verified with a debug collector: every series arrives with `METRIC_TYPE_UNSPECIFIED` and is emitted as an untyped gauge (`prometheus.type: unknown`), including counters, `_bucket`/`_sum`/`_count` of classic histograms and summary quantiles. Nothing is dropped. Enabling `metadata-wal-records` alone would make the receiver drop typed classic histograms and summaries, so the three settings must land together.

Stale requirements in MON-4412: the `native-histograms` feature flag is a no-op on Prometheus 3.x (`scrape_native_histograms` replaced it) and `sendNativeHistograms` is a no-op for the v2 message.

### PoC facts

* Platform Prometheus: 2 replicas, ~350k series each, ~24k samples/s total to the collector; UWM negligible. Both replicas send every sample (`prometheus_replica` label differs); backends must deduplicate.
* Old blockers contrib#43628 (receiver stops receiving) and contrib#41347 (panic with two exporters) are closed; not reproduced.
* Receiver limits: 1000-entry resource (job/instance) LRU cache, hardcoded native histogram bucket expansion limits.
* Component ids: `prometheus_remote_write` (deprecated alias `prometheusremotewrite`), `otlp_http` (deprecated alias `otlphttp`); both new ids exist since before 0.158.

Numbers and the benchmark tables are in the design document linked from TRACING-6909 and in `otel-ocp-metrics-export/results/` of the demo repository.

### What is left to the builder

* Docs PR openshift/openshift-docs#122447, QE test PR openshift/distributed-tracing-qe#174 and the 4.x job skip openshift/release#87266 carry the configuration and are open for review.
* Once MON-4412 lands, the docs limitation note and the receiver prerequisites can drop the type caveat and the e2e test can assert metric types. Re-run the debug collector from `otel-ocp-metrics-export/poc/06-debug-collector.yaml` to confirm the types arrive.

## Option 2: collector-only collection without the monitoring stack

### Summary

The OBSDA-863 feature notes that the monitoring stack might become optional (in practice CMO and its exporters are always deployed and the collection profiles full, minimal and telemetry change what the stack scrapes), and Orange asked for hostmetrics and kubeletstats (TRACING-5052). Option 2 collects the platform metrics with the collector and the operator alone and exports them to any backend; it reads, copies and modifies nothing in `openshift-monitoring`. Monitoring is not a cluster capability on OpenShift 5.0 yet (MON-4414, openshift/enhancements#1880 closed as rotten), so the PoC emulates the absent stack by not using it; the stack serves only as the measurement instrument in the sizing run.

```
node collector (DaemonSet, one pod per node)          cluster collector (Deployment, 1 replica;
  host_metrics   root_path: /hostfs (read-only)          StatefulSet + target allocator to scale)
  kubelet_stats  auth_type: kubeConfig ->                k8s_cluster     distribution: openshift (TP)
                 API server node proxy                   prometheus      one kubernetes_sd job per endpoint,
  resource_detection (openshift, k8s_api) (TP)                           service account token, kube root CA
  memory_limiter, otlp_http (resilient settings)                         or service CA (openshift-service-ca.crt)
                                                         resource_detection, memory_limiter, otlp_http
                        both --OTLP--> any backend (OTLP sink, AWS CloudWatch in the e2e tests)
```

### Decisions

| Decision | Rationale |
|---|---|
| Two collectors: a DaemonSet for the node receivers, a Deployment for the cluster-wide receivers | `host_metrics` and `kubelet_stats` are per node; `k8s_cluster` and the `prometheus` receiver must run once. The documented scale-out is `mode: statefulset` with the target allocator (`prometheusCR.enabled: false`, it shards the same `kubernetes_sd` jobs without any ServiceMonitor CRD) and the `k8s_leader_elector` extension for `k8s_cluster`; verified with 2 replicas (59/65 targets, one lease holder). |
| The kubelet is reached through the API server node proxy (`kubelet_stats` with `auth_type: kubeConfig` and `endpoint: ${env:K8S_NODE_NAME}`; `prometheus` receiver jobs with `__metrics_path__` `/api/v1/nodes/<node>/proxy/metrics[/cadvisor]`) | The kubelet serving CA (`kubelet-serving-ca` in `openshift-config-managed`) is namespaced and rotates, so a copied bundle goes stale; `insecure_skip_verify` is not acceptable. Through the proxy the TLS is verified with the service account `ca.crt` and the API server verifies the kubelet with `kubelet-certificate-authority`. In a pod the kubeConfig provider falls back to the in-cluster configuration (client-go `clientcmd` in-cluster fallback). RBAC: `nodes/proxy`, `nodes/stats`, `nodes/metrics` get. Cost: one API server request per node per scrape. |
| Control plane and operator endpoints are scraped with the collector service account token | Verified on 5.0: kube-apiserver, kube-scheduler, kube-controller-manager, every library-go operator and kube-rbac-proxy endpoint return 200 with a token that holds `nonResourceURLs: /metrics get` (401/403 without). CMO uses a client certificate for some of them, but the delegated authentication accepts tokens. Extra rules for the authorizers that do not use the URL: `/metrics/resources` (scheduler), `namespace/metrics` get (machine-config-operator, machine-api kube-rbac-proxy), `route.openshift.io routers/metrics` (router), `image.openshift.io registry/metrics` (image registry), `operator.openshift.io dnses` (DNS). |
| One `kubernetes_sd` scrape job per endpoint family, `role: endpoints`, one namespace and service per job | Service CA certificates carry only `<svc>.<ns>.svc` and `tls_config.server_name` is per job. The kube-apiserver job uses the `kubernetes` endpoint in `default` with the kube root CA (`server_name: kubernetes`) and the CMO drop list for the heavy histograms; every other job the `openshift-service-ca.crt` config map that exists in every namespace. The docs show three patterns (kube-apiserver; scheduler and controller-manager; one kube-rbac-proxy DaemonSet), the PoC generator carries the catalog of 57 ServiceMonitors. |
| Unprivileged SCC for the node collector | hostPath read-only, no privileged container, no host PID or network, all capabilities dropped, `runAsUser: 0` with SELinux `spc_t`; every `host_metrics` scraper works, the filesystem scraper included (TRACING-5963 fixed in contrib 0.152.0). The privileged SCC of the hostmetrics docs module is not needed. |
| etcd excluded (user decision 2026-10-19) | etcd :9979 accepts only the `etcd-metric-client` certificate from `openshift-etcd`; copying a platform secret is out. `etcd_request_duration_seconds` and `apiserver_storage_*` from the kube-apiserver remain. |
| Canonical component ids `host_metrics`, `kubelet_stats`, `resource_detection` in the docs | They are the component types in collector 0.158; `hostmetrics`, `kubeletstats`, `resourcedetection` are deprecated aliases, like `prometheusremotewrite`. `spec.observability.metrics.enableMetrics` stays false (it creates Prometheus Operator ServiceMonitors). |
| Same resilient exporter settings as option 1, with the difference documented | Pull receivers have no upstream WAL: a full `sending_queue` with `block_on_overflow: true` blocks the scrape pipeline and the samples of the skipped intervals are gone. Size the queue for the outage to survive; the `file_storage` extension (shipped) persists the queue. The item-sized queue must also be larger than the largest single scrape: a cAdvisor scrape of a node with 300 pods or a kube-apiserver scrape exceeds 50,000 data points and a request that does not fit is rejected outright (`element size too large`, counted as `enqueue_failed` and as receiver `refused`); the PoC uses 200,000 for the cluster collector and 50,000 for the node collector. |
| No new product component | Everything used is in the 0.158 manifest (see the feature parity table in `FEATURE-PARITY.md` of the demo repository): `host_metrics`, `kubelet_stats`, `prometheus`, `k8s_cluster` (TP), `resource_detection` (TP), `memory_limiter`, `filter`/`transform`, the exporters, `k8s_leader_elector` (TP), `file_storage`, the target allocator. Recording rules, alerting, a query API and `metrics.k8s.io` have no OpenTelemetry equivalent and belong to the backend. |
| E2e tests `platformmetrics-collector-only` (OTLP, in-namespace check Job on the collector's Prometheus exporter) and `awsemfexporter-platformmetrics` (AWS CloudWatch) in `distributed-tracing-qe/tests/e2e-otel` | No OpenShift version gate, nothing from `openshift-monitoring` (no Thanos query, no `cluster-monitoring-view`); the scheduler and controller-manager expectations apply only when `infrastructure.status.controlPlaneTopology` is not `External` (hosted control planes, Konflux ITS); the AWS test name matches the `*aws*` skip pattern of the Konflux integration tests. |
| Docs: new module `otel-config-receive-metrics-without-monitoring-stack.adoc` in the `config-monitoring` assembly, after the remote write module | Both CRs, SCC and RBAC, the three scrape patterns, TP snippets for `k8s_cluster` and `resource_detection`, the metric mapping table, the "not collected" list, the scale-out and resilience notes. |
| PoC assets in github.com/IshwarKanse/demo `otel-ocp-metrics-export/collector-only` | Manifests (namespace, RBAC and SCC, node collector, generated cluster collector and its target allocator variant, OTLP sink, vendor stand-in Prometheus), `scripts/platform-endpoints.tsv` (the endpoint catalog), `scripts/gen-cluster-collector.py`, the sizing scripts, `results/`, `FEATURE-PARITY.md`. |

### Not covered without the monitoring stack (verified on 5.0)

* Endpoints that accept only the stack's client certificate: cluster-version-operator, node-tuning-operator, cluster-samples-operator, marketplace-operator (`tls: certificate required`), the CSI driver controller kube-rbac-proxy (its service account cannot create SubjectAccessReviews; HTTP 500 for token clients), openshift-apiserver `check-endpoints` (certificate valid for `localhost` only), `network-check-source` on 4.22 (self-signed `localhost` certificate; a service CA certificate on 5.0).
* Endpoints behind a NetworkPolicy that admits ingress only from the namespace `openshift-monitoring` by name: dns-default (CoreDNS) :9154, dns-operator :9393, ingress-operator :9393. The control plane and operator endpoints are best effort in general: their owners can tighten the NetworkPolicy, the authentication or the certificate in any release, so the docs tell the reader to prefer remote write v2 from CMO or COO for them where available and to check the `up` series after an upgrade.
* Custom resource metrics: kube-state-metrics reports the state of custom resources (CMO configures VerticalPodAutoscaler, Gateway and GatewayClass); the `k8s_cluster` receiver watches a fixed set of core and OpenShift kinds and cannot report custom resources (open-telemetry/opentelemetry-collector-contrib#50196), `k8s_objects` can only emit them as logs.
* etcd server metrics (by decision), the kube-state-metrics and openshift-state-metrics metric names and their labels/annotations metrics (routes, builds, deployment configs, groups; `k8s_cluster` covers pod, workload, node and quota state with OpenTelemetry names), node-exporter extras (PSI pressure, netstat/sockstat, hardware, textfile).
* Recording rules, alerting rules and Alertmanager, the console Observe pages, metrics-server (`metrics.k8s.io`: `oc adm top` and HPA on resource metrics), Telemeter, user workload monitoring of application ServiceMonitors (applications are scraped by configuration, or through the target allocator when the Prometheus Operator CRDs exist).
* Hosted control planes (ROSA HCP, HyperShift): kube-scheduler, kube-controller-manager, the machine-config daemon and the OVN control plane are not in the cluster; their jobs find no targets.

### PoC facts (OpenShift 5.0, product collector 0.158.0, upstream operator v0.161.0; repeated on OpenShift 4.22 with the GA operator 0.158.0-3 from OperatorHub, same collector image, same results)

* Node collector: 6/6 pods incl. control plane nodes; `kubelet_stats` through the proxy with 0 refused points and no TLS or authorization message; 932 volume series with `metric_groups: [volume]`; `resource_detection` adds `cloud.provider`, `cloud.platform`, `cloud.region`, `k8s.cluster.name`, `k8s.cluster.uid`, `k8s.node.name`, `k8s.node.uid`.
* Cluster collector: 50 scrape jobs up out of the 57-ServiceMonitor catalog (the rest listed above); the kube-apiserver job yields 228,655 series with the CMO drop list, the same as the stack's `apiserver` job (230,083); the whole option 2 set is about 458,000 series against 500,000 series per platform Prometheus replica on the same cluster.
* Scale-out variant: target allocator with 51 jobs, 59/65 targets on 2 replicas; `k8s_cluster` runs only on the lease holder.
* Sizing, first run (2026-10-19, 6 nodes, nop sink, cluster collector with the full endpoint catalog plus the kubelet and cAdvisor node-proxy jobs): node collector about 150 MiB RSS and a few millicores per node; cluster collector 0.09 cores / 1.05 GiB at 296 pods, 0.17 / 1.8 GiB at 896. Pitfalls: the vendor stand-in Prometheus cannot ingest about 450,000 series fast enough (the blocked queue shows up as receiver and memory_limiter `refused`), and the item-sized queue must exceed the largest single scrape (`element size too large`). Numbers in `results/2026-10-19-ocp-5.0-aws-product-0.158.md` of the demo repository.
* Sizing, extended run (2026-10-20, the 7 node cluster of the option 1 extended run: 4 workers of 15.5 CPU / 58 GiB, 3 control plane nodes, GA operator 0.158.0 from OperatorHub with its default collector image, 20 minute windows, raw series, charts and `runs.json` in `collector-only/results/2026-10-20`): with the full catalog (49 jobs, kubelet and cAdvisor node-proxy jobs included) the cluster collector is linear in the pod count, 0.10 cores / 950 MiB at 271 pods, 0.18 / 1.7 GiB at 871, 0.24 / 2.5 GiB at 1,471 (about 1.3 GiB and 0.12 cores per 1,000 pods, 3,400 + 10,900 data points/s per 1,000 pods), no refused point or restart in any tier. The per-pod cost is the kubelet and cAdvisor node-proxy jobs: the documented shape without them (45 jobs) costs 0.05 cores / 630 MiB at 1,461 pods (570 MiB at 271 pods: about 50 MiB per 1,000 pods, the base is the kube-apiserver target), and the API server node proxy requests drop from 1.2/s to 0.2/s. CPU follows the sample rate (0.12 cores at 60 s, 0.24 at 30 s, 0.49 at 15 s for the same 1,461 pods, about 1.25 cores per 100,000 data points/s), memory follows the series. Scale-out with two StatefulSet replicas and the target allocator: same total, 1.7 GiB on the busiest replica (targets are sharded, not series; the kube-apiserver target stays on one replica), target allocator 3 millicores / 100 MiB. Node collector at 250 pods per node: 5 millicores, 75 MiB working set, 153 MiB RSS (11 millicores at 15 s). Control plane: node proxy requests 1.2/s for 7 nodes at 30 s, kube-apiserver CPU unchanged at 0.33 to 0.40 cores across the tiers. A 150 minute window at 1,461 pods showed no growth beyond the garbage collection sawtooth (working set 2.2 to 2.8 GiB, no refusal, no restart). 5 minute backend outage at 1,461 pods with the full catalog: the cluster collector filled its 200,000-item queue after 49 s, skipped the remaining scrapes (about 3 minutes of control plane data), drained in 75 s at up to 32,000 points/s and peaked at a 3.2 GiB working set, just under the memory_limiter soft limit of the 4Gi limit; with `file_storage` the same loss, an RSS peak of 3.9 GiB and one minute of memory_limiter refusals (no restart). The node collectors reached 46,000 of their 50,000 items per node. Consequence for the recommendation: 2 CPU / 4Gi hold up to about 1,000 pods with the kubelet and cAdvisor jobs and up to at least 1,500 pods in the documented shape; beyond that leave the kubelet jobs out, raise the limit to 6Gi (1.4 GiB per further 1,000 pods) or scale out. The docs present this as a resource table per collector.

### What is left to the builder

* Docs PR (TRACING-6912), e2e PR (TRACING-6911), 4.22 verification and the findings document section (TRACING-6910).
* Re-check the NetworkPolicy and client-certificate-only endpoints on each OpenShift release: the platform NetworkPolicy work in 5.0 may add or remove gaps.
* Once monitoring becomes a cluster capability, verify option 2 on a cluster installed without it.
