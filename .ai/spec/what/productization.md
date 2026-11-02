# Productization

The productization pipeline transforms upstream OpenTelemetry components into supported Red Hat product container images distributed via OLM on OpenShift. Builds and releases run through ART: `ocp-build-data` holds the build configuration, the product branches of `open-telemetry-opentelemetry-operator` and `redhat-opentelemetry-collector` hold the source, and the pipelines run on Konflux in the tenant `art-rhosdt-tenant`.

## Behavioral Rules

### Build Pipeline

1. Each operator minor version has an ART group `rhosdt-<version>` (e.g., `rhosdt-0.158`): a branch of that name in `ocp-build-data` and in both source repositories.
2. ART builds four container images: Operator, Collector, Target Allocator, and OLM Bundle.
3. All Go binaries are compiled with the Go FIPS module: `CGO_ENABLED=0 GOFIPS140=certified`, and the images set `GODEBUG=fips140=auto`. The Operator and the Target Allocator also build with `-tags no_openssl`.
4. A `fips-check` CI job on the product branches of both source repositories fails on a non-FIPS crypto import that is not reviewed and listed in `fips-allowlist.yaml`.
5. Container images are built as multi-architecture: amd64, arm64, ppc64le, s390x.
6. Runtime base images are UBI 9 (`ubi9/ubi-micro`). ART takes the base and builder images from the streams of the ART group and replaces the `FROM` lines of the Dockerfile at rebase time.
7. A merge to a product branch needs no manual step to build: ART detects the source change and rebuilds the changed images, the bundle and the FBC catalogs.

### OLM Bundle

8. The bundle is generated from the community bundle in `bundle/openshift/` on the product branch, with the downstream edits in `bundle/art.yaml` applied at build time.
9. The edits set the package `opentelemetry-product`, the channel `stable`, support metadata, subscription and infrastructure annotations, architecture labels, Red Hat branding, `RELATED_IMAGE_*` variables, and the operator argument `--fips-disabled-components=extension.oidc`.
10. The CSV name and version carry the build timestamp (`opentelemetry-operator.v0.158.0-<timestamp>`). Upgrades use `olm.skipRange`; the CSV has no `replaces`.
11. ART replaces the image pullspecs listed in `bundle/image-references` and injects `spec.relatedImages`. The bundle references `registry.redhat.io/rhosdt/*` by digest, and those images exist only on `registry.stage.redhat.io` until the release is published.

### File-Based Catalogs (FBC)

12. One FBC image is built per OpenShift version in `OCP_TARGET_VERSIONS` (4.12 through 5.0).
13. Each FBC build starts from the `opentelemetry-product` package in the production Red Hat Operators index of that OpenShift version and adds the new bundle, so the production index is the version history.
14. Konflux integration tests run on every FBC build, in the application `fbc-rhosdt-<version with dashes>`.

### Release Workflow

15. Patch and CVE fix release: a new build of the existing `rhosdt-<version>` branch, with no bundle or ART configuration changes.
16. Major or minor release: new `rhosdt-<version>` branches in the source repositories, a new branch in `ocp-build-data` requested from the ART team, updated versions in `group.yml` and in the bundle files, moved pre-merge CI, new integration test scenarios, and new release plans and MintMaker configuration in `konflux-release-data`.
17. The `release-from-fbc` pipeline creates a shipment merge request in `hybrid-platforms/art/ocp-shipment-data` and releases the images to stage again so that the Conforma checks run. After the merge request is approved, `trigger-prod-release` releases to the production registry.
18. A release is an assembly of the ART group, named after the operator version (e.g., `0.158.4`). The advisory states the product version it maps to (operator 0.158.4 shipped as RHOSDT 3.11.4).
19. Released images are tagged with the version in `group.yml`, not the assembly: `v0.158.0` and `v0.158.0-<n>` (assembly 0.158.4 is `v0.158.0-3`).
20. Only the latest version is supported and tested.

### Dependency Updates

21. MintMaker runs on the product branches, from the `otel-mintmaker` components in `art-rhosdt-tenant`.

### RPM Packaging

22. The collector is also packaged as an RPM via packit, targeting Fedora and EPEL-9 on x86_64 and aarch64.
23. The RPM includes a systemd service file and SELinux policy for journald access.

## Configuration Surface

Files in `ocp-build-data` and the source repositories are on the `rhosdt-<version>` branch.

| File | Purpose |
|---|---|
| `ocp-build-data/group.yml` | Group version, architectures, network mode, `OCP_TARGET_VERSIONS` |
| `ocp-build-data/streams.yml` | Base and builder images |
| `ocp-build-data/images/*.yml` | Per-image source, Dockerfile, `FROM` mapping, delivery repository |
| `ocp-build-data/releases.yml` | Assemblies and their shipment merge requests |
| `redhat-opentelemetry-collector/manifest.yaml` | Component selection for the collector distro |
| `open-telemetry-opentelemetry-operator/bundle/art.yaml` | Red Hat-specific CSV and annotation edits |
| `open-telemetry-opentelemetry-operator/bundle/image-references` | Images whose pullspecs ART replaces in the CSV |
| `open-telemetry-opentelemetry-operator/bundle/opentelemetry-product.package.yaml` | Package, channel and current CSV |
| `open-telemetry-opentelemetry-operator/bundle/openshift/bundle.Dockerfile` | Minimum OpenShift version (`com.redhat.openshift.versions`) |
| `fips-allowlist.yaml` (both source repositories) | Reviewed non-FIPS crypto import chains |
| `konflux-release-data`, `art-rhosdt-tenant/otel-integration-tests.yaml` | Konflux integration test scenarios |
| `konflux-release-data`, `art-rhosdt-tenant/otel-mintmaker.yaml` | MintMaker components |

## Constraints

1. Changes in `ocp-build-data` go through a pull request approved by the ART team.
2. Builds are hermetic: Go modules and RPMs are prefetched.
3. The minimum supported OpenShift version is defined in `bundle/openshift/bundle.Dockerfile` (currently 4.12, the lowest entry in `OCP_TARGET_VERSIONS`).
4. The number and the order of the `FROM` lines in a Dockerfile must match the image config in `ocp-build-data`.
