# Productization

The productization pipeline transforms upstream OpenTelemetry components into supported Red Hat product container images distributed via OLM on OpenShift. The pipeline is managed in `konflux-opentelemetry` using Konflux (Tekton-based) CI/CD.

## Behavioral Rules

### Build Pipeline

1. The `konflux-opentelemetry` repo uses git submodules to pin the `opentelemetry-operator` and `redhat-opentelemetry-collector` sources at specific product branches (e.g., `rhosdt-3.10`).
2. Konflux/Tekton pipelines build four container images: Operator, Collector, Target Allocator, and OLM Bundle.
3. All Go binaries are compiled with FIPS-compliant flags: `CGO_ENABLED=1 GOEXPERIMENT=strictfipsruntime -tags strictfipsruntime`.
4. The collector binary undergoes a FIPS check that verifies no non-FIPS crypto functions are present.
5. Container images are built as multi-architecture: amd64, arm64, ppc64le, s390x.
6. Base images are UBI 9 (ubi9/ubi and ubi9/ubi-micro), pinned by SHA digest.

### OLM Bundle

7. The bundle is generated from the upstream operator bundle with Red Hat-specific CSV patches applied via `patch_csv.py`.
8. CSV patches include: support metadata, categories, OLM annotations, FIPS compliance markers, skip ranges, and related images.
9. Image pullspecs in the CSV are substituted from `bundle.env`, supporting both staging and production registries.

### File-Based Catalogs (FBC)

10. Per-OpenShift-version catalogs are generated (v4.12 through v4.22).
11. `catalog-template.yaml` defines the complete version history for OLM channel resolution.
12. Konflux nudging auto-updates `catalog.env` with new bundle pullspecs after successful builds.

### Release Workflow

13. Application release: update git submodules to the target `rhosdt-<version>` branches, merge, and wait for Konflux builds.
14. Bundle release: update `patch_csv.yaml` with new version, skipRange, replaces, and image pullspecs.
15. Catalog release: Konflux nudging auto-updates `catalog.env`; manual fallback via `update-catalog.py`.

### RPM Packaging

16. The collector is also packaged as an RPM via packit, targeting Fedora and EPEL-9 on x86_64 and aarch64.
17. The RPM includes a systemd service file and SELinux policy for journald access.

## Configuration Surface

| File | Purpose |
|---|---|
| `konflux-opentelemetry/versions.sh` | Product version and minimum OCP version |
| `redhat-opentelemetry-collector/manifest.yaml` | Component selection for the collector distro |
| `konflux-opentelemetry/bundle-patch/patch_csv.yaml` | Red Hat-specific CSV overlay |
| `konflux-opentelemetry/bundle-patch/bundle.env` | Image pullspec substitutions |
| `konflux-opentelemetry/catalog/catalog-template.yaml` | OLM catalog version history |

## Constraints

1. Tekton push pipelines trigger only when relevant files change (e.g., operator push triggers on `Dockerfile.operator`, `opentelemetry-operator` submodule, or pipeline files).
2. Builds are hermetic with prefetch for Go modules and RPMs.
3. The minimum supported OpenShift version is defined in `versions.sh` (currently 4.12).
