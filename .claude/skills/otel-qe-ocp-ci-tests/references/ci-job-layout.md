# CI jobs of the product branch in `openshift/release`

All OpenShift CI jobs of the OpenTelemetry operator product branch `rhosdt-<version>` are in one config of the `release` repository:

```
ci-operator/config/openshift/open-telemetry-opentelemetry-operator/openshift-open-telemetry-opentelemetry-operator-rhosdt-<version>__art-build.yaml
```

The variant is `art-build`: the images are built from the ART Dockerfiles of the branch (`Dockerfile.art`, `Dockerfile.ta.art`, `bundle/openshift`). The file name carries no OpenShift version; every e2e test picks its own (`fips-check` runs without a cluster). With each new ART group the config moves to the new branch, or is copied while the previous version still has CVE or patch releases (`/otel-qe-prepare-ci`); pick the config of the branch under test.

The generated jobs are in `ci-operator/jobs/openshift/open-telemetry-opentelemetry-operator/openshift-open-telemetry-opentelemetry-operator-rhosdt-<version>-presubmits.yaml`, named `pull-ci-openshift-open-telemetry-opentelemetry-operator-rhosdt-<version>-art-build-<test>`, with the check `ci/prow/art-build-<test>` and the trigger `/test art-build-<test>`.

## What the config builds

| Pipeline image | From | Used by |
|---|---|---|
| `opentelemetry-operator-art` | `Dockerfile.art` of the PR, amd64 and arm64 | the bundle (substituted for the upstream operator image) |
| `opentelemetry-target-allocator-art` | `Dockerfile.ta.art` of the PR, amd64 and arm64 | `RELATED_IMAGE_TARGET_ALLOCATOR` |
| `opentelemetry-bundle` | `bundle/openshift` of the PR | `operator-sdk run bundle` in the `install` step |
| `obs-tests-runner` | `tests/e2e-openshift/Dockerfile` of the PR (chainsaw, oc, the repository in `/tmp/opentelemetry-operator`) | the e2e test step |
| `obs-ui-tests-runner` | `playwright-base` plus the repository in `/tmp/opentelemetry-operator` | the console UI test step |
| `opentelemetry-collector` | not built here: the base image `ci/redhat-opentelemetry-collector:<tag>`, promoted by the `rhosdt-<version>` postsubmit of `openshift/redhat-opentelemetry-collector` (the tag: "Promoting the collector image") | `RELATED_IMAGE_COLLECTOR` |

To pull one of these images locally, see `/otel-openshift-ci` (`references/images.md`): "Pipeline images" for the ones built here, "Promoted images" for the collector.

## Promoting the collector image

Each branch has its own collector tag, `rhosdt-<version>`, and the operator config of the branch reads it; the only exception is `rhosdt-0.158` (`redhat-otel-collector`), a note that goes when its configs are removed. A new operator config reads the previous branch's tag until step 8 of `/otel-qe-prepare-ci` switches it. The `rhosdt-<version>` postsubmit of `openshift/redhat-opentelemetry-collector` (`branch-ci-openshift-redhat-opentelemetry-collector-rhosdt-<version>-images`) writes it, but only on a push to the collector branch. The collector config builds amd64 and arm64, so the tag is a manifest list once that postsubmit ran after the arm64 build was added; before that, the arm64 job fails at the collector pods. To run the postsubmit without a push, trigger it through gangway (`oc` logged in to `app.ci`, see `/otel-openshift-ci`):

```bash
VERSION=<version>   # without the rhosdt- prefix
SHA=$(gh api repos/openshift/redhat-opentelemetry-collector/commits/rhosdt-${VERSION} -q .sha)
printf 'Authorization: Bearer %s\n' "$(oc whoami -t)" | curl -s -X POST -H @- -H 'Content-Type: application/json' \
  https://gangway-ci.apps.ci.l2s4.p1.openshiftapps.com/v1/executions \
  -d "{\"job_name\":\"branch-ci-openshift-redhat-opentelemetry-collector-rhosdt-${VERSION}-images\",\"job_execution_type\":\"2\",\"refs\":{\"org\":\"openshift\",\"repo\":\"redhat-opentelemetry-collector\",\"base_ref\":\"rhosdt-${VERSION}\",\"base_sha\":\"${SHA}\"}}"
```

The reply carries the execution id and the status `TRIGGERED`; gangway does not report progress. Follow the run with the `get_prow_job_history` tool of the openshift-ci MCP server (`/otel-openshift-ci`), job `branch-ci-openshift-redhat-opentelemetry-collector-rhosdt-${VERSION}-images` with `job_type: postsubmit` (for the first run on a new branch, an error that `latest-build.txt` does not exist means the run has not started uploading yet: try again in a minute): it takes about ten minutes, and `SUCCESS` means the image was promoted to its tag.

## The tests

The config is the list of jobs; the OpenShift version, architecture and variant of each e2e job are in its `cluster_claim` and, except for `e2e-pre-merge`, in the test name, and the versions change with every release (`/otel-qe-prepare-ci`). List them:

```bash
CONFIG=release/ci-operator/config/openshift/open-telemetry-opentelemetry-operator/openshift-open-telemetry-opentelemetry-operator-rhosdt-<version>__art-build.yaml
yq '.tests[] | [.as, (.optional // false), (.cluster_claim.version // "-"), (.cluster_claim.owner // "-")] | @tsv' "$CONFIG"
```

Two tests run on every PR and are required: `e2e-pre-merge`, the critical subset of the suite (`RUN_TESTS`) on a claim of the current GA version, and `fips-check`, which has no cluster claim and checks the Go module against a FIPS allowlist. The tests that set `optional: true` are `/test` jobs: `e2e-ocp-<x>-<y>` runs the full suite; the `-arm64` and `-fips` variants run it minus an arm64 or FIPS skip list (the FIPS job claims a pool with `variant: fips` and runs `tls-scanner-run` with `PQC_CHECK` first); `e2e-ui-ocp-<x>-<y>` runs only `tests/e2e-otel-ui/collector-dashboard` (Playwright, started by Chainsaw). Every e2e job claims its cluster from a hive pool (see "Changing the matrix"); `fips-check` runs in a container and claims none.

The optional tests have `always_run: false` and `optional: true`: they start only with `/test`, and a failure does not block the merge. The rerun and abort rules are in Step 3 of `SKILL.md`.

**A job either names the tests to run or the tests to skip.** `e2e-pre-merge` sets `RUN_TESTS`, the exact list of its critical test directories; the matrix jobs set `SKIP_TESTS`, the directories (globs allowed) removed from the full suite of the step (`FULL_SUITE` in `distributed-tracing-tests-opentelemetry-premerge-commands.sh`). The tests run in one chainsaw invocation with the selector `sidecar!=legacy` (OpenShift 4.16 and later) or `sidecar!=native` (older), which keeps the sidecar variant of the cluster and every unlabeled test. Two directories run on their own after the rest, in this order: `tests/e2e-metadata-filters`, after `ANNOTATIONS_FILTER` and `LABELS_FILTER` were set on the operator, and `tests/e2e-openshift-tls-profile` last, because it changes the cluster-wide TLS profile and the MachineConfig rollout would disrupt other tests. A directory of `RUN_TESTS` that does not exist fails the job; a suite directory renamed on the branch is updated in the step's full suite list.

Every full-suite test runs: the `install` step (`operator-sdk run bundle` in `opentelemetry-operator-system`), `install-operators` with the `OPERATORS` list of the test (Tempo and AMQ Streams everywhere; the Cluster Observability Operator, Loki and Logging where the catalog of that OpenShift version has them), then `distributed-tracing-tests-opentelemetry-premerge` with the `SKIP_TESTS` of that version, and the `openshift-observability-qe-agent` post step (`AGENT_SKILL: otel`, `JIRA_PROJECT: TRACING`; `otel-ui` and `OOC` for the UI test). The tests run as they are in the pull request: the modifications of `/otel-qe-prepare-operator-tests` count once they are in the PR or on the branch.

The step checks that the installed operator is the image built from the PR and patches `RELATED_IMAGE_COLLECTOR` and `RELATED_IMAGE_TARGET_ALLOCATOR` into the CSV; the metadata filter variables are patched the same way. Step files: `ci-operator/step-registry/distributed-tracing/tests/opentelemetry/premerge/` and `.../opentelemetry-ui/premerge/`.

## Changing the matrix

- Another OpenShift version for a test: change `cluster_claim.version` and rename the test (`e2e-pre-merge` keeps its name). Test names cannot contain dots, so the version is written `4-21`. The `obs` pools are in `clusters/hosted-mgmt/hive-pools-openshift-observability/` (amd64, arm64 and FIPS; FIPS pools carry `variant: fips`); the shared `openshift-ci` pools in `clusters/hosted-mgmt/hive-pools-openshift-ci/` can cover a version the `obs` pools do not have, and other repositories claim them too.
- A version without any hive pool: an IPI test on `aws-observability`, `azure-observability` or `gcp-observability`. Its payload and the `openshift-install` binary must be the same version: the installer comes from `releases.latest`, so an IPI test of another version needs `latest` set to that version, not only `OPENSHIFT_INSTALL_RELEASE_IMAGE_OVERRIDE`. Prefer a claim.
- Tests to run or skip on one version: `RUN_TESTS` or `SKIP_TESTS` of that test (the model is described above).
- Regenerate with `CONTAINER_ENGINE=podman make ci-operator-config jobs registry-metadata` and validate on the release PR with `/pj-rehearse pull-ci-openshift-open-telemetry-opentelemetry-operator-rhosdt-<version>-art-build-<test>`.

## Other jobs of the operator

- **`main`** has two configs. `...-main__upstream.yaml` builds the upstream operator from the PR (default collector, no collector built) and is laid out like `art-build`: `upstream-e2e-pre-merge` is required and runs the critical tests, and the other `upstream-*` tests (the full suite per OpenShift version, and the console UI test) are optional `/test` jobs on claimed clusters (check `ci/prow/upstream-<test>`). Its step is `distributed-tracing-tests-opentelemetry-upstream`, which takes `RUN_TESTS` or `SKIP_TESTS` like the premerge step and clones `tests/e2e-otel` from `distributed-tracing-qe`. `...-main__periodics.yaml` only runs the weekday rebasebot job. They are not part of release testing.
- The disconnected job of `distributed-tracing-qe` is not part of the OTEL release testing; `/otel-qe-verify-disconnected-mirroring` covers the mirroring check.
