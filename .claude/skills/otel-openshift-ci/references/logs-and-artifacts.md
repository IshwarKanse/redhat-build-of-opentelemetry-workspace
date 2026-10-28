# CI job logs and artifacts

## Where a job reports

Prow uploads the logs and artifacts of a job to a storage bucket chosen per repository, in `plank.default_decoration_config_entries` of `core-services/prow/02_config/_config.yaml` in `openshift/release`:

| Bucket | Used by | Job pages (deck) | Files (gcsweb) | Login |
|---|---|---|---|---|
| `test-platform-results-public` | every repository not listed with another bucket, e.g. `openshift/redhat-opentelemetry-collector` | `https://prow.ci.openshift.org` | `https://gcs.ci.openshift.org/gcs/test-platform-results-public/` | none |
| `qe-private-deck` | the repositories listed with `bucket: qe-private-deck`, e.g. `openshift/openshift-tests-private`, `openshift/verification-tests` and the Distributed Tracing repositories, and the `/pj-rehearse` runs of their jobs on `openshift/release` | `https://qe-private-deck-ci.apps.ci.l2s4.p1.openshiftapps.com` | `https://gcsweb-qe-private-deck-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/qe-private-deck/` | app.ci token (SKILL.md) |
| `origin-ci-private` | the hidden jobs of the `openshift-priv` organization | `https://deck-internal-ci.apps.ci.l2s4.p1.openshiftapps.com` | `https://gcsweb-private-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/origin-ci-private/` | app.ci token |

The Distributed Tracing jobs report to `qe-private-deck` so that only authorized users can see their logs and artifacts: `openshift/distributed-tracing-qe` since 2023 (`openshift/release` PR 43301), and the operator forks `openshift/open-telemetry-opentelemetry-operator` and `openshift/grafana-tempo-operator` since 2024 (PR 54572). The collector repository `openshift/redhat-opentelemetry-collector` is not on that list, so its jobs are public.

The Details link of a check on the PR (`gh pr checks {PR} --repo {org}/{repo}`) is the Spyglass page of the run: its host tells which row applies, and its last path element is the build ID. The private runs are not on public Prow or in Sippy.

The public bucket is `test-platform-results-public` since 2026-09-15. Links into the older `test-platform-results` bucket open a page that says the artifacts were "archived to a private bucket"; its Artifacts link is an SSO-protected page for a browser, which refuses the app.ci token. Use the `test-platform-results-public` form of the same path: the runs since then are there.

With the token, read a private page or file as:
```bash
printf 'Authorization: Bearer %s\n' "$(oc whoami -t)" | curl -sf -H @- <url>
```

## The files of a run

A run's path is `pr-logs/pull/{org}_{repo}/{pr-number}/{job-name}/{build-id}` for a presubmit, and `logs/{job-name}/{build-id}` for a postsubmit or periodic (the path of a run is always the one in its Details or job-history link; prefer that over building it). For `openshift/origin` the `{org}_{repo}` part is left out, and a batch run (several PRs tested together before a merge) has `batch` in place of the PR number. Its files are at `{gcsweb}/{path}/` and its Spyglass page at `{deck}/view/gs/{bucket}/{path}`. Example, the files of the `e2e-ocp-4-21` job of the operator's product branch on PR 346:
```
https://gcsweb-qe-private-deck-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/qe-private-deck/pr-logs/pull/openshift_open-telemetry-opentelemetry-operator/346/pull-ci-openshift-open-telemetry-opentelemetry-operator-rhosdt-0.158-art-build-e2e-ocp-4-21/2110463341993398272/
```

- `{org}_{repo}`: `openshift_open-telemetry-opentelemetry-operator`; `openshift_release` for a `/pj-rehearse` run on a release PR, where the job name carries the `rehearse-{release-pr}-` prefix.
- `{job-name}`: the check `ci/prow/{name}` on a PR of branch `{branch}` is the job `pull-ci-{org}-{repo}-{branch}-{name}`, where `{name}` is `{variant}-{test}`, or just `{test}` in a config without a variant. The check `ci/prow/upstream-e2e-ocp-5-0` on `main` of the operator is `pull-ci-openshift-open-telemetry-opentelemetry-operator-main-upstream-e2e-ocp-5-0`; `ci/prow/art-build-e2e-ocp-4-21` on `rhosdt-0.158` is `...-rhosdt-0.158-art-build-e2e-ocp-4-21`. Postsubmits are `branch-ci-{org}-{repo}-{branch}-{name}`, periodics `periodic-ci-{org}-{repo}-{branch}-{name}`.
- `{test}`: the `as:` field of the test in the ci-operator config (e.g. `e2e-ocp-4-21`); it is also the directory of the test under `artifacts/`.

In a run's directory:
- `build-log.txt`: the ci-operator log. It names the namespace and build cluster of the run (`Using namespace ...`), the images it used and built ([images.md](images.md)), and every step with its result.
- `prowjob.json`: the job definition; `spec.cluster` is the build cluster. `finished.json`: the result.
- `artifacts/junit_operator.xml`: the JUnit report of the whole run, one test case per step and image build.
- `artifacts/ci-operator-step-graph.json`: every input, image build and test of the run, with `"failed": true` on the ones that failed.
- `artifacts/{test}/{step}/`: one directory per step, with the step's `build-log.txt`, its JUnit XML and the files it saved. `sidecar-logs.json` holds the detailed logs of the sidecar containers, important for debugging test failures.

While a job runs, its files are not uploaded yet: the deck streams the ci-operator log at `{deck}/log?job={job-name}&id={build-id}`. Once the pod is gone that endpoint answers 404; use the files above.

## Example: the steps of the OpenTelemetry operator's e2e jobs

- `distributed-tracing-tests-opentelemetry-premerge` (product branch) and `distributed-tracing-tests-opentelemetry-upstream` (`main`): the e2e tests. Their `build-log.txt` prints the images under test. On the product branch, `junit_otel_e2e.xml` is the report of the main run, and `junit_otel_e2e_metadata_filters.xml` and `junit_otel_e2e_tls_profile.xml` those of the two directories that run on their own at the end.
- `distributed-tracing-tests-opentelemetry-ui-premerge`: the console UI test (`junit_console_ui_otel_*.xml`, `chainsaw-output.log`, the Playwright report, traces and screenshots).
- `install` (the bundle install), `install-operators`, `tls-scanner-run`.

The step refs are in `ci-operator/step-registry/` of `openshift/release`; a step directory is named after the step without the test prefix (`artifacts/e2e-pre-merge/distributed-tracing-tests-opentelemetry-upstream/`).

## Why a job failed

1. Find what failed: `jq -r '.[] | select(.failed) | .name' ci-operator-step-graph.json` names the image build or test, and the top-level `build-log.txt` names the step inside a test, at its end: `Step {test}-{step} failed after ...` before `Some steps failed:`.
2. Read that step's own `build-log.txt` and JUnit XML in `artifacts/{test}/{step}/`. A failed image build has its log in `artifacts/build-logs/`.
3. If the job has an `openshift-observability-qe-agent` step (the observability QE jobs, the OpenTelemetry ones included) and its tests failed, read that step next (below).

### The qe-agent step of the observability jobs

The `openshift-observability-qe-agent` step reruns failures, diagnoses flaky vs. regression, applies fixes, and can auto-file a Jira bug. Check it at `artifacts/{test}/openshift-observability-qe-agent/`.

1. Read that step's `build-log.txt` to see which path it took:
   - `"Test failures detected — proceeding with qe-agent analysis."` — it ran. Read `artifacts/qe-agent-analysis.md` for the diagnosis (FLAKY vs. REGRESSION), root cause, and rerun results. Check `artifacts/test-fixes/` for any fix applied, and `artifacts/jira-issue-key.txt` for an auto-filed bug.
   - `"All tests passed — no failures detected. Skipping qe-agent."` — the tests passed. A job that still failed failed in another step; the top-level `build-log.txt` names it.
   - Any other `"skipping qe-agent"` line (missing context file, Claude CLI, `AGENT_SKILL`, or a skill fetch/size error) — it didn't get to run despite a real failure. Fall back to the failing test step's own `build-log.txt` and JUnit XML.

## Finding a run

`gh pr checks {PR} --repo {org}/{repo}` prints the Details link of the latest run of every check. A rerun replaces the check; for earlier runs:

- Every run of one job across all PRs, commits and reruns, aborted ones included: `{deck}/job-history/gs/{bucket}/pr-logs/directory/{job-name}` for presubmits and rehearsals, `{deck}/job-history/gs/{bucket}/logs/{job-name}` for postsubmits and periodics (`{bucket}` from the table above). The page embeds `var allBuilds = [...]`; filter its entries by `Refs.pulls[0].number` for one PR.
- Every run of every job of one PR: `{deck}/pr-history?org={org}&repo={repo}&pr={PR}`. It can come back empty when the deck does not index the repository, and it never lists rehearsals; use the job history then.
