## CI Jobs in Release Repository

The OpenShift CI jobs for OpenTelemetry stage testing are defined in the `release` repository:

**Location:** `ci-operator/config/openshift/open-telemetry-opentelemetry-operator/`

**File naming pattern:**
```
openshift-open-telemetry-opentelemetry-operator-main__opentelemetry-product-ocp-{VERSION}[-{VARIANT}]-stage.yaml
```
The `-{VARIANT}` segment is omitted entirely for Regular (e.g. `...ocp-4.19-stage.yaml`, not `...ocp-4.19--stage.yaml`).

**Examples:**
- `openshift-open-telemetry-opentelemetry-operator-main__opentelemetry-product-ocp-4.19-stage.yaml`
- `openshift-open-telemetry-opentelemetry-operator-main__opentelemetry-product-ocp-4.22-fips-stage.yaml`
- `openshift-open-telemetry-opentelemetry-operator-main__opentelemetry-product-ocp-4.14-arm-stage.yaml`
- `openshift-open-telemetry-opentelemetry-operator-main__opentelemetry-product-ocp-4.22-ui-stage.yaml`

**List all stage test configs:**
```bash
ls release/ci-operator/config/openshift/open-telemetry-opentelemetry-operator/*stage.yaml
```

**Variants:**
- **Regular:** `ocp-4.XX-stage.yaml` - Standard x86_64 tests
- **FIPS:** `ocp-4.XX-fips-stage.yaml` - FIPS-enabled clusters
- **ARM:** `ocp-4.XX-arm-stage.yaml` - ARM64 architecture tests. Installs the operator the same way as the other variants (the multi-arch ART FBC through the `distributed-tracing-install-otel-konflux-catalogsource` step and `install-operators`).

- **UI:** `ocp-4.XX-ui-stage.yaml` - the OpenShift console UI test of the OpenTelemetry Collector dashboard (Playwright, started by a Chainsaw test). It installs only the OTEL operator and runs `distributed-tracing-tests-opentelemetry-ui-stage`, which takes `tests/e2e-otel-ui` from the same `rhosdt-<operator version>` branch (for example `rhosdt-0.158`). It exists for 4.22 only. Its test is also named `opentelemetry-stage-tests`, so the job name follows the pattern below with `{VARIANT}` = `ui`.

**What each stage config pins:** `MULTISTAGE_PARAM_OVERRIDE_OTEL_INDEX_IMAGE` is the ART FBC for that OCP version (`quay.io/redhat-user-workloads/ocp-art-tenant/art-fbc@sha256:…`), and `MULTISTAGE_PARAM_OVERRIDE_OTEL_TESTS_BRANCH` is the `rhosdt-<operator version>` branch of `openshift/open-telemetry-opentelemetry-operator` (for example `rhosdt-0.158`) that the test step clones. Tempo comes from `redhat-operators`.

**Job naming pattern:**
```
periodic-ci-openshift-open-telemetry-opentelemetry-operator-main-opentelemetry-product-ocp-{VERSION}-{VARIANT}-stage-opentelemetry-stage-tests
```

**Disconnected test job:** lives in a different project directory in the same `release` repo, not the one above — `ci-operator/config/openshift/distributed-tracing-qe/openshift-distributed-tracing-qe-main__ocp-4.16-disconnected.yaml`, job name `periodic-ci-openshift-distributed-tracing-qe-main-ocp-4.16-disconnected-distributed-tracing-tests-disconnected`. Its `MULTISTAGE_PARAM_OVERRIDE_OTEL_INDEX_IMAGE` is updated to the 4.16 ART FBC digest like the other configs, and it is part of the same PR, just a different file. That job has not been run with an ART catalog yet, so check its first rehearsal closely. Unlike the stage jobs it still takes Tempo from an IIB (`MULTISTAGE_PARAM_OVERRIDE_TEMPO_INDEX_IMAGE`), which only changes when a Tempo stage release is under test. Its `cron: 0 0 30 2 *` (an impossible date) is intentional: every one of these jobs is on-demand only, triggered via `/pj-rehearse` or Gangway, never on a schedule.

## Pre-merge jobs for the product branch (`rhosdt-<version>`, for example `rhosdt-0.158`)

Pull requests to `rhosdt-<version>` of `openshift/open-telemetry-opentelemetry-operator` run a fast critical e2e job before merging. It runs on every PR and is required to merge. The full e2e, DAST and upgrade tests run in the Konflux integration tests. Only the supported branch has these jobs; the config moves to the new branch with each new ART group (see `otel-qe-prepare-ci`).

**Config:** `ci-operator/config/openshift/open-telemetry-opentelemetry-operator/openshift-open-telemetry-opentelemetry-operator-rhosdt-<version>__art-build-ocp-<ocp-version>.yaml`. It builds the operator, target allocator, OLM bundle and test runner images and defines the `e2e-pre-merge` test. The jobs are `pull-ci-openshift-open-telemetry-opentelemetry-operator-rhosdt-<version>-art-build-ocp-<ocp-version>-{images,ci-bundle-opentelemetry-bundle,e2e-pre-merge}`.

**`e2e-pre-merge`:** claims a cluster from the observability hive pool `obs-ocp-<x>-<y>-0-amd64-aws-us-east-2` (for example `obs-ocp-4-22-0-amd64-aws-us-east-2` for OCP 4.22), installs the operator from the bundle built in the run, and runs the chainsaw tests listed in `TEST_DIRS` and `SIDECAR_TEST_DIRS` of the step `distributed-tracing/tests/opentelemetry/premerge/` from the PR source. The tests run as they are in the pull request, without the modifications of `/otel-qe-prepare-operator-tests`.

**OCP version:** `<ocp-version>` is the latest stable OCP version that has an observability pool, and the config, the jobs and the claim all use it. When a pool for a newer stable version exists, migrate to it.

**Collector image:** the job uses `ci/redhat-opentelemetry-collector:redhat-otel-collector`, promoted by the `rhosdt-<version>` postsubmit of `openshift/redhat-opentelemetry-collector`. The tag is static. A postsubmit runs only on a push to the branch; to run it without a push, trigger `branch-ci-openshift-redhat-opentelemetry-collector-rhosdt-<version>-images` through gangway.

**Rehearsal:** `/pj-rehearse pull-ci-openshift-open-telemetry-opentelemetry-operator-rhosdt-<version>-art-build-ocp-<ocp-version>-e2e-pre-merge` on a PR to `release`. `NoClusters: No clusters in pool are ready to be claimed` in the log means the hive pool is empty, not that the job is broken.
