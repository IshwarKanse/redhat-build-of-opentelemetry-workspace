# Repo Map

Lookup table: concern → repo(s) → spec file(s). Use this to find where to go when updating specs or implementing a feature.

## Collector — Core

| Concern | Repo | Spec Files |
|---|---|---|
| Core collector pipeline (receivers, processors, exporters, connectors) | opentelemetry-collector | `what/collector.md` |
| Pipeline data model (pdata) | opentelemetry-collector | `what/collector.md` |
| Configuration framework (confmap) | opentelemetry-collector | `what/collector.md` |

## Collector — Contrib

| Concern | Repo | Spec Files |
|---|---|---|
| Community receivers, processors, exporters, connectors | opentelemetry-collector-contrib | `what/collector.md` |

## Collector — Red Hat Distribution

| Concern | Repo | Spec Files |
|---|---|---|
| Component selection (which contrib components to include) | redhat-opentelemetry-collector | `what/collector.md`, `how/build-pipeline.md` |
| OCB build and `_build/` generation | redhat-opentelemetry-collector | `how/build-pipeline.md` |
| RPM packaging | redhat-opentelemetry-collector | `what/productization.md` |
| Non-repudiation signing (SDK + collector processor) | redhat-opentelemetry-collector | `what/signing.md` |
| RHEL metering (bootstrap script + stock components) | redhat-opentelemetry-collector | `what/rhel-metering.md` |
| OBI receiver (eBPF instrumentation) | redhat-opentelemetry-collector | `what/obi.md` |

## Operator

| Concern | Repo | Spec Files |
|---|---|---|
| OpenTelemetryCollector CRD & API | opentelemetry-operator | `what/operator.md` |
| Instrumentation CRD (auto-instrumentation) | opentelemetry-operator | `what/auto-instrumentation.md` |
| Target allocator (Prometheus CR discovery) | opentelemetry-operator | `what/target-allocator.md` |
| OpAMP Bridge | opentelemetry-operator | `what/operator.md` |
| ClusterObservability CRD | opentelemetry-operator | `what/operator.md` |

## Productization

| Concern | Repo | Spec Files |
|---|---|---|
| ART group & image build configuration | ocp-build-data (branch: `rhosdt-<version>`) | `what/productization.md`, `how/build-pipeline.md` |
| ART Dockerfiles | open-telemetry-opentelemetry-operator, redhat-opentelemetry-collector | `what/productization.md`, `how/build-pipeline.md` |
| Product Operator bundle (OLM) | open-telemetry-opentelemetry-operator (`bundle/`) | `what/productization.md`, `how/build-pipeline.md` |
| FBC catalogs | ocp-build-data (`OCP_TARGET_VERSIONS`) | `what/productization.md`, `how/build-pipeline.md` |
| Konflux tenant, release plans, integration test scenarios, MintMaker | konflux-release-data (`art-rhosdt-tenant`) | `what/productization.md`, `how/build-pipeline.md` |
| FIPS compliance | open-telemetry-opentelemetry-operator, redhat-opentelemetry-collector (`fips-allowlist.yaml`) | `what/system-overview.md`, `what/productization.md` |
| Multi-arch builds | ocp-build-data (`group.yml`) | `what/productization.md` |

## Documentation

| Concern | Repo | Spec Files |
|---|---|---|
| Product documentation (install, configure, use) | openshift-docs (branch: standalone-otel-docs-main) | — |

## Workspace Tooling

| Concern | Repo | Spec Files |
|---|---|---|
| Deploy a workspace skill as an agentic periodic job | rhobs/redhat-build-of-opentelemetry-workspace, openshift/release | `what/deploy-periodic-agent.md`, `how/deploy-periodic-agent.md` |
| Skill-agent runner image | rhobs/redhat-build-of-opentelemetry-workspace (`ci/Dockerfile`) | `how/deploy-periodic-agent.md` |
| Shared agent step & periodic jobs | openshift/release (`ci-operator/…/openshift-observability/skill-agent/`) | `how/deploy-periodic-agent.md` |

## Cross-Repo Features

These features span multiple repos:

| Feature | Repos |
|---|---|
| Adding a new collector component | redhat-opentelemetry-collector, openshift-docs |
| OBI receiver features & k8s-cache | redhat-opentelemetry-collector, opentelemetry-operator, open-telemetry-opentelemetry-operator (`bundle/`), ocp-build-data, konflux-release-data, openshift-docs |
| New CRD or API field | opentelemetry-operator, open-telemetry-opentelemetry-operator (`bundle/`), openshift-docs |
| Version bump (upstream rebase) | redhat-opentelemetry-collector, open-telemetry-opentelemetry-operator, ocp-build-data, konflux-release-data |
| New OCP version support | ocp-build-data (`OCP_TARGET_VERSIONS`), konflux-release-data (integration test scenarios), release (pre-merge matrix) |
| Cluster TLS profile adherence | opentelemetry-operator (profile fetch, operand injection, target allocator), opentelemetry-collector (`config/configtls` curve allowlist), openshift-docs |
