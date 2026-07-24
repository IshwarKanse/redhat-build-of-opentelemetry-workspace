# Collector

The OpenTelemetry Collector is a vendor-agnostic telemetry pipeline that receives, processes, and exports traces, metrics, and logs. The Red Hat distribution includes a curated subset of upstream components selected via a declarative manifest.

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

### Included Components

8. The distro includes 14 receivers: otlp, jaeger, hostmetrics, prometheus, prometheusremotewrite, zipkin, kafka, filelog, journald, k8sevents, kubeletstats, k8scluster, k8sobjects, otlpjsonfile.
9. The distro includes 12 exporters: debug, otlp, otlphttp, prometheus, prometheusremotewrite, kafka, awscloudwatchlogs, awsemf, awsxray, googlecloud, loadbalancing, file.
10. The distro includes 14 processors: batch, memorylimiter, attributes, resource, span, k8sattributes, resourcedetection, filter, probabilisticsampler, cumulativetodelta, metricstarttime, groupbyattrs, transform, tailsampling.
11. The distro includes 10 extensions: zpages, memorylimiter, jaegerremotesampling, healthcheck, pprof, oauth2clientauth, oidcauth, bearertokenauth, filestorage, googleclientauth.
12. The distro includes 4 connectors: forward, spanmetrics, count, routing.

### Configuration

13. In the v1beta1 API, collector config is a structured object with typed fields for receivers, exporters, processors, connectors, extensions, and service.
14. In the deprecated v1alpha1 API, collector config is a raw YAML string.

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

## Constraints

1. Adding or removing a component from the Red Hat distro requires updating `manifest.yaml` in `redhat-opentelemetry-collector` and regenerating `_build/`.
2. Each component has independent stability levels per signal (e.g., a receiver can be Stable for traces but Alpha for metrics).
3. The collector binary exposes OTLP gRPC on port 4317 by default.
