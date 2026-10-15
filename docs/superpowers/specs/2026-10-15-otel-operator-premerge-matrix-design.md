# Design: OTEL operator stage matrix as on-demand pre-merge jobs on `rhosdt-0.158`

**Date:** 2026-10-15
**Status:** Approved design, implementation in progress
**Repos:** `openshift/release`, `rhobs/redhat-build-of-opentelemetry-workspace` (skills and specs)

## Summary

The OCP CI stage periodics of the OpenTelemetry operator (11 configs on `main` of `openshift/release`, FBC pinned by digest, runnable only by `/pj-rehearse` on a release-repo PR) are replaced by optional presubmits on the product branch `rhosdt-0.158`. The presubmits build the operator, the target allocator and the bundle from the pull request, install them with `operator-sdk run bundle` and run the full chainsaw suite on one OpenShift version each, including an arm64 job. They are triggered with `/test <job>` on a pull request. The shipped artifact (the ART FBC) stays covered by the Konflux integration test scenarios (ITS), which run on every FBC build.

## The three layers of product testing

| Layer | Where | What is tested | When |
|---|---|---|---|
| Pre-merge, critical | `release`: config `...-rhosdt-0.158__art-build.yaml`, test `e2e-pre-merge` | CI build of `Dockerfile.art`, `Dockerfile.ta.art` and `bundle/openshift` from the PR; the promoted collector image; the critical chainsaw subset on a claimed OCP 4.22 cluster | every PR to `rhosdt-0.158`, required |
| Pre-merge, matrix | same config, tests `e2e-ocp-<version>[-fips\|-arm64]`, `e2e-ui-ocp-<version>` | the same build, the full chainsaw suite (plus sidecar, metadata filters, TLS profile batches, or the console UI test) on one OCP version and variant each | `/test` on a PR, optional |
| Konflux ITS | `art-rhosdt-tenant`, application `fbc-rhosdt-0-158`; pipelines in `distributed-tracing-qe/konflux/integration-tests/` | the ART FBC (doozer-rebased bundle, relatedImages, stage registry): full suite on OCP 4.14 and 4.22 with RapiDAST, upgrade test on 4.22 | every FBC build, automatic |
| Downstream periodics | `release`: `...-main__opentelemetry-product-ocp-<version>-downstream.yaml` | the released product from `redhat-operators` | weekly |

The stage periodics and the Gangway trigger of TRACING-6901 are removed. The disconnected job of `distributed-tracing-qe` is no longer part of the OTEL flow (`otel-qe-verify-disconnected-mirroring` covers the mirroring check); its config stays because Tempo uses it.

## Design

### One config, many tests

All jobs are `tests:` entries of one config, `ci-operator/config/openshift/open-telemetry-opentelemetry-operator/openshift-open-telemetry-opentelemetry-operator-rhosdt-0.158__art-build.yaml` (renamed from `...__art-build-ocp-4.22.yaml`, variant `art-build`). One file because every variant file with `images:` emits an always-run `-images` presubmit; several files would build the operator several times on every MintMaker PR.

- A claim entry picks its OpenShift version with `cluster_claim.version` (and `labels: {variant: fips, region: us-east-1}` for the FIPS pools of the `obs` owner).
- Every entry is a hive claim. The `obs` pools cover the amd64 and FIPS versions; the shared `openshift-ci` pools cover arm64 (4.18) and the next stream (4.23). An IPI entry on an observability cluster profile is possible for a version without any pool, but its payload and installer must be the same version (the installer comes from `releases.latest`, `OPENSHIFT_INSTALL_RELEASE_IMAGE_OVERRIDE` only changes the payload), so a claim is preferred.
- `base_images.cli` and `releases.latest` stay 4.22; claims ignore them.
- `images`: `opentelemetry-operator-art` and `opentelemetry-target-allocator-art` get `additional_architectures: [arm64]`; `obs-ui-tests-runner` (playwright-base plus the PR source) is added for the UI test; `obs-tests-runner` stays amd64, it runs on the build cluster.
- The collector config `openshift-redhat-opentelemetry-collector-rhosdt-0.158.yaml` builds `additional_architectures: [arm64]` too, so the promoted tag `ci/redhat-opentelemetry-collector:redhat-otel-collector` is a manifest list. The arm64 job passes only after the first collector postsubmit promotion that follows the merge.

### Matrix

| Test | Cluster | Suite |
|---|---|---|
| `e2e-pre-merge` (always run, required) | claim obs 4.22 | critical subset |
| `e2e-ocp-4-12` | claim obs 4.12 | full |
| `e2e-ocp-4-16` | claim obs 4.16 | full |
| `e2e-ocp-4-18-arm64` | claim openshift-ci 4.18 arm64 pool | full |
| `e2e-ocp-4-20-fips` | claim obs 4.20 FIPS pool, `tls-scanner-run` with the post-quantum check | full |
| `e2e-ocp-4-21` | claim obs 4.21 | full |
| `e2e-ui-ocp-4-22` | claim obs 4.22 | `tests/e2e-otel-ui` |
| `e2e-ocp-4-23` | claim openshift-ci 4.23 pool | full |
| `e2e-ocp-5-0` | claim obs 5.0 | full |

Why these versions: 4.12 is the floor of the bundle (`com.redhat.openshift.versions=v4.12`, ImageContentSourcePolicy only), native sidecars start at 4.16, 4.18 and 4.20 are the EUS versions in full support and carry the arm64 and FIPS variants (FIPS on 4.20 because its TLS scanner run includes the post-quantum check, which needs a recent OpenShift), 4.21 is a plain run, 4.22 is the current GA and only carries the critical job and the UI test (the ITS run the full suite on the 4.22 FBC), 4.23 and 5.0 are the next streams. 4.19/4.20/4.21 do not differ from 4.16 and 4.22 in anything the operator uses, so one of them is enough. Each entry's `SKIP_TESTS` and `OPERATORS` list come from the stage config of the same version where one existed. Moving a variant to another version or switching an entry between claim and IPI is a one-line change.

### Steps

- `distributed-tracing-tests-opentelemetry-premerge` is extended, not forked: `timeout` 3h30m, env `TEST_SUITE` (`critical` by default, `full` in the matrix entries), `SUITES_FILE` (`tests/ci-suites.yaml`) and `SKIP_TESTS`. The suites are defined in the product repository, in `tests/ci-suites.yaml` of the pull request under test, as batches of chainsaw test directories with an optional sidecar selector and optional environment variables to set on the operator before the batch (the metadata filters batch), so that a test directory that is added, renamed or removed is updated in the same pull request as the tests; a missing file, suite or directory fails the job. Nothing in `release` lists test directories any more. The tests come from the PR source baked into `obs-tests-runner`.
- `distributed-tracing-tests-opentelemetry-ui-premerge` is new: the UI stage step running from `obs-ui-tests-runner` with the tests of the PR instead of a cloned branch.
- `distributed-tracing-tests-opentelemetry-stage` and `distributed-tracing-tests-opentelemetry-ui-stage` are deleted with the stage configs. `distributed-tracing-install-otel-konflux-catalogsource` stays (Tempo uses it).

### Triggering and naming

Every matrix entry has `always_run: false` and `optional: true`. Test names carry the OpenShift version with a dash (`e2e-ocp-4-21`) because ci-operator forbids dots in them. Job `pull-ci-openshift-open-telemetry-opentelemetry-operator-rhosdt-0.158-art-build-e2e-ocp-4-21`, check `ci/prow/art-build-e2e-ocp-4-21`, trigger `/test art-build-e2e-ocp-4-21`. Several jobs go on one `/test` line; `/test all` does not run them; `/test ?` lists them.

Release testing needs a pull request as the vehicle: the test-preparation PR of `otel-qe-prepare-operator-tests` (its tests are what the matrix runs), or a no-op PR for a point release.

### Release checks by role

| Release | ART team | Product team |
|---|---|---|
| Major, minor (new `rhosdt-*` branch, new ART group) | the ITS of the FBC builds being released passed | run the matrix on the vehicle PR until every job defined in the config passes; check the ITS; the release-testing Epic holds the rest (IBM P/Z, docs, CVE and bug fixes) |
| Patch, CVE fix (same branch) | the ITS passed | check the ITS; no Epic |

## Skills

- `otel-qe-ocp-ci-tests`: the pre-merge matrix flow (vehicle PR, `/test`, `gh pr checks`, artifact and history URLs of presubmits, final table from the check runs of the PR); the FBC, release-PR, `pj-rehearse` and disconnected steps are removed.
- `otel-qe-prepare-ci`: the config name carries no OCP version; the matrix entries are reviewed for the versions still supported; the collector config keeps `additional_architectures`.
- `otel-qe-release-testing-epic`: no OCP range; Task 1 requires every job defined in the config to pass on the vehicle PR; the Epic is for major and minor releases only.
- `otel-qe-prepare-operator-tests`: the prep PR is where the matrix runs; it carries `tests/ci-suites.yaml` to every product branch.
- `otel-art-reference/RELEASE.md`: the release checks by role above.
- `.ai/spec/how/product-ci-testing.md`: the layers table for agents.

## Out of scope

An observability arm64 hive pool; IBM P and Z (`otel-qe-test-ibm`); the Tempo stage jobs; the disconnected job config; the ITS pipelines.
