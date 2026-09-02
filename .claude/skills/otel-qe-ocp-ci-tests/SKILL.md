---
name: otel-qe-ocp-ci-tests
description: Set up OpenTelemetry OCP CI stage testing by creating a PR to openshift/release with IIBs from konflux release payloads, then triggering the stage jobs. Use when starting stage testing for a new product release or updating IIB images after a Konflux FBC build.
argument-hint: 'version: RHOSDT release version (e.g., "3.11", "3.12")'
---

# OpenTelemetry OCP CI Stage Testing

Set up stage testing for Red Hat build of OpenTelemetry release by creating a PR to the `openshift/release` repository with correct IIB (Index Image Build) mappings from the Konflux release payload.

## Prerequisites

1. The `konflux` GitLab repository must be cloned in the workspace
2. The `release` GitHub repository must be cloned in the workspace  
3. Your GitHub fork of `openshift/release` must be configured as a remote
4. The `gh` CLI must be authenticated
5. The `oc` CLI must be logged into `app.ci` (`oc login --server=https://api.ci.l2s4.p1.openshiftapps.com:6443`) — needed for gcsweb/deck artifact access

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

**List all stage test configs:**
```bash
ls release/ci-operator/config/openshift/open-telemetry-opentelemetry-operator/*stage.yaml
```

**Variants:**
- **Regular:** `ocp-4.XX-stage.yaml` - Standard x86_64 tests
- **FIPS:** `ocp-4.XX-fips-stage.yaml` - FIPS-enabled clusters
- **ARM:** `ocp-4.XX-arm-stage.yaml` - ARM64 architecture tests

**Job naming pattern:**
```
periodic-ci-openshift-open-telemetry-opentelemetry-operator-main-opentelemetry-product-ocp-{VERSION}-{VARIANT}-stage-opentelemetry-stage-tests
```

**Disconnected test job:** lives in a different project directory in the same `release` repo, not the one above — `ci-operator/config/openshift/distributed-tracing-qe/openshift-distributed-tracing-qe-main__ocp-4.16-disconnected.yaml`, job name `periodic-ci-openshift-distributed-tracing-qe-main-ocp-4.16-disconnected-distributed-tracing-tests-disconnected`. It needs both `MULTISTAGE_PARAM_OVERRIDE_OTEL_INDEX_IMAGE` and `MULTISTAGE_PARAM_OVERRIDE_TEMPO_INDEX_IMAGE` updated the same way as the other configs — it's part of the same PR, just a different file. Its `cron: 0 0 30 2 *` (an impossible date) is intentional: every one of these jobs is on-demand only, triggered via `/pj-rehearse` or Gangway, never on a schedule.

## Steps

### Step 1: Extract IIB Mappings from Konflux Release Payload

Read the release payload file `konflux/release-payloads/otel-stage-{VERSION}.yaml` and extract all IIB mappings.

Look for sections like:
```yaml
- ocp_version: v4.19
  index_image: registry-proxy.engineering.redhat.com/rh-osbs/iib:1201672
```

Create a mapping of OCP version to IIB number for all versions in the payload, stripping the leading `v` from `ocp_version` (e.g. `v4.19` → `4.19`) — file and job names use the bare version number.

### Step 2: Update CI Configuration Files

For each OCP version in the IIB mapping, update the corresponding stage test configuration file in `release/ci-operator/config/openshift/open-telemetry-opentelemetry-operator/`.

**File pattern:** `openshift-open-telemetry-opentelemetry-operator-main__opentelemetry-product-ocp-{VERSION}-{VARIANT}-stage.yaml`

**Changes to make:**
1. Update `MULTISTAGE_PARAM_OVERRIDE_OTEL_INDEX_IMAGE` to `brew.registry.redhat.io/rh-osbs/iib:{IIB_NUMBER}`
2. Also update the disconnected test config (see Disconnected test job above) with the matching `MULTISTAGE_PARAM_OVERRIDE_OTEL_INDEX_IMAGE` and `MULTISTAGE_PARAM_OVERRIDE_TEMPO_INDEX_IMAGE` — same PR, same IIB values.

**IMPORTANT:**
- Only update files for OCP versions that exist in the IIB mapping
- Do NOT create configs for versions not in the mapping
- Update BOTH regular and variant configs (e.g., 4.22-stage AND 4.22-fips-stage AND 4.22-arm-stage)
- Don't skip the disconnected config just because it's in a different project directory
- Preserve all other configuration settings

### Step 3: Create Git Branch and Commit

```bash
cd release
git checkout -b otel-{VERSION}-stage-tests
git add <path-to-each-file-updated-in-step-2>  # only the specific files edited above, not a wildcard
git diff --cached --name-only                  # verify no unrelated files got staged
git commit -s -m "OTEL RHOSDT {VERSION}: Stage tests

Stage testing for RHOSDT: OTEL {VERSION}

- Updated IIB images from konflux release payload"
```

### Step 4: Push to Fork

Push to your fork remote, not `origin` (find it with `git remote -v | grep push | grep <your-github-username>`):

```bash
git push <fork-remote> otel-{VERSION}-stage-tests
```

### Step 5: Create Pull Request

```bash
gh pr create --repo openshift/release --head <fork-user>:otel-{VERSION}-stage-tests --base main \
  --title "OTEL RHOSDT {VERSION}: Stage tests" \
  --body "Stage testing for RHOSDT: OTEL {VERSION}. Updated IIB images from konflux release payload. Can be merged only after all jobs pass."
```

Note the PR number from the output — it's `{PR_NUMBER}` in Step 6.

### Step 6: Trigger Rehearsal Jobs

Add a comment to the PR to trigger all rehearsal jobs:

```bash
gh pr comment {PR_NUMBER} --repo openshift/release --body "/pj-rehearse {job-list}"
```

Where `{job-list}` is a space-separated list of all job names from the updated configs, including the disconnected job's periodic name — periodics rehearse via `/pj-rehearse` the same way presubmits do. Job name pattern:
```
periodic-ci-openshift-open-telemetry-opentelemetry-operator-main-opentelemetry-product-ocp-{VERSION}-{VARIANT}-stage-opentelemetry-stage-tests
periodic-ci-openshift-distributed-tracing-qe-main-ocp-4.16-disconnected-distributed-tracing-tests-disconnected
```

**Example:**
```
/pj-rehearse periodic-ci-openshift-open-telemetry-opentelemetry-operator-main-opentelemetry-product-ocp-4.19-stage-opentelemetry-stage-tests periodic-ci-openshift-open-telemetry-opentelemetry-operator-main-opentelemetry-product-ocp-4.20-stage-opentelemetry-stage-tests
```

### Step 7: Report Results

Provide the user with:
1. PR URL
2. List of updated config files
3. IIB mappings used
4. Rehearsal jobs triggered

## Browsing CI Job Logs and Artifacts

### Understanding Test Structure in CI Configs

The CI configuration files define tests in the `tests:` section. Each test has:
- `as:` - Test name (e.g., `opentelemetry-stage-tests`)
- `steps.test:` - List of step refs that execute (e.g., `distributed-tracing-tests-opentelemetry-stage`)

**Example from a config file:**
```yaml
tests:
- as: opentelemetry-stage-tests
  steps:
    test:
    - ref: distributed-tracing-install-otel-konflux-catalogsource
    - ref: install-operators
    - ref: distributed-tracing-tests-opentelemetry-stage
```

The step refs correspond to step registry entries in `ci-operator/step-registry/`.

### Checking the qe-agent Step Before Manual Log Digging

Every stage job also runs an `openshift-observability-qe-agent` step that reruns failures, diagnoses flaky vs. regression, applies fixes, and can auto-file a Jira bug — check it first, at `artifacts/{test-name}/openshift-observability-qe-agent/`.

1. Read that step's `build-log.txt` to see which path it took:
   - `"Test failures detected — proceeding with qe-agent analysis."` — it ran. Read `artifacts/qe-agent-analysis.md` for the diagnosis (FLAKY vs. REGRESSION), root cause, and rerun results. Check `artifacts/test-fixes/` for any fix applied, and `artifacts/jira-issue-key.txt` for an auto-filed bug.
   - `"All tests passed — no failures detected. Skipping qe-agent."` — the job actually passed; nothing to investigate.
   - Any other `"skipping qe-agent"` line (missing context file, Claude CLI, `AGENT_SKILL`, or a skill fetch/size error) — it didn't get to run despite a real failure. Fall back to the failing test step's own `build-log.txt` and JUnit XML directly (see below).

### Browsing Test Artifacts via gcsweb

After jobs run, their artifacts (logs, test results, cluster state) are stored in GCS and browsable via gcsweb.

**Authentication:**
gcsweb requires an OpenShift OAuth token, not a Kubernetes ServiceAccount token — `oc login` to `app.ci` first (console: `https://console-openshift-console.apps.ci.l2s4.p1.openshiftapps.com/` → username menu → Copy login command), then:
```bash
printf 'Authorization: Bearer %s\n' "$(oc whoami -t)" | curl -H @- <gcsweb-url>
```
(reads the header from stdin — keeps the token out of argv/`ps`/shell history)

**URL Pattern:**
```
https://gcsweb-qe-private-deck-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/qe-private-deck/pr-logs/pull/{repo}/{pr-number}/{job-name}/{build-id}/artifacts/{test-name}/{step-name}/
```

**Example:**
```
https://gcsweb-qe-private-deck-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/qe-private-deck/pr-logs/pull/openshift_release/84173/rehearse-84173-periodic-ci-openshift-open-telemetry-opentelemetry-operator-main-opentelemetry-product-ocp-4.21-stage-opentelemetry-stage-tests/2092950588802207744/artifacts/opentelemetry-stage-tests/distributed-tracing-tests-opentelemetry-stage/
```

**URL Components:**
- `{repo}`: `openshift_release` (for PRs to openshift/release)
- `{pr-number}`: PR number (e.g., `84173`)
- `{job-name}`: Full job name with `rehearse-{pr-number}-` prefix
- `{build-id}`: Unique build ID (e.g., `2092950588802207744`)
- `{test-name}`: The `as:` field from CI config (e.g., `opentelemetry-stage-tests`)
- `{step-name}`: The `ref:` field from CI config (e.g., `distributed-tracing-tests-opentelemetry-stage`)

**Finding the Build ID:**
1. After `/pj-rehearse`, the bot comments with job links
2. Click on a job link to see the prow dashboard
3. The build ID is in the URL or shown as "Build ID" on the page

**Browsing Artifacts:**
Navigate through gcsweb to find:
- `build-log.txt` - Container/step logs
- `sidecar-logs.json` - Detailed logs from sidecar containers, important for debugging test failures
- `finished.json` - Job completion metadata
- `junit/` - JUnit XML test results
- Custom artifacts created by the test steps