# Pre-merge CI in release (new ART group)

What the pre-merge jobs do, and how the collector image reaches them, is in [`ci-job-layout.md`](../../otel-qe-ocp-ci-tests/references/ci-job-layout.md).

## Steps for a new ART group

Work in a clone of `release` (`release/` in the workspace), on a branch from `origin/main`. Replace `<old>` and `<new>` with the old and new `rhosdt-*` versions, and `<ocp-version>` with the OCP version of the claimed cluster (step 1). The new branch must exist in `openshift/open-telemetry-opentelemetry-operator` and `openshift/redhat-opentelemetry-collector`.

1. **OCP version.** The pre-merge job claims a cluster from the observability hive pool, and the config and the jobs are named after that cluster version, the latest stable OCP version that has a pool. If a pool for a newer stable version exists (`ls clusters/hosted-mgmt/hive/pools/openshift-observability/`, take the `obs-ocp-<x>-<y>-0-amd64-*` pools; the `obs-logging-*` pools are for logging), migrate to it: use its version in the config name, in `zz_generated_metadata.variant`, in `releases` and in the `cluster_claim`.
2. **Operator config.** In `ci-operator/config/openshift/open-telemetry-opentelemetry-operator/`, rename `openshift-open-telemetry-opentelemetry-operator-rhosdt-<old>__art-build-ocp-<ocp-version>.yaml` to `...-rhosdt-<new>__art-build-ocp-<ocp-version>.yaml` and set `zz_generated_metadata.branch` to `rhosdt-<new>`. Check that nothing else in the file mentions the old version: `grep -n "<old>" <file>`.
3. **Collector config.** In `ci-operator/config/openshift/redhat-opentelemetry-collector/`, do the same for `openshift-redhat-opentelemetry-collector-rhosdt-<old>.yaml`. Leave the `promotion` stanza as it is: the image is promoted to the static tag `redhat-otel-collector` whichever branch built it, so the operator config needs no change for the new branch.
4. **Review the critical test list.** The pre-merge step runs the chainsaw test directories listed in `TEST_DIRS` and `SIDECAR_TEST_DIRS` in `ci-operator/step-registry/distributed-tracing/tests/opentelemetry/premerge/distributed-tracing-tests-opentelemetry-premerge-ref.yaml`. If tests were added, removed or renamed on the new branch, update the lists. A directory that does not exist on the branch fails the job.
5. **Regenerate the jobs.** Run `CONTAINER_ENGINE=podman make ci-operator-config jobs`. The generated files in `ci-operator/jobs/openshift/open-telemetry-opentelemetry-operator/` and `ci-operator/jobs/openshift/redhat-opentelemetry-collector/` must be for the new branch. If the files of the old branch (`...-rhosdt-<old>-presubmits.yaml`, `...-postsubmits.yaml`) are still there, delete them and run `make jobs` again.
6. **Open the PR and rehearse** with `/pj-rehearse` comments:
   ```
   /pj-rehearse pull-ci-openshift-open-telemetry-opentelemetry-operator-rhosdt-<new>-art-build-ocp-<ocp-version>-e2e-pre-merge
   /pj-rehearse pull-ci-openshift-redhat-opentelemetry-collector-rhosdt-<new>-images
   ```
   For `NoClusters` in the log, see [`ci-job-layout.md`](../../otel-qe-ocp-ci-tests/references/ci-job-layout.md).
   The collector image of this rehearsal is still the one of the previous branch, because the postsubmit that promotes it does not exist before the PR merges and the tag is static. The rehearsal then tests the new operator against the previous collector. That is expected, so do not chase a collector version mismatch here.
7. **After the PR merges, promote the collector image from the new branch.** The postsubmit of the collector config (`branch-ci-openshift-redhat-opentelemetry-collector-rhosdt-<new>-images`) runs on a push to the new collector branch and writes the image to the static tag. If there is no push to wait for, trigger it through gangway (see [`ci-job-layout.md`](../../otel-qe-ocp-ci-tests/references/ci-job-layout.md)). Then check the first real pre-merge run on a PR to the new operator branch.

The ART configuration in `ocp-build-data` and the Konflux build configuration in `konflux-release-data` are not part of this skill; see `otel-art-reference`.
