# Browsing CI Job Logs and Artifacts

### Understanding test structure in the CI config

Each test in the `tests:` section of the config has:
- `as:` - the test name (e.g. `e2e-ocp-4-21`), which is the artifact directory of the job
- `steps.test:` - the steps that execute (e.g. `install`, `install-operators`, `distributed-tracing-tests-opentelemetry-premerge`)

**Example from the config:**
```yaml
tests:
- always_run: false
  as: e2e-ocp-4-21
  optional: true
  steps:
    test:
    - as: install
      ...
    - ref: install-operators
    - ref: distributed-tracing-tests-opentelemetry-premerge
```

The step refs correspond to step registry entries in `ci-operator/step-registry/`.

### Checking the qe-agent step before manual log digging

Every job also runs an `openshift-observability-qe-agent` step that reruns failures, diagnoses flaky vs. regression, applies fixes, and can auto-file a Jira bug — check it first, at `artifacts/{test-name}/openshift-observability-qe-agent/`.

1. Read that step's `build-log.txt` to see which path it took:
   - `"Test failures detected — proceeding with qe-agent analysis."` — it ran. Read `artifacts/qe-agent-analysis.md` for the diagnosis (FLAKY vs. REGRESSION), root cause, and rerun results. Check `artifacts/test-fixes/` for any fix applied, and `artifacts/jira-issue-key.txt` for an auto-filed bug.
   - `"All tests passed — no failures detected. Skipping qe-agent."` — the job actually passed; nothing to investigate.
   - Any other `"skipping qe-agent"` line (missing context file, Claude CLI, `AGENT_SKILL`, or a skill fetch/size error) — it didn't get to run despite a real failure. Fall back to the failing test step's own `build-log.txt` and JUnit XML directly (see below).

### Browsing test artifacts via gcsweb

After jobs run, their artifacts (logs, test results, cluster state) are stored in GCS and browsable via gcsweb.

**Authentication:**
gcsweb requires an OpenShift OAuth token, not a Kubernetes ServiceAccount token — `oc login` to `app.ci` first (console: `https://console-openshift-console.apps.ci.l2s4.p1.openshiftapps.com/` → username menu → Copy login command), then:
```bash
printf 'Authorization: Bearer %s\n' "$(oc whoami -t)" | curl -H @- <gcsweb-url>
```
(reads the header from stdin — keeps the token out of argv/`ps`/shell history)

**URL pattern:**
```
https://gcsweb-qe-private-deck-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/qe-private-deck/pr-logs/pull/{repo}/{pr-number}/{job-name}/{build-id}/artifacts/{test-name}/{step-name}/
```

**Example:**
```
https://gcsweb-qe-private-deck-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/qe-private-deck/pr-logs/pull/openshift_open-telemetry-opentelemetry-operator/346/pull-ci-openshift-open-telemetry-opentelemetry-operator-rhosdt-0.158-art-build-e2e-ocp-4-21/2110463341993398272/artifacts/e2e-ocp-4-21/distributed-tracing-tests-opentelemetry-premerge/
```

**URL components:**
- `{repo}`: `openshift_open-telemetry-opentelemetry-operator` (the product repository; `openshift_release` for a `/pj-rehearse` run on a release PR, where the job name then carries the `rehearse-{release-pr}-` prefix)
- `{pr-number}`: the PR number on that repository
- `{job-name}`: `pull-ci-openshift-open-telemetry-opentelemetry-operator-rhosdt-{version}-art-build-{test-name}`
- `{build-id}`: the build ID (e.g. `2110463341993398272`); it is the last path element of the check's "Details" link on the PR
- `{test-name}`: the `as:` field of the test (e.g. `e2e-ocp-4-21`, `e2e-ui-ocp-4-22`)
- `{step-name}`: the step: `distributed-tracing-tests-opentelemetry-premerge` for the e2e tests (`build-log.txt` prints the images under test, `junit_otel_e2e.xml` is the report of the main run, `junit_otel_e2e_metadata_filters.xml` and `junit_otel_e2e_tls_profile.xml` the ones of the two directories that run on their own at the end), `distributed-tracing-tests-opentelemetry-ui-premerge` for the UI test (`junit_console_ui_otel_*.xml`, `chainsaw-output.log`, the Playwright report, traces and screenshots), `install` for the bundle install, `install-operators`, `tls-scanner-run`

**Finding the build ID:**

From the check on the PR: `gh pr checks {PR} --repo openshift/open-telemetry-opentelemetry-operator` prints the Details URL of every check, which ends with the build ID. For earlier runs (a rerun replaces the check), the PR history page lists every run of every job of the PR:
```
https://qe-private-deck-ci.apps.ci.l2s4.p1.openshiftapps.com/pr-history?org=openshift&repo=open-telemetry-opentelemetry-operator&pr={PR}
```
and the history of one job across all PRs is at `https://qe-private-deck-ci.apps.ci.l2s4.p1.openshiftapps.com/job-history/gs/qe-private-deck/pr-logs/directory/{job-name}`.

**Browsing artifacts:**
- `build-log.txt` - container/step logs
- `sidecar-logs.json` - detailed logs from sidecar containers, important for debugging test failures
- `finished.json` - job completion metadata
- `junit/` - JUnit XML test results
