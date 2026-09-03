---
name: otel-qe-release-testing-epic
description: Create or update the QE release-testing Epic and its Tasks in Jira for an RHOSDT OTEL release, assigning them to a given owner. Use when starting release testing for a new RHOSDT OTEL version, or when an existing tracker Epic is missing Tasks or an assignee.
argument-hint: 'version: RHOSDT release version (e.g., "3.11", "3.12"), assignee: name, email, or Jira username for the Epic and its Tasks'
---

# OpenTelemetry Release Testing Epic

Create (or reuse) the Jira Epic that tracks QE release testing for an RHOSDT OTEL release, and populate it with a fixed, simplified set of Tasks. Each Task description points at the current QE skill, never the retired `/rhosdt-qe:*` commands.

This skill only creates/reads Jira issues. It does not run any tests itself — each Task tells whoever picks it up which skill to invoke.

## Dependencies

- **`atlassian` plugin** (from the `claude-plugins-official` marketplace) — provides the Jira tools this skill uses. If missing/unauthenticated, pause rather than guessing at what got created.
- **The `release` and `konflux` repos**, cloned in the workspace via `make clone-repos` (see the workspace README) — Steps 2 and 3 read files from them.
- **`rhosdt-team`**, an external skill not in this repo, referenced in the IBM P/Z Task for contact info.

## When to Use This Skill

Use this skill when:
- Starting QE release testing for a new RHOSDT OTEL version and no tracking Epic exists yet
- An Epic exists but has no Tasks, or is missing some of the standard ones
- Re-running is always safe — existing Tasks (matched by exact summary) aren't duplicated, but get refreshed to the current templates

## Jira Conventions

- Project key: **TRACING** on `redhat.atlassian.net`
- Epic summary: `[QE] Verify RHOSDT {version} OTEL release`
- All children must be issue type **Task** (hierarchy level 0) with `parent` set to the Epic's key. Never Sub-task — Jira's hierarchy doesn't allow skipping the Task/Story level. Matches every past release Epic (e.g. TRACING-6376).
- Story Points `customfield_10028` (number): **3** on the Epic, **1** on every Task.
- Activity Type `customfield_10464` (select): `{"id": "10608"}` ("Quality / Stability / Reliability") on the Epic and every Task. Pass via `additional_fields` on `createJiraIssue`, or `fields` on `editJiraIssue`.
- Use real newline characters in `description`, never the literal `\n` sequence — that produces a visible backslash-n in Jira instead of a line break.

## Steps

### Step 1: Get the RHOSDT Version and Assignee

**Ask the user** which RHOSDT OTEL version this is for (e.g. "3.11") if it wasn't already given. Also ask for an existing Epic key if the user wants to target one explicitly instead of the default search-or-create in Step 3.

**Ask the user who should be assigned** to the Epic and all its Tasks (name, email, or Jira username) if it wasn't already given. Resolve it to a Jira account ID with `lookupJiraAccountId` (used as `assignee_account_id` in Steps 3 and 5). If the lookup returns more than one match, ask which account — don't guess.

### Step 2: Determine the Supported OCP Version Range

List the product's stage/downstream CI config files in the `release` repository to derive the current supported OCP version range:

```bash
ls release/ci-operator/config/openshift/open-telemetry-opentelemetry-operator/*stage.yaml \
  | grep -oE '[0-9]+\.[0-9]+' | sort -V | uniq
```

Take the lowest and highest version as `{MIN}` and `{MAX}` (e.g. `4.12` and `5.0`). If the `release` repo isn't cloned, or the result looks wrong, ask the user for the current supported OCP version range instead of guessing.

### Step 3: Find or Create the Epic

If the user gave an existing Epic key in Step 1, use it directly and skip the search below. Otherwise, search for an existing Epic first (include `status` in the fields you fetch):

```
project = TRACING AND issuetype = Epic AND summary ~ "Verify RHOSDT {version} OTEL release"
```

This is a fuzzy text search (e.g. "3.1" also matches "3.11"), so filter results to the exact summary `[QE] Verify RHOSDT {version} OTEL release` before deciding:

- **One exact match, not Closed:** reuse it. Always overwrite its description with the current template below (fill in `{version}` and payload links) so skill updates take effect on re-run, and fix any mismatched assignee, `customfield_10028` (`3`), or `customfield_10464` (`{id: "10608"}`) — one `editJiraIssue` call. Report its key.
- **One exact match, but Closed:** treat as zero matches — never reuse or modify a Closed Epic. Create a new one (below), and tell the user the closed Epic's key in case that's unexpected.
- **Zero exact matches (or the only match is Closed):** create with `issueTypeName: Epic`, `summary: [QE] Verify RHOSDT {version} OTEL release`, `assignee_account_id`, `additional_fields: {customfield_10028: 3, customfield_10464: {id: "10608"}}`, and this description (fill in `{version}` and payload links; real newlines, not `\n`):

Pull the local `konflux` repo to latest `main` first (`git -C konflux checkout main && git -C konflux pull --ff-only origin main`) — payload files land close to release, so a stale checkout can miss one. Then check `konflux/release-payloads/` for both `otel-stage-{version}.yaml` and `otel-stage-fbc-{version}.yaml` (FBC lands later — only include the bullet for files that actually exist).

```
### Operator Versions

* OTEL {version} Konflux Release CR

### Release Payload

* https://gitlab.cee.redhat.com/distributed-tracing/konflux/-/blob/main/release-payloads/otel-stage-{version}.yaml
* https://gitlab.cee.redhat.com/distributed-tracing/konflux/-/blob/main/release-payloads/otel-stage-fbc-{version}.yaml (FBC — add once published)

Before running the tests, prepare the release branch and Konflux integration tests:

/otel-qe-prepare-operator-tests
/otel-qe-prepare-konflux-tests

**Testing order:** the Konflux E2E and Upgrade Integration Test Jobs Task must pass before the Tests on Supported OCP Versions Task — both use the same IIB/bundle images, so fix Konflux failures first.

Each Task below has instructions to run its tests, including cluster setup where needed.

### Release Date

* [Portfolio program document.](https://docs.google.com/document/d/1wI165umVfVjqOjv_0qSk6iOKHnqqdfjSZMPpdWMhNTU/edit?usp=sharing)
* [OCP Release Cycle](https://access.redhat.com/support/policy/updates/openshift)
```

- **More than one exact match:** stop and ask the user which Epic to use — do not guess.

### Step 4: Audit Existing Children

Query `parent = {epic key}`, including assignee, story points (`customfield_10028`), and activity type (`customfield_10464`).

- Any child whose issue type is **not** Task: flag it in the final report; don't delete, convert, or touch it — that's a human decision.
- Note existing Tasks' summaries and assignee/SP/activity type so Step 5 can skip duplicates but still fix up those fields.

### Step 5: Create the Missing Tasks and Set Fields

For each template below, the full summary is `[QE] RHOSDT {version} {title}`.

- If a Task with that exact summary already exists (from Step 4): always overwrite its description with the current template below, and fix any mismatched assignee, `customfield_10028` (`1`), or `customfield_10464` (`{id: "10608"}`) — one `editJiraIssue` call.
- Otherwise, create it with `issueTypeName: Task`, `parent: {epic key}`, `assignee_account_id`, `additional_fields: {customfield_10028: 1, customfield_10464: {id: "10608"}}`, and the given description (fill in `{version}`, `{MIN}`, `{MAX}`; real newlines, not `\n`).

#### 1. Tests on Supported OCP Versions ({MIN}-{MAX})

```
Goal: Verify the OTEL operator on all supported OCP versions ({MIN}-{MAX}), the ARM/FIPS variants, and disconnected-mirroring readiness. Prerequisite: the Konflux E2E and Upgrade Integration Test Jobs Task must pass first — see Testing order above.

1. Use the `otel-qe-ocp-ci-tests` skill to create/update the PR to `openshift/release` with the IIB mappings from the Konflux release payload for {version}.
2. Run the `otel-qe-verify-disconnected-mirroring` skill as a fast, no-cluster pre-check for disconnected mirroring correctness. Have it comment the result on this issue.
3. Comment `/pj-rehearse {one-job-name}` with just one job first and wait for it to pass — catches a broken IIB/config early.
4. Once that passes, comment `/pj-rehearse {remaining-job-list}` for the rest — one PR covers every OCP version, ARM/FIPS, and the disconnected job (different project dir, same PR), all triggered together.
5. For any failing job, check its `openshift-observability-qe-agent` step first (see `otel-qe-ocp-ci-tests`) — it may have already diagnosed and fixed it. Re-run until all jobs pass.
6. Merge the PR.
```

#### 2. Tests on IBM P and IBM Z `[manual]`

```
Goal: Verify the OTEL operator on IBM P (ppc64le) and IBM Z (s390x) — manually-requested clusters outside OCP CI. Request clusters only if none are already provisioned; the product branch is already prepared by the Epic's prep step.

Use the `otel-qe-test-ibm` skill end-to-end on both clusters — it covers cluster cleanup/reuse, operator install (AMQ Streams, Loki, Red Hat OpenShift Logging), and the chainsaw suites, and lists failures expected on these architectures (eBPF `obi` receiver, Node.js auto-instrumentation). File bugs only for unexplained failures.
```

#### 3. Konflux E2E and Upgrade Integration Test Jobs `[Konflux int.]`

```
Goal: Verify the Konflux CI integration test pipelines pass for {version}. Complete this before the Tests on Supported OCP Versions Task — see Testing order in the Epic description.

1. Check the e2e and upgrade integration test pipeline runs in the RHOSDT Konflux workspace: https://konflux-ui.apps.stone-prd-rh01.pg1f.p1.openshiftapps.com/ns/rhosdt-tenant/applications/ (Activity tab → Pipeline runs → filter by "Tests"). E2E tests trigger on new bundle builds, upgrade tests trigger on new FBC builds — both on main branch commits only.
2. E2E pipelines cover operator/operand/component version and image verification, and the DAST scan step — confirm all pass, and triage any high-severity DAST alerts (these are release blockers).
3. Upgrade pipelines (FBC apps, e.g. `otel-fbc-v4-14-main`, `otel-fbc-v4-18-main`) verify the upgrade path and data integrity — confirm all pass.
4. Re-run any failed pipeline via `kubectl label --overwrite -n rhosdt-tenant snapshot <name> test.appstudio.openshift.io/run=all` or the Konflux UI, and investigate failures.
```

#### 4. Test OpenTelemetry Collector and APM Dashboard `[manual]`

```
Goal: Verify the OpenTelemetry collector dashboards on OpenShift.

Use the `otel-qe-collector-dashboard-manual` skill to deploy the collector and telemetrygen, and verify the dashboard shows metrics data.
```

#### 5. Verify Release Notes and Documentation `[manual]`

```
Goal: Verify the release notes and product documentation for {version} are accurate.

1. Read the release notes from the Konflux release payload (`otel-prod-{version}.yaml`).
2. Verify each documented feature, known issue, and fix is accurately reflected in the docs.
3. Coordinate with the docs team to resolve any gaps.
```

#### 6. Verify CVE and Bug Fixes `[manual]`

```
Goal: Verify the CVE and bug fixes listed in the release payload are actually fixed.

Use the `otel-qe-verify-fixes` skill to look up each Jira issue and CVE from the release payload, verify the fix, and update the Jira issues with results.
```

### Step 6: Report Results

Summarize for the user:
- Epic key and URL (created or reused)
- Assignee, story points, and activity type applied to the Epic and each Task
- Tasks created vs. skipped (already existed)
- Any non-Task children found under the Epic that need manual cleanup
