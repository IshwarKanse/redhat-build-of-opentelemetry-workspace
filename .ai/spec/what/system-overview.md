# System Overview

Red Hat build of OpenTelemetry (RHOSDT) is a supported OpenTelemetry distribution for OpenShift. It provides a Kubernetes Operator that manages OpenTelemetry Collector instances and auto-instrumentation injection, backed by a curated subset of upstream collector components compiled with FIPS-compliant cryptography. The product is distributed via OLM (Operator Lifecycle Manager) on OpenShift.

## Behavioral Rules

### Product Identity

1. The product name is "Red Hat build of OpenTelemetry" (abbreviation: RHOSDT).
2. The Jira project key is TRACING on `redhat.atlassian.net`.
3. The product version tracks upstream OpenTelemetry Collector releases (e.g., RHOSDT 3.10 tracks collector 0.152.x).

### Signal Support

4. The product supports three telemetry signals: traces, metrics, and logs.
5. Profiles support is emerging upstream and not yet GA in the product.

### Deployment Model

6. The product is deployed on OpenShift via OLM.
7. The Operator manages collector instances, target allocators, and auto-instrumentation injection.
8. Collector instances can run in four modes: Deployment, DaemonSet, StatefulSet, and Sidecar.

### Protocol

9. The primary ingestion and export protocol is OTLP (OpenTelemetry Protocol).
10. The product also supports Jaeger, Zipkin, and Prometheus protocols for ingestion and export.

### Architecture Tiers

11. The product consists of four container images: Operator, Collector, Target Allocator, and OLM Bundle.
12. File-Based Catalogs (FBC) are generated per OpenShift version (4.12 through 4.22).
13. All container images support four architectures: amd64, arm64, ppc64le, s390x.

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

## Planned Changes

| Ticket | Summary |
|---|---|
