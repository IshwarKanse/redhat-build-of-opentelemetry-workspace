# Exporting OpenShift Monitoring Metrics via Prometheus Remote Write v2

**Date:** 2026-10-18, updated 2026-10-26
**Ticket:** TRACING-4524 (Technology Preview epic), TRACING-6928 (GA epic), TRACING-6909 (PoC), TRACING-6789 (docs), TRACING-6790 (e2e), TRACING-6926 and TRACING-6927 (receiver bugs); MON-4412 (monitoring stack) is closed in favour of the GA tasks TRACING-6929 to TRACING-6933
**Status:** Technology Preview in RHOSDT 3.12 (OOC meeting 2026-10-22), GA planned for the next release; verified by a PoC on OpenShift 5.0.0-0.nightly-2026-10-16-110515

## Summary

Customers want the in-cluster (platform) and user workload monitoring (UWM) metrics of OpenShift exported to OTLP-native backends (Dynatrace, Google Cloud Monitoring, ...). The supported path is:

```
CMO Prometheus (platform, UWM)  --remote write v2-->  OpenTelemetry collector  --OTLP / vendor exporter-->  backend
   cluster-monitoring-config /                        prometheus_remote_write receiver
   user-workload-monitoring-config                    (Red Hat build of OpenTelemetry)
   remoteWrite[].messageVersion: V2.0
```

Only supported configuration is used: the Cluster Monitoring Operator (CMO) config maps on the monitoring side and the `OpenTelemetryCollector` CR on the collector side. The 2025 PoC that relayed the platform metrics through a COO `MonitoringStack` is obsolete.

## Decisions

| Decision | Rationale |
|---|---|
| Remote write v2 only, no federation, no COO relay | The `prometheus_remote_write` receiver accepts only the v2 message; CMO exposes `messageVersion` since OpenShift 5.0 (MON-4390). Federation stays documented for OpenShift < 5.0. |
| No new collector component | `prometheusremotewritereceiver`, `otlp`/`otlphttp` exporters, `memory_limiter`, `filter`/`resource`/`transform` processors are all in the 0.158 distro manifest. |
| Collector CR must set the receiver port in `spec.ports` and a contrib/product image | The operator does not infer the receiver port; the operator default (core) image lacks the receiver. |
| Resilient exporter settings are part of the documented configuration | With the defaults (`sending_queue` of 5000 requests, `retry_on_failure.max_elapsed_time` 5m, batch processor) a 5 minute backend outage OOM-killed the collector 4 times and dropped batches. With `retry_on_failure.max_elapsed_time: 0`, `sending_queue.sizer: items`, a bounded `queue_size`, `block_on_overflow: true` and exporter-side `sending_queue.batch`, back-pressure reaches the receiver; Prometheus retries from its WAL and no sample is lost. |
| E2e tests in `distributed-tracing-qe/tests/e2e-otel/prometheusremotewritereceiver-cluster-monitoring` (Prometheus exporter check) and `awsemfexporter-cluster-monitoring` (AWS CloudWatch via the AWS EMF exporter), merged in openshift/distributed-tracing-qe#174 | Product suite, next to the existing collector-to-collector receiver test; `concurrent: false`; the shared CMO config maps are saved before the test and restored in a cleanup hook; the collectors use the documented `memory_limiter` processor and requests/limits; the platform export includes `ALERTS` and a recording rule, the targeted subset the Technology Preview documentation advises; only `prometheus_remote_storage_samples_failed_total` is asserted (`_dropped_total` counts the samples removed by `writeRelabelConfigs`). They fail early on OpenShift < 5.0: the upstream 4.x jobs in `openshift/release` skip both (openshift/release#87266, which also replaces the `*aws*` skip with the STS-only `awscloudwatchlogs-rolearn*` skip on the AWS cluster pool jobs), and the Konflux integration tests run the `rhosdt-0.158` branch and do not pick them up. AWS CloudWatch is the validated third-party backend; Amazon Managed Prometheus would need the `sigv4auth` extension, which the distro does not ship. |
| Sizing recommendation per collector replica (product collector 0.158.0, benchmark harness and results in github.com/IshwarKanse/demo `otel-ocp-metrics-export`) | About 1 CPU core per 100,000 samples/s in steady state, memory under 250 MiB in steady state; requests 500m / 512Mi, limits 2 CPU / 2Gi (used while catching up after a backend outage: a 5 minute backlog at 47k samples/s drained in 203 s at the 2-core limit with the working set peaking at 1.97 GiB under the `memory_limiter`, no loss). One replica handles 95,000 samples/s (extended run of 2026-10-20 on a cluster with 4 workers of 15.5 CPU: 1.06 cores at 96,000 samples/s, working set 98 to 151 MiB between 28,000 and 96,000 samples/s, two replicas at 62,000 samples/s used 0.70 cores and 231 MiB together, a 5 minute outage at 40,000 samples/s drained in 245 s with a 2 GiB working-set peak); replicas share the Prometheus shards evenly. The docs carry the figures as a resource table by remote write rate. |
| PoC and benchmark assets live in the team-readable demo repository github.com/IshwarKanse/demo, directory `otel-ocp-metrics-export` | `poc/`: the manifests used for the PoC (namespace, vendor stand-in Prometheus with the OTLP receiver, collector CR, CMO and UWM config maps, sample app with every metric type, debug collector for the type check, product-image validation CR, avalanche load generator). `manifests/`, `scripts/`, `results/`: the sizing benchmark (OTLP sink collector, collector under test with the recommended configuration, load tiers, outage test, measured numbers). The 2025 COO-relay manifests in `openshift-observability-manifests` are superseded and not updated. |
| Docs: new module for remote write, federate module kept for OpenShift < 5.0 | Customer-likely configuration only (CMO snippets, collector CR, resilience settings, sizing). The module marks the whole flow as Technology Preview and has a "Limitations of the Technology Preview" section (untyped metrics, no native histograms, no Prometheus feature settings in CMO, replica duplication) with the advice to export a targeted subset such as `ALERTS` and recording rule results. |
| Epic TRACING-4524 is the Technology Preview epic of the remote write v2 path; GA work lives in TRACING-6928 | The epic descriptions hold only problem, goal, scope, acceptance criteria, dependencies and references; progress and status go in one status comment. TRACING-4524 (renamed "... as TP", RHOSDT 3.12): TRACING-6909 (PoC and sizing), TRACING-6789 (docs), TRACING-6790 (e2e), TRACING-6926 and TRACING-6927 (receiver bugs). TRACING-6928 (GA, next release): TRACING-6929 to TRACING-6933 (monitoring stack requirements and a CMO e2e test, owned by the monitoring team), TRACING-6934 (combined e2e with typed metrics), TRACING-6935 (performance and scale benchmark), TRACING-6936 (receiver fixes in the product collector), TRACING-6937 (GA docs). MON-4412 is closed in favour of the GA tasks. TRACING-4667, TRACING-4668, TRACING-4669 (closed spikes) and TRACING-6723 (PRW exporter bug) are not part of either epic. |
| Release as Technology Preview in RHOSDT 3.12, GA in the next release (OOC meeting 2026-10-22, with the monitoring team) | The transport is production-grade (no loss under a backend outage, bounded resources, exact data, verified with the product image), but until the GA tasks land the exported data is semantically incomplete for OTLP-native backends (untyped counters, no histograms). Customers can use it now for a targeted subset such as alerts and recording rule results. `messageVersion` is not feature-gated in CMO 5.0, so no Technology Preview feature set is needed on the cluster. The earlier recommendation to hold (2026-10-21) is superseded. |

## Monitoring stack gaps (GA requirements, TRACING-6928)

Supported by CMO on 5.0: `remoteWrite[].messageVersion` for `prometheusK8s` and the UWM `prometheus`.

Not exposed by CMO (verified against `pkg/manifests/types.go` on `release-5.0`): `enableFeatures` (so no `metadata-wal-records`, no `type-and-unit-labels`), `scrapeNativeHistograms`, `convertClassicHistogramsToNHCB`, `remoteWrite[].sendNativeHistograms`. Consequence, verified with a debug collector: every series arrives with `METRIC_TYPE_UNSPECIFIED` and is emitted as an untyped gauge (`prometheus.type: unknown`), including counters, `_bucket`/`_sum`/`_count` of classic histograms and summary quantiles. Nothing is dropped. Even with the flag, Prometheus 3.10.0 to 3.15.0 write no metadata WAL records (fix prometheus/prometheus#19678, backport requested in prometheus/prometheus#20094), and Prometheus 3.14 sends native histograms on the v2 message only with `sendNativeHistograms` (fix prometheus/prometheus#20097). Once series arrive typed, the receiver drops typed classic histograms and summaries (counted as written since opentelemetry-collector-contrib#52252), so the GA configuration keeps them off the v2 stream. The settings must land together: TRACING-6929 (metadata), TRACING-6930 (Prometheus fix), TRACING-6931 (native histogram switch), TRACING-6932 (classic histogram and summary series), TRACING-6933 (CMO e2e test).

Corrections to the original MON-4412 requirements: the `native-histograms` feature flag is a no-op on Prometheus 3.x (`scrape_native_histograms` replaced it); `sendNativeHistograms` is required for the v2 message on Prometheus 3.14, contrary to the Prometheus documentation, until prometheus/prometheus#20097 ships.

## PoC facts

* Platform Prometheus: 2 replicas, ~350k series each, ~24k samples/s total to the collector; UWM negligible. Both replicas send every sample (`prometheus_replica` label differs); backends must deduplicate.
* Old blockers contrib#43628 (receiver stops receiving) and contrib#41347 (panic with two exporters) are closed; not reproduced.
* Receiver limits: 1000-entry resource (job/instance) LRU cache, configurable with `resource_cache_size` and observable through an eviction counter from contrib v0.164.0 (TRACING-6926); hardcoded native histogram bucket expansion limits.
* Component ids: `prometheus_remote_write` (deprecated alias `prometheusremotewrite`), `otlp_http` (deprecated alias `otlphttp`); both new ids exist since before 0.158.

Numbers and the benchmark tables are in the design document linked from TRACING-6909 and in `otel-ocp-metrics-export/results/` of the demo repository.

## What is left to the builder

* Technology Preview (RHOSDT 3.12): the docs PR openshift/openshift-docs#122447 is in review, the 4.x job skip openshift/release#87266 is open, and the receiver fix opentelemetry-collector-contrib#52252 (TRACING-6927) is in review upstream.
* GA (TRACING-6928): the monitoring stack tasks TRACING-6929 to TRACING-6933, then TRACING-6934 (combined e2e asserting metric types; re-run the debug collector from `otel-ocp-metrics-export/poc/06-debug-collector.yaml` to confirm the types), TRACING-6935 (performance and scale benchmark), TRACING-6936 (receiver fixes in the product collector) and TRACING-6937 (GA docs: drop the Technology Preview notice and the type limitations).
