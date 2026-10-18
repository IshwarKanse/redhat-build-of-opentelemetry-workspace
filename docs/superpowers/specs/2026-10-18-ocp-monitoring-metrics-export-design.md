# Exporting OpenShift Monitoring Metrics via Prometheus Remote Write v2

**Date:** 2026-10-18
**Ticket:** TRACING-4524 (epic), TRACING-6909 (PoC), TRACING-6789 (docs), TRACING-6790 (e2e), MON-4412 (monitoring stack)
**Status:** Design, verified by a PoC on OpenShift 5.0.0-0.nightly-2026-10-16-110515

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
| E2e tests in `distributed-tracing-qe/tests/e2e-otel/prometheusremotewritereceiver-cluster-monitoring` (Prometheus exporter check) and `awsemfexporter-cluster-monitoring` (AWS CloudWatch via the AWS EMF exporter) | Product suite, next to the existing collector-to-collector receiver test; `concurrent: false`; the shared CMO config maps are saved before the test and restored in `catch`/`finally`; only `prometheus_remote_storage_samples_failed_total` is asserted (`_dropped_total` counts the samples removed by `writeRelabelConfigs`). They fail early on OpenShift < 5.0: the upstream 4.x jobs in `openshift/release` skip the first one (openshift/release#87266), the AWS one matches the existing `*aws*` pattern, and the Konflux integration tests run the `rhosdt-0.158` branch and do not pick them up. AWS CloudWatch is the validated third-party backend; Amazon Managed Prometheus would need the `sigv4auth` extension, which the distro does not ship. |
| Sizing recommendation per collector replica (product collector 0.158.0, benchmark harness and results in github.com/IshwarKanse/demo `otel-ocp-metrics-export`) | About 1 CPU core per 100,000 samples/s in steady state, memory under 250 MiB in steady state; requests 500m / 512Mi, limits 2 CPU / 2Gi (used while catching up after a backend outage: a 5 minute backlog at 47k samples/s drained in 203 s at the 2-core limit with the working set peaking at 1.97 GiB under the `memory_limiter`, no loss). One replica handles 95,000 samples/s (extended run of 2026-10-20 on a cluster with 4 workers of 15.5 CPU: 1.06 cores at 96,000 samples/s, working set 98 to 151 MiB between 28,000 and 96,000 samples/s, two replicas at 62,000 samples/s used 0.70 cores and 231 MiB together, a 5 minute outage at 40,000 samples/s drained in 245 s with a 2 GiB working-set peak); replicas share the Prometheus shards evenly. The docs carry the figures as a resource table by remote write rate. |
| PoC and benchmark assets live in the team-readable demo repository github.com/IshwarKanse/demo, directory `otel-ocp-metrics-export` | `poc/`: the manifests used for the PoC (namespace, vendor stand-in Prometheus with the OTLP receiver, collector CR, CMO and UWM config maps, sample app with every metric type, debug collector for the type check, product-image validation CR, avalanche load generator). `manifests/`, `scripts/`, `results/`: the sizing benchmark (OTLP sink collector, collector under test with the recommended configuration, load tiers, outage test, measured numbers). The 2025 COO-relay manifests in `openshift-observability-manifests` are superseded and not updated. |
| Docs: new module for remote write, federate module kept for OpenShift < 5.0 | Customer-likely configuration only (CMO snippets, collector CR, resilience settings, replica duplication, type limitation, sizing). |
| Epic TRACING-4524 stays focused on the remote write v2 path | The epic description holds only problem, goal, scope, acceptance criteria, dependencies and references; progress and status go in epic comments. TRACING-4667, TRACING-4668, TRACING-4669 (closed spikes) and TRACING-6723 (PRW exporter bug) were unparented from the epic. Child tasks: TRACING-6909 (PoC and sizing), TRACING-6789 (docs), TRACING-6790 (e2e), MON-4412 (monitoring stack). |
| Release as Technology Preview with the limitations documented; GA after MON-4412 | The transport is production-grade (no loss under a backend outage, bounded resources, verified with the product image), but until CMO exposes the three settings the exported data is semantically incomplete for OTLP-native backends (untyped counters, no histograms), which is the main use case. Posted on the epic TRACING-4524. |

## Monitoring stack gaps (MON-4412)

Supported by CMO on 5.0: `remoteWrite[].messageVersion` for `prometheusK8s` and the UWM `prometheus`.

Not exposed by CMO (verified against `pkg/manifests/types.go` on `release-5.0`): `enableFeatures` (so no `metadata-wal-records`, no `type-and-unit-labels`), `scrapeNativeHistograms`, `convertClassicHistogramsToNHCB`. Consequence, verified with a debug collector: every series arrives with `METRIC_TYPE_UNSPECIFIED` and is emitted as an untyped gauge (`prometheus.type: unknown`), including counters, `_bucket`/`_sum`/`_count` of classic histograms and summary quantiles. Nothing is dropped. Enabling `metadata-wal-records` alone would make the receiver drop typed classic histograms and summaries, so the three settings must land together.

Stale requirements in MON-4412: the `native-histograms` feature flag is a no-op on Prometheus 3.x (`scrape_native_histograms` replaced it) and `sendNativeHistograms` is a no-op for the v2 message.

## PoC facts

* Platform Prometheus: 2 replicas, ~350k series each, ~24k samples/s total to the collector; UWM negligible. Both replicas send every sample (`prometheus_replica` label differs); backends must deduplicate.
* Old blockers contrib#43628 (receiver stops receiving) and contrib#41347 (panic with two exporters) are closed; not reproduced.
* Receiver limits: 1000-entry resource (job/instance) LRU cache, hardcoded native histogram bucket expansion limits.
* Component ids: `prometheus_remote_write` (deprecated alias `prometheusremotewrite`), `otlp_http` (deprecated alias `otlphttp`); both new ids exist since before 0.158.

Numbers and the benchmark tables are in the design document linked from TRACING-6909 and in `otel-ocp-metrics-export/results/` of the demo repository.

## What is left to the builder

* Docs PR openshift/openshift-docs#122447, QE test PR openshift/distributed-tracing-qe#174 and the 4.x job skip openshift/release#87266 carry the configuration and are open for review.
* Once MON-4412 lands, the docs limitation note and the receiver prerequisites can drop the type caveat and the e2e test can assert metric types. Re-run the debug collector from `otel-ocp-metrics-export/poc/06-debug-collector.yaml` to confirm the types arrive.
