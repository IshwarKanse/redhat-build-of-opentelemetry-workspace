# System Overview

Red Hat build of OpenTelemetry (RHOSDT) is a supported OpenTelemetry distribution for OpenShift. It provides a Kubernetes Operator that manages OpenTelemetry Collector instances and auto-instrumentation injection, backed by a curated subset of upstream collector components compiled with FIPS-compliant cryptography. The product is distributed via OLM (Operator Lifecycle Manager) on OpenShift.

## Support Level Convention

Features in this product have one of three support levels:

- **GA** (Generally Available): fully supported with Red Hat production SLAs.
- **TP** (Technology Preview): documented but not supported with production SLAs. Not recommended for production use. May not be functionally complete.
- **Not supported**: present in the source code but not documented. These features are neither GA nor TP and must not be relied upon.

Only features documented in the product documentation are considered supported. If a feature exists in the upstream source code but is absent from the docs, it is not supported.

## Behavioral Rules

### Product Identity

1. The product name is "Red Hat build of OpenTelemetry" (abbreviation: RHOSDT).
2. The Jira project key is TRACING on `redhat.atlassian.net`.
3. The product version tracks upstream OpenTelemetry Collector releases (e.g., RHOSDT 3.10 tracks collector 0.152.x).

### Signal Support

4. **GA**: The product supports three telemetry signals: traces, metrics, and logs.
5. **TP**: Profiles support is documented as Technology Preview.

### Deployment Model

6. The product is deployed on OpenShift via OLM.
7. The Operator manages collector instances, target allocators, and auto-instrumentation injection.
8. **GA**: Collector instances can run in four modes: Deployment, DaemonSet, StatefulSet, and Sidecar.

### Protocol

9. **GA**: The primary ingestion and export protocol is OTLP (OpenTelemetry Protocol).
10. **GA**: The product also supports Jaeger, Zipkin, and Prometheus protocols for ingestion and export.

### Architecture Tiers

11. The product consists of four container images: Operator, Collector, Target Allocator, and OLM Bundle.
12. File-Based Catalogs (FBC) are generated per OpenShift version (4.12 through 4.22).
13. All container images support four architectures: amd64, arm64, ppc64le, s390x.

### Operator Features

14. **GA**: OpenTelemetryCollector CRD (v1beta1) for managing collector instances.
15. **GA**: Target Allocator for Prometheus target distribution (promoted from TP in 3.9.0).
16. **TP**: Auto-instrumentation injection via Instrumentation CRD. See `what/auto-instrumentation.md`.
17. **GA**: Cluster TLS profile adherence (introduced in 3.10.0).
18. **GA**: Automatic RBAC resource creation by the operator.
19. **GA**: Operator configuration via environment variables (OPENSHIFT_CREATE_DASHBOARD, ENABLE_CR_METRICS, CREATE_SM_OPERATOR_METRICS, FEATURE_GATES).

## Configuration Surface

| Field/Flag | Type | Default | Description |
|---|---|---|---|
| Collector mode | Enum | `deployment` | How collector pods are scheduled |
| Collector config | Structured YAML | — | Pipeline definition (receivers, processors, exporters, connectors, extensions, service) |
| TargetAllocator.enabled | bool | false | Enable Prometheus target distribution |
| Instrumentation annotations | string | — | Per-pod annotations to inject auto-instrumentation |

## Constraints

1. All Go binaries must be compiled with `CGO_ENABLED=1 GOEXPERIMENT=strictfipsruntime -tags strictfipsruntime` for FIPS compliance.
2. The collector binary must pass the FIPS check (no non-FIPS crypto functions like `decryptKey`/`encryptKey` from go-jose).
3. Base container images must be UBI 9 (Red Hat Universal Base Image).
4. The product must support the OpenShift version range defined in `konflux-opentelemetry/versions.sh` (currently OCP 4.12+).
5. All repos use a fork-based Git workflow: push to fork, PR against origin/main, squash before pushing.
6. Only features documented in the product documentation are supported. Undocumented features are not supported regardless of their presence in the source code.

## Planned Changes

| Ticket | Summary |
|---|---|
| [PLANNED: TRACING-6499] | Non-repudiation signing in traces — Go SDK signing component + collector validation processor (TP). See `docs/superpowers/specs/2026-07-29-non-repudiation-signing-design.md`. |
