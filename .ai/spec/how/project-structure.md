# Project Structure

This is a multi-repo workspace. Each subdirectory is an independent Git repository with its own build system, CI, and conventions.

## Module Map

| Directory | Go Module | Responsibility |
|---|---|---|
| `opentelemetry-collector/` | `go.opentelemetry.io/collector` | Core collector framework: pipeline engine, pdata model, confmap, config primitives, otelcol CLI |
| `opentelemetry-collector-contrib/` | `github.com/open-telemetry/opentelemetry-collector-contrib` | ~241 community components (113 receivers, 47 exporters, 35 processors, 14 connectors, 31 extensions) |
| `redhat-opentelemetry-collector/` | `github.com/openshift/redhat-opentelemetry-collector` | Component selection via `manifest.yaml`, OCB-generated source in `_build/`, RPM packaging |
| `opentelemetry-operator/` | `github.com/open-telemetry/opentelemetry-operator` | Kubernetes operator: CRDs, controllers, auto-instrumentation injection, target allocator, OpAMP bridge |
| `open-telemetry-opentelemetry-operator/` | `github.com/open-telemetry/opentelemetry-operator` | Product fork of the operator: `rhosdt-<version>` branches, ART Dockerfiles, OLM bundle configuration |
| `ocp-build-data/` | — (YAML) | ART configuration on `rhosdt-<version>` branches: group, streams, image configs, assemblies |
| `konflux-release-data/` | — (YAML) | Konflux configuration of the tenant `art-rhosdt-tenant`: release plans, integration test scenarios, MintMaker |
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
| Container builds | `redhat-opentelemetry-collector/Dockerfile.art`, `open-telemetry-opentelemetry-operator/Dockerfile.art`, `open-telemetry-opentelemetry-operator/Dockerfile.ta.art` |
| Bundle patching | `open-telemetry-opentelemetry-operator/bundle/art.yaml` |
| ART group and images | `ocp-build-data/group.yml`, `ocp-build-data/images/` |
| Release plans | `konflux-release-data/tenants-config/cluster/kflux-ocp-p01/tenants/art-rhosdt-tenant/` |
| Doc topic map | `openshift-docs/_topic_maps/_topic_map.yml` |
| Doc modules | `openshift-docs/modules/` |

## Naming Conventions

- Upstream repos use Go module naming (`go.opentelemetry.io/collector`, `github.com/open-telemetry/...`).
- Contrib components follow the pattern `<type>/<name><type>/` (e.g., `receiver/otlpreceiver/`, `exporter/debugexporter/`).
- ART Dockerfiles are named `Dockerfile.art`, plus `Dockerfile.ta.art` for the target allocator.
- Product branches are named `rhosdt-<version>` after the operator version (e.g., `rhosdt-0.158`).
