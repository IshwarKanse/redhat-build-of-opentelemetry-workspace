# Build Pipeline

Builds run through ART on Konflux, in the tenant `art-rhosdt-tenant`. `ocp-build-data` says what to build and the product branches hold the source. Each operator minor version is an ART group, and the group name is the branch name in all three repositories (e.g., `rhosdt-0.158`).

## Module Map

Paths in `redhat-opentelemetry-collector`, `open-telemetry-opentelemetry-operator` and `ocp-build-data` are on the `rhosdt-<version>` branch.

| File/Directory | Key Symbols | Responsibility |
|---|---|---|
| `redhat-opentelemetry-collector/manifest.yaml` | — | Declarative component selection for the collector distro |
| `redhat-opentelemetry-collector/Makefile` | `build`, `generate-schemas`, `fips-check` | Downloads OCB, generates `_build/`, compiles binary, runs the FIPS check |
| `redhat-opentelemetry-collector/_build/` | `main.go`, `components.go` | OCB-generated Go source (committed) |
| `redhat-opentelemetry-collector/.obi-src` | — | OBI source, a submodule of `opentelemetry-ebpf-instrumentation` |
| `redhat-opentelemetry-collector/Dockerfile.art` | — | Collector image build, including the OBI eBPF generation |
| `open-telemetry-opentelemetry-operator/Dockerfile.art` | — | Operator image build |
| `open-telemetry-opentelemetry-operator/Dockerfile.ta.art` | — | Target Allocator image build |
| `open-telemetry-opentelemetry-operator/versions.txt` | — | Component versions injected via `-ldflags` at compile time |
| `open-telemetry-opentelemetry-operator/bundle/openshift/` | `bundle.Dockerfile` | OLM bundle: CSV, metadata, minimum OCP version |
| `open-telemetry-opentelemetry-operator/bundle/art.yaml` | `updates` | Downstream search and replace over the bundle |
| `open-telemetry-opentelemetry-operator/bundle/image-references` | — | Images whose pullspecs ART replaces in the CSV |
| `open-telemetry-opentelemetry-operator/bundle/opentelemetry-product.package.yaml` | `currentCSV` | Package and channel of the bundle |
| `fips-allowlist.yaml` (both source repositories) | `allow` | Reviewed non-FIPS crypto import chains |
| `ocp-build-data/group.yml` | `arches`, `konflux`, `OCP_TARGET_VERSIONS`, `version` | ART group: architectures, network mode, OCP range |
| `ocp-build-data/streams.yml` | — | Base and builder images |
| `ocp-build-data/images/*.yml` | `content.source`, `from`, `delivery` | One config per image: source and Dockerfile, `FROM` mapping, delivery repository |
| `ocp-build-data/releases.yml` | `assembly` | Assemblies and their shipment merge requests |
| `konflux-release-data/tenants-config/cluster/kflux-ocp-p01/tenants/art-rhosdt-tenant/` | `otel-integration-tests.yaml`, `otel-mintmaker.yaml` | Tenant config: release plans, integration test scenarios, MintMaker |
| `konflux-release-data/config/kflux-ocp-p01.7ayg.p1/product/ReleasePlanAdmission/art-rhosdt/` | `rhosdt-advisory-*`, `rhosdt-fbc-*` | Component to registry mapping, FBC package allow list |
| `hybrid-platforms/art/ocp-shipment-data`, `shipment/openshift-opentelemetry-operator/` | `shipment.snapshot`, `shipment.data.releaseNotes` | Shipped releases: image and FBC snapshots, release notes |

## Data Flow

```
manifest.yaml → OCB → _build/ (Go source) → Dockerfile.art ──────→ collector image
                                                                        ↓
operator source → Dockerfile.art, Dockerfile.ta.art ──→ operator, target allocator images
                                                                        ↓
bundle/openshift + art.yaml + image-references → doozer ─────────→ bundle image
                                                                        ↓
production index + new bundle → doozer, per OCP version ─────────→ FBC images
                                                                        ↓
integration tests, fix verification → release-from-fbc → shipment MR → trigger-prod-release → production
```

The builds run automatically after a merge to a product branch:

```
layered-products-scan → build-layered-products → olm-bundle-konflux → build-fbc (one per OCP version)
```

## Key Abstractions

**OCB (OpenTelemetry Collector Builder):** A code generator that reads `manifest.yaml` and produces a Go main package with all selected components registered. This is the only mechanism for adding/removing components from the distro.

**ART group:** The `rhosdt-<version>` branch of `ocp-build-data`. `images/*.yml` point at the source branches, through the `openshift-priv` mirrors, and `group.yml` applies to every image of the group. The group selects the Konflux applications `rhosdt-<version with dashes>` for the images and `fbc-rhosdt-<version with dashes>` for the catalogs.

**Rebase:** Before a build, doozer copies the source and rewrites each `FROM` line of the Dockerfile to the stream that `from` in the image config names for that position. The base images in the Dockerfile are therefore placeholders, and the number and the order of the `FROM` lines must match the image config.

**Hermetic builds:** `group.yml` sets `konflux.network_mode: hermetic` and enables cachi2. Go modules are prefetched (the collector lists its module paths in `cachito.packages.gomod`), and doozer generates the RPM lockfile from `enabled_repos`. The `_build/` directory being committed ensures reproducibility.

**Bundle patching:** The community OLM bundle stays in `bundle/openshift/`. `bundle/art.yaml` holds search and replace edits that doozer applies to the CSV and the annotations without forking the bundle generation. `{DATE_TIME}` in the edits becomes the build timestamp. Doozer replaces the pullspecs of the images in `bundle/image-references` and injects `spec.relatedImages`, so neither is edited by hand.

**FBC composition:** No repository of the product holds the version history. For each OCP version, `build-fbc` resets the catalog content to the package in the production Red Hat Operators index of that version, adds the new bundle to the channel and builds the image. The fragments are kept in `openshift-priv/art-fbc`.

**Automatic rebuilds:** `layered-products-scan` runs on a schedule and detects source changes with `doozer config:scan-sources`. It starts `build-layered-products`, which rebases and builds the changed images and starts `olm-bundle-konflux`. That pipeline builds the bundle, releases the related images to the stage registry and starts one `build-fbc` per entry in `OCP_TARGET_VERSIONS`. The scan also starts any bundle or FBC build that is missing.

## Integration Points

| Consumer | Provider | Mechanism |
|---|---|---|
| `redhat-opentelemetry-collector` | `opentelemetry-collector`, `opentelemetry-collector-contrib` | Go module dependencies in `manifest.yaml` |
| `redhat-opentelemetry-collector` | `opentelemetry-ebpf-instrumentation` | Git submodule `.obi-src` |
| ART pipelines | `open-telemetry-opentelemetry-operator`, `redhat-opentelemetry-collector` | `content.source.git` in `images/*.yml`, product branches through the `openshift-priv` mirrors |
| ART pipelines | `konflux-release-data` | Release plans and ReleasePlanAdmissions of `art-rhosdt-tenant` |
| Konflux integration tests | `distributed-tracing-qe` | Pipelines in `konflux/integration-tests`, scenarios in `otel-integration-tests.yaml` |
| `fips-check` CI jobs | `os-observability/konflux-opentelemetry` | `go install` of `tools/fips-check`, the only use of that repository in the build |
| `release-from-fbc`, `trigger-prod-release` | `hybrid-platforms/art/ocp-shipment-data` | Shipment merge request per assembly |
| OLM | FBC catalog images | Per-OCP catalog channel resolution |
| RPM repos (Fedora/EPEL) | `redhat-opentelemetry-collector/.packit.yaml` | packit SRPM builds |

## Implementation Notes

- The OCB version is pinned in the Makefile and must match the core collector version in `manifest.yaml`.
- `Dockerfile.art` of the collector generates the OBI eBPF artifacts in a `ubi9/ubi` stage with clang from the RHEL 9.8 repositories. The clang of the golang builder image produces an eBPF program that the verifier of the RHEL 5.14 kernel rejects.
- Multi-arch builds target amd64, arm64, ppc64le, s390x, from `arches` and `konflux.arches` in `group.yml`. The architecture labels of the CSV are in `bundle/art.yaml`. An image config can narrow the list with its own `arches`; doozer builds the intersection with the group.
- The `fips-check` CI jobs run the `--module` check only. The `--binary` check is disabled because the OpenShift CI builder image wraps `go` and overrides `GOFIPS140`.
- The file name of an image config must match the Konflux component name in the ReleasePlanAdmissions, without the group prefix (`opentelemetry-collector.yml` is `rhosdt-0-158-opentelemetry-collector`).
- On the build side, a new OCP version is an entry in `OCP_TARGET_VERSIONS`; the FBC ReleasePlanAdmissions template the index with `{{ OCP_VERSION }}`. The integration test scenarios and the CI matrix are reviewed separately (`/otel-qe-prepare-ci`).
- The release plans and ReleasePlanAdmissions carry the version in their names (`rhosdt-advisory-prod-0-158`), so a new ART group needs new ones. The ART team also lists the group in `aos-cd-jobs` and `art-tools`.
