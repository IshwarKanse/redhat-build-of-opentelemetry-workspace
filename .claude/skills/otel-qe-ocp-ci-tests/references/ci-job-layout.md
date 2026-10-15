# CI jobs of the product branch in `openshift/release`

All OpenShift CI jobs of the OpenTelemetry operator product branch `rhosdt-<version>` (for example `rhosdt-0.158`) are in one config of the `release` repository:

```
ci-operator/config/openshift/open-telemetry-opentelemetry-operator/openshift-open-telemetry-opentelemetry-operator-rhosdt-<version>__art-build.yaml
```

The variant is `art-build`: the images are built from the ART Dockerfiles of the branch (`Dockerfile.art`, `Dockerfile.ta.art`, `bundle/openshift`). The file name carries no OpenShift version; every test picks its own. Only the supported branch has the config; it moves to the new branch with each new ART group (`otel-qe-prepare-ci`).

The generated jobs are in `ci-operator/jobs/openshift/open-telemetry-opentelemetry-operator/openshift-open-telemetry-opentelemetry-operator-rhosdt-<version>-presubmits.yaml`, named `pull-ci-openshift-open-telemetry-opentelemetry-operator-rhosdt-<version>-art-build-<test>`, with the check `ci/prow/art-build-<test>` and the trigger `/test art-build-<test>`.

## What the config builds

| Pipeline image | From | Used by |
|---|---|---|
| `opentelemetry-operator-art` | `Dockerfile.art` of the PR, amd64 and arm64 | the bundle (substituted for the upstream operator image) |
| `opentelemetry-target-allocator-art` | `Dockerfile.ta.art` of the PR, amd64 and arm64 | `RELATED_IMAGE_TARGET_ALLOCATOR` |
| `opentelemetry-bundle` | `bundle/openshift` of the PR | `operator-sdk run bundle` in the `install` step |
| `obs-tests-runner` | `tests/e2e-openshift/Dockerfile` of the PR (chainsaw, oc, the repository in `/tmp/opentelemetry-operator`) | the e2e test step |
| `obs-ui-tests-runner` | `playwright-base` plus the repository in `/tmp/opentelemetry-operator` | the console UI test step |
| `opentelemetry-collector` | not built here: the base image `ci/redhat-opentelemetry-collector:redhat-otel-collector`, promoted by the `rhosdt-<version>` postsubmit of `openshift/redhat-opentelemetry-collector` | `RELATED_IMAGE_COLLECTOR` |

## Promoting the collector image

The collector tag is static: the `rhosdt-<version>` postsubmit of `openshift/redhat-opentelemetry-collector` (`branch-ci-openshift-redhat-opentelemetry-collector-rhosdt-<version>-images`) writes it, but only on a push to the collector branch. The collector config builds amd64 and arm64, so the tag is a manifest list once that postsubmit ran after the arm64 build was added; before that, the arm64 job fails at the collector pods. To run the postsubmit without a push, trigger it through gangway (`oc` logged in to `app.ci`, see [browsing-artifacts.md](browsing-artifacts.md)):

```bash
VERSION=<version>   # e.g. 0.158
SHA=$(gh api repos/openshift/redhat-opentelemetry-collector/commits/rhosdt-${VERSION} -q .sha)
printf 'Authorization: Bearer %s\n' "$(oc whoami -t)" | curl -s -X POST -H @- -H 'Content-Type: application/json' \
  https://gangway-ci.apps.ci.l2s4.p1.openshiftapps.com/v1/executions \
  -d "{\"job_name\":\"branch-ci-openshift-redhat-opentelemetry-collector-rhosdt-${VERSION}-images\",\"job_execution_type\":\"2\",\"refs\":{\"org\":\"openshift\",\"repo\":\"redhat-opentelemetry-collector\",\"base_ref\":\"rhosdt-${VERSION}\",\"base_sha\":\"${SHA}\"}}"
```

The reply carries the execution id and the status `TRIGGERED`; gangway does not report progress. Follow the run on the public job history, `https://prow.ci.openshift.org/job-history/gs/test-platform-results/logs/branch-ci-openshift-redhat-opentelemetry-collector-rhosdt-${VERSION}-images`: it takes about ten minutes, and `SUCCESS` means the image was promoted to the static tag.

## The tests

| Test (`as`) | Runs | Cluster | Suite |
|---|---|---|---|
| `e2e-pre-merge` | every PR, required | hive claim, `obs` 4.22 pool | critical subset (the `RUN_TESTS` list of the job in the config) |
| `e2e-ocp-4-12` | `/test` | hive claim, `obs` 4.12 pool (cold, one cluster) | full |
| `e2e-ocp-4-16` | `/test` | hive claim, `obs` 4.16 pool | full |
| `e2e-ocp-4-18-arm64` | `/test` | hive claim, `openshift-ci` 4.18 arm64 pool (`ci-ocp-4-18-arm64-aws-us-east-1`) | full minus the arm64 skip list |
| `e2e-ocp-4-20-fips` | `/test` | hive claim, `obs` 4.20 FIPS pool (`variant: fips`), `tls-scanner-run` with `PQC_CHECK` before the tests | full minus the FIPS skip list |
| `e2e-ocp-4-21` | `/test` | hive claim, `obs` 4.21 pool | full |
| `e2e-ui-ocp-4-22` | `/test` | hive claim, `obs` 4.22 pool | `tests/e2e-otel-ui/collector-dashboard` (Playwright, started by Chainsaw) |
| `e2e-ocp-4-23` | `/test` | hive claim, `openshift-ci` 4.23 pool (`ci-ocp-4-23-amd64-aws-us-east-1`) | full |
| `e2e-ocp-5-0` | `/test` | hive claim, `obs` 5.0 pool | full |

The optional tests have `always_run: false` and `optional: true`: they start only with `/test`, and a failure does not block the merge. The rerun and abort rules are in Step 3 of `SKILL.md`.

**A job either names the tests to run or the tests to skip.** `e2e-pre-merge` sets `RUN_TESTS`, the exact list of its critical test directories; the matrix jobs set `SKIP_TESTS`, the directories (globs allowed) removed from the full suite of the step (`FULL_SUITE` in `distributed-tracing-tests-opentelemetry-premerge-commands.sh`). The tests run in one chainsaw invocation with the selector `sidecar!=legacy` (OpenShift 4.16 and later) or `sidecar!=native` (older), which keeps the sidecar variant of the cluster and every unlabeled test. Two directories run on their own after the rest, in this order: `tests/e2e-metadata-filters`, after `ANNOTATIONS_FILTER` and `LABELS_FILTER` were set on the operator, and `tests/e2e-openshift-tls-profile` last, because it changes the cluster-wide TLS profile and the MachineConfig rollout would disrupt other tests. A directory of `RUN_TESTS` that does not exist fails the job; a suite directory renamed on the branch is updated in the step's full suite list.

Every full-suite test runs: the `install` step (`operator-sdk run bundle` in `opentelemetry-operator-system`), `install-operators` with the `OPERATORS` list of the test (Tempo and AMQ Streams everywhere; the Cluster Observability Operator, Loki and Logging where the catalog of that OpenShift version has them), then `distributed-tracing-tests-opentelemetry-premerge` with the `SKIP_TESTS` of that version, and the `openshift-observability-qe-agent` post step (`AGENT_SKILL: otel`, `JIRA_PROJECT: TRACING`; `otel-ui` and `OOC` for the UI test). The tests run as they are in the pull request: the modifications of `otel-qe-prepare-operator-tests` count once they are in the PR or on the branch.

The step checks that the installed operator is the image built from the PR and patches `RELATED_IMAGE_COLLECTOR` and `RELATED_IMAGE_TARGET_ALLOCATOR` into the CSV; the metadata filter variables are patched the same way. Step files: `ci-operator/step-registry/distributed-tracing/tests/opentelemetry/premerge/` and `.../opentelemetry-ui/premerge/`.

## Changing the matrix

- Another OpenShift version for a test: change `cluster_claim.version` and rename the test. Test names cannot contain dots, so the version is written `4-21`. The `obs` pools are in `clusters/hosted-mgmt/hive/pools/openshift-observability/` (FIPS pools carry `variant: fips`); the shared `openshift-ci` pools in `clusters/hosted-mgmt/hive/pools/openshift-ci/` cover versions and architectures the `obs` pools do not have (arm64, the next stream), and other repositories claim them too.
- A version without any hive pool: an IPI test on `aws-observability`, `azure-observability` or `gcp-observability`. Its payload and the `openshift-install` binary must be the same version: the installer comes from `releases.latest`, so an IPI test of another version needs `latest` set to that version, not only `OPENSHIFT_INSTALL_RELEASE_IMAGE_OVERRIDE`. Prefer a claim.
- Tests to run or skip on one version: `RUN_TESTS` or `SKIP_TESTS` of that test (the model is described above).
- Regenerate with `CONTAINER_ENGINE=podman make ci-operator-config jobs registry-metadata` and validate on the release PR with `/pj-rehearse pull-ci-openshift-open-telemetry-opentelemetry-operator-rhosdt-<version>-art-build-<test>`.

## Other jobs of the operator

- **Downstream periodics** on `main` (`...-main__opentelemetry-product-ocp-<version>-downstream.yaml`, weekly): the released product from `redhat-operators`, with the tests cloned from `rhosdt-<version>` (`MULTISTAGE_PARAM_OVERRIDE_OTEL_TESTS_BRANCH`). Not part of release testing.
- **Upstream presubmits** on `main` (`...-main__upstream-ocp-<version>-amd64.yaml`): the upstream operator built from `main`.
- The disconnected job of `distributed-tracing-qe` is not part of the OTEL release testing; `otel-qe-verify-disconnected-mirroring` covers the mirroring check.
