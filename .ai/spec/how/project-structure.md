# Project Structure

This is a multi-repo workspace. Each subdirectory is an independent Git repository with its own build system, CI, and conventions.

## Module Map

| Directory | Go Module | Responsibility |
|---|---|---|
| `opentelemetry-collector/` | `go.opentelemetry.io/collector` | Core collector framework: pipeline engine, pdata model, confmap, config primitives, otelcol CLI |
| `opentelemetry-collector-contrib/` | `github.com/open-telemetry/opentelemetry-collector-contrib` | ~241 community components (113 receivers, 47 exporters, 35 processors, 14 connectors, 31 extensions) |
| `redhat-opentelemetry-collector/` | `github.com/os-observability/redhat-opentelemetry-collector` | Component selection via `manifest.yaml`, OCB-generated source in `_build/`, RPM packaging |
| `opentelemetry-operator/` | `github.com/open-telemetry/opentelemetry-operator` | Kubernetes operator: CRDs, controllers, auto-instrumentation injection, target allocator, OpAMP bridge |
| `konflux-opentelemetry/` | — (not a Go module) | Produktization: Dockerfiles, Tekton pipelines, bundle patching, FBC catalogs, scripts |
| `openshift-docs/` | — (AsciiDoc) | Product documentation on branch `standalone-otel-docs-main` |

## Key Entry Points

| Concern | Entry Point |
|---|---|
| Collector binary | `opentelemetry-collector/otelcol/` (framework), `redhat-opentelemetry-collector/_build/main.go` (distro) |
| Operator binary | `opentelemetry-operator/cmd/manager/main.go` |
| Target Allocator binary | `opentelemetry-operator/cmd/otel-allocator/` |
| OpAMP Bridge binary | `opentelemetry-operator/cmd/operator-opamp-bridge/` |
| CRD type definitions | `opentelemetry-operator/apis/v1alpha1/`, `opentelemetry-operator/apis/v1beta1/` |
| Operator controllers | `opentelemetry-operator/internal/controllers/` |
| Auto-instrumentation injection | `opentelemetry-operator/internal/instrumentation/` |
| Manifest generation | `opentelemetry-operator/internal/manifests/` |
| Component selection | `redhat-opentelemetry-collector/manifest.yaml` |
| Container builds | `konflux-opentelemetry/Dockerfile.*` |
| Bundle patching | `konflux-opentelemetry/bundle-patch/` |
| FBC catalogs | `konflux-opentelemetry/catalog/` |
| Tekton pipelines | `konflux-opentelemetry/.tekton/` |
| Doc topic map | `openshift-docs/_topic_maps/_topic_map.yml` |
| Doc modules | `openshift-docs/modules/` |

## Naming Conventions

- Upstream repos use Go module naming (`go.opentelemetry.io/collector`, `github.com/open-telemetry/...`).
- Contrib components follow the pattern `<type>/<name><type>/` (e.g., `receiver/otlpreceiver/`, `exporter/debugexporter/`).
- Konflux Dockerfiles are named `Dockerfile.<component>` (e.g., `Dockerfile.operator`, `Dockerfile.collector`).
- FBC catalog Dockerfiles are named `Dockerfile-v4-<version>.catalog`.
- Product branches are named `rhosdt-<version>` (e.g., `rhosdt-3.10`).
