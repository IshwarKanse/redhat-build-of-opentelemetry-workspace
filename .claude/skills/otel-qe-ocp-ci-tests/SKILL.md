---
name: otel-qe-ocp-ci-tests
description: Run the OpenTelemetry operator e2e test matrix in OpenShift CI, as the optional pre-merge jobs of the product branch (rhosdt-<version>) triggered with /test on a pull request, and post their final results as a table in a comment on that pull request. Use when release testing of a new product version runs the matrix (a sample of the supported OCP versions, FIPS, arm64 and the console UI), when a job of the matrix must be run or rerun for a pull request, or when the testing on a pull request is finished and the results need posting on it.
argument-hint: '{version} [pr-number] to run the matrix (e.g. "0.158", or "0.158 350" for a given PR), OR "collect {pr-number}" to post the final results on a PR (e.g. "collect 350")'
---

# OpenTelemetry e2e matrix in OpenShift CI

The full e2e test matrix of the Red Hat build of OpenTelemetry operator runs in OpenShift CI as **optional presubmits of the product branch** `rhosdt-<version>` of `openshift/open-telemetry-opentelemetry-operator`. Each job builds the operator, the target allocator and the OLM bundle from the pull request, installs them on a cluster of one OpenShift version (or variant: FIPS, arm64, console UI) and runs the chainsaw suite of the pull request. The jobs do not run on their own: they are started with `/test <job>` comments on a pull request, and a failure does not block the merge. Job list, config and artifact locations: [references/ci-job-layout.md](references/ci-job-layout.md). Read it first.

The shipped artifact, the ART FBC, is not what these jobs test. The Konflux integration tests (ITS) cover it on every build; see `/otel-art-reference` (`RELEASE.md`, "Release checks").

## Modes

| Arguments | Mode | Run |
|---|---|---|
| A version (`0.158`), optionally a PR number | Run the matrix | Steps 1-4 |
| `collect` and a PR number (`collect 350`) | Final status collection | Steps 5-6 only |
| Nothing, or ambiguous | — | Ask which one before doing anything |

The two modes run in separate sessions, usually days apart: collection starts only when the user says testing on the PR is finished (see [references/final-status-collection.md](references/final-status-collection.md)). The PR of the collection is the one the jobs ran on, open or merged.

## Prerequisites

1. The `gh` CLI must be authenticated.
2. `yq` on the PATH (Step 2), and a clone of `release` in the workspace (or `gh api` access to it) to read the job list.
3. For artifacts and job history: the `oc` CLI logged into `app.ci`, see `/otel-openshift-ci` (login, and `references/logs-and-artifacts.md` for the logs). The results themselves come from GitHub and need no login.

## Steps

### Step 1: Pick the pull request

The jobs run on a pull request to `rhosdt-{VERSION}`. Never open a pull request just to run them: the productization process always has one open on the branch (the test preparation of `/otel-qe-prepare-operator-tests`, the version bump of the ART configuration in `bundle/`, a backport, a MintMaker dependency update), and the jobs build and test whatever that pull request contains.

1. **The PR the user named** (second argument).
2. Otherwise list the open pull requests of the branch and let the user choose:
   ```bash
   gh pr list --repo openshift/open-telemetry-opentelemetry-operator --base rhosdt-{VERSION} --state open \
     --json number,title,author,headRefName -q '.[] | "\(.number)\t\(.author.login)\t\(.headRefName)\t\(.title)"'
   ```
   The test-preparation PR is the best choice when it is open: the tests the jobs run are the ones it changes. Any other PR of the process works; a PR that merges while the jobs run keeps its statuses, only a new commit on it aborts them.
3. If none is open, say so and wait for the next one; do not create one.

`{PR_NUMBER}` is the number of the chosen PR. The always-run jobs (`art-build-images`, `art-build-ci-bundle-opentelemetry-bundle`, `art-build-e2e-pre-merge`) start on their own; wait for `art-build-images` to pass before Step 3, the optional jobs build the same images and fail the same way.

### Step 2: List the jobs of the matrix

The jobs are the optional tests of the pre-merge config (the file name carries no OCP version; the version is in every test):

```bash
CONFIG=release/ci-operator/config/openshift/open-telemetry-opentelemetry-operator/openshift-open-telemetry-opentelemetry-operator-rhosdt-{VERSION}__art-build.yaml
yq '.tests[] | select(.optional == true) | .as' "$CONFIG"
```

The always-run `e2e-pre-merge` job is not in that list; it starts on its own and is part of the matrix results all the same (Step 5).

Every name is triggered as `/test art-build-<name>` (variant prefix `art-build`). `/test ?` as a PR comment lists them as well. Every job in that list is part of release testing; none is skipped without the user saying so.

### Step 3: Trigger the jobs

One job first, so a problem with the build or the branch shows up once and not eight times. Use a job on a warm hive pool (`e2e-ocp-4-21`, or the plain job of the current GA version):

```bash
gh pr comment {PR_NUMBER} --repo openshift/open-telemetry-opentelemetry-operator --body "/test art-build-e2e-ocp-4-21"
```

When its `distributed-tracing-tests-opentelemetry-premerge` step has started the chainsaw tests (the `build-log.txt` prints the operator, collector and target allocator images under test and `Image of opentelemetry-operator-controller-manager`; see `/otel-openshift-ci`, `references/logs-and-artifacts.md`), trigger the rest, every other job of the Step 2 list, on one line (`CONFIG` is the variable of Step 2):

```bash
REST=$(yq '.tests[] | select(.optional == true) | .as' "$CONFIG" | grep -v '^e2e-ocp-4-21$' | sed 's/^/art-build-/' | paste -sd' ' -)
gh pr comment {PR_NUMBER} --repo openshift/open-telemetry-opentelemetry-operator --body "/test ${REST}"
```

Behaviors to plan around:
- A new commit on the PR aborts the running jobs and reruns only the always-run ones. The optional jobs must be triggered again with `/test`.
- `/test all` does not run the optional jobs. `/retest` reruns only the failed always-run jobs.
- `/test <name>` reruns one job; the others are not affected.
- The arm64 job needs the multi-arch collector image ("Promoting the collector image" in [references/ci-job-layout.md](references/ci-job-layout.md)); a failure at the collector pods right after the collector branch changed is that, not the operator.
- `NoClusters: No clusters in pool are ready to be claimed` means the hive pool is empty (the 4.12 pool holds one cluster at a time and starts cold); wait and rerun.

### Step 4: Report

Tell the user the PR, the jobs triggered, and that the results arrive as checks on the PR (`gh pr checks {PR_NUMBER} --repo openshift/open-telemetry-opentelemetry-operator`). For a failing job, check its `openshift-observability-qe-agent` step first (`/otel-openshift-ci`, `references/logs-and-artifacts.md`).
