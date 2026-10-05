---
name: otel-qe-ocp-ci-tests
description: Set up OpenTelemetry OCP CI stage testing by creating a PR to openshift/release with digest-pinned ART FBC catalog images, then triggering the stage jobs. Use when starting stage testing for a new product release or re-pinning the FBC images after a new ART build. Also use when stage testing on an existing PR is finished and the rehearsal job results need collecting and posting to the Jira tracker.
argument-hint: '{version} to set up testing (e.g. "3.11"), OR {pr-id} {jira-id} to collect final results and post them to Jira (e.g. "84239 TRACING-1234")'
---

# OpenTelemetry OCP CI Stage Testing

Set up stage testing for Red Hat build of OpenTelemetry release by creating a PR to the `openshift/release` repository that pins each OCP version's stage job to the ART-built FBC (file-based catalog) image, `quay.io/redhat-user-workloads/ocp-art-tenant/art-fbc`. ART background and dashboards are in the `otel-art-reference` skill.

## Modes

This skill has two independent entry points. Pick by what the user passed:

| Arguments | Mode | Run |
|---|---|---|
| A release version (`3.11`) | Setup | Steps 1-7 |
| A PR number and a Jira key (`84239 TRACING-1234`) | Final status collection | Steps 8-9 only |
| A PR number, no Jira key | Final status collection | Steps 8-9; ask for the tracker key first |
| Nothing, or ambiguous | — | Ask which one before doing anything |

The two modes run in separate sessions, usually days apart. Never run collection at the end of a setup run — see the note at the end of Step 7.

## Prerequisites

1. The `release` GitHub repository must be cloned in the workspace
2. Your GitHub fork of `openshift/release` must be configured as a remote
3. The `gh` CLI must be authenticated
4. The `oc` CLI must be logged into `app.ci` (`oc login --server=https://api.ci.l2s4.p1.openshiftapps.com:6443`) — needed for gcsweb/deck artifact access, and for authoritative results in Step 8. If the user won't log in, Step 8 has a `gh`-only fallback with stated limitations.
5. `skopeo`, `jq` and `curl` must be on the PATH (Step 1)
6. The `konflux` GitLab repository is only needed when a Tempo stage release is under test (Step 2, disconnected job). OTEL no longer comes from it.

## CI Jobs in Release Repository

Config file locations, naming patterns, variants (regular/FIPS/ARM), job-name patterns, and the separately-located disconnected job: see [references/ci-job-layout.md](references/ci-job-layout.md). Read it before Step 1.

## Steps

### Step 1: Get the ART FBC Images

Run from the workspace root:

```bash
bash .claude/skills/otel-art-reference/get-fbc-images.sh {VERSION}
```

It lists one entry per OCP version (`ocp_version`, `tag`, `digest`, `created`, `image`, `image_by_digest`). Use `image_by_digest`, and strip the leading `v` from `ocp_version` (e.g. `v4.19` → `4.19`) — file and job names use the bare version number. Never pin the floating tag: ART re-pushes `rhosdt-{VERSION}__v<ocp>__opentelemetry-rhel9-operator` and even the `__g<hash>` tags on every build, so only the digest stays the same for the days a rehearsal PR is open.

Check the output before using it:

1. **Coverage.** Every OCP version that has a `*-stage.yaml` config (see [references/ci-job-layout.md](references/ci-job-layout.md)) must appear in the output. If one is missing, stop and report it — ART has not built that catalog yet. Do not fall back to an older release's image. The output may list versions that have no stage config (e.g. 4.13, 4.15); ignore those.
2. **Digest.** For each version you will pin, confirm the digest in the output is what the registry serves for the tag:
   ```bash
   skopeo inspect --raw docker://{image} | skopeo manifest-digest /dev/stdin
   ```
   This must print the same `sha256:…` as `digest`. A difference means ART pushed a new build while you were working — rerun the script. Use this `--raw | manifest-digest` form: `skopeo inspect --format '{{.Digest}}'` fails on macOS for these multi-arch indexes.
3. **Note `created`** for each version; Step 7 reports it.

The image is multi-arch (amd64, arm64, ppc64le, s390x), so the same reference serves the regular, FIPS and ARM jobs.

### Step 2: Update CI Configuration Files

Branch from current `main` so the PR does not carry stale step-registry files:

```bash
cd release
git fetch origin
git checkout -b otel-{VERSION}-stage-tests origin/main
# if the branch already exists (re-pinning an open PR): git checkout otel-{VERSION}-stage-tests && git rebase origin/main
```

**Check the step registry has been migrated to ART.** The stage jobs install the catalog with the `distributed-tracing-install-otel-konflux-catalogsource` step, which must create the `registry.redhat.io/rhosdt` → `registry.stage.redhat.io/rhosdt` mirror and use the stage credentials. Without that, an ART catalog cannot pull its images:

```bash
grep -q 'registry.stage.redhat.io/rhosdt' ci-operator/step-registry/distributed-tracing/install/otel-konflux-catalogsource/distributed-tracing-install-otel-konflux-catalogsource-commands.sh \
  && echo migrated || echo NOT-MIGRATED
```

If it prints `NOT-MIGRATED`, stop and tell the user: the step registry still uses the legacy Konflux flow and needs the one-time ART migration PR before this skill can be used.

For each OCP version in the Step 1 output that has a stage config, update the file in `ci-operator/config/openshift/open-telemetry-opentelemetry-operator/`.

**File pattern:** `openshift-open-telemetry-opentelemetry-operator-main__opentelemetry-product-ocp-{VERSION}-{VARIANT}-stage.yaml`

**Changes to make** (under `tests[].steps.env`):
1. Set `MULTISTAGE_PARAM_OVERRIDE_OTEL_INDEX_IMAGE` to `quay.io/redhat-user-workloads/ocp-art-tenant/art-fbc@sha256:{DIGEST}`
2. Set `MULTISTAGE_PARAM_OVERRIDE_OTEL_TESTS_BRANCH` to `rhosdt-{VERSION}`. The step clones `openshift/open-telemetry-opentelemetry-operator` and runs the e2e tests from this branch, so it must match the release under test. The branch must already be prepared — see `otel-qe-prepare-operator-tests`.
3. Also update the disconnected test config (see "Disconnected test job" in [references/ci-job-layout.md](references/ci-job-layout.md)) — same PR. Set its `MULTISTAGE_PARAM_OVERRIDE_OTEL_INDEX_IMAGE` to the 4.16 FBC digest. Leave its `MULTISTAGE_PARAM_OVERRIDE_TEMPO_INDEX_IMAGE` alone unless a Tempo stage release is under test, in which case take the IIB from `konflux/release-payloads/tempo-stage-{VERSION}.yaml`. The disconnected job mirrors the catalog with `oc-mirror` and is not covered by the checks above; if it fails with an ART image, look at the `sed` rewrites in `distributed-tracing-install-disconnected-commands.sh` first.

**IMPORTANT:**
- Only update files for OCP versions that exist in the Step 1 output
- Do NOT create configs for versions not in the output
- Update ALL variants (regular, FIPS, ARM, UI). The ARM job (`4.14-arm-stage`) is no longer special: it uses the same catalogsource step and the same FBC reference as the others
- Tempo in the stage jobs comes from `redhat-operators`; do not add `MULTISTAGE_PARAM_OVERRIDE_TEMPO_INDEX_IMAGE` to them
- Don't skip the disconnected config just because it's in a different project directory
- Preserve all other configuration settings

### Step 3: Commit

```bash
git add <path-to-each-file-updated-in-step-2>  # only the specific files edited above, not a wildcard
git diff --cached --name-only                  # verify no unrelated files got staged
git commit -s -m "OTEL RHOSDT {VERSION}: Stage tests

Stage testing for RHOSDT: OTEL {VERSION}

- Updated OTEL FBC catalog images (pinned by digest) from ART builds"
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
  --body "Stage testing for RHOSDT: OTEL {VERSION}. Updated OTEL FBC catalog images (pinned by digest) from ART builds. Can be merged only after all jobs pass."
```

Note the PR number from the output — it's `{PR_NUMBER}` in Step 6.

### Step 6: Trigger Rehearsal Jobs

Rehearse one job first and check it, so a broken digest or config shows up once and not ten times. Use the 4.20 job (or the lowest version in the PR if there is no 4.20):

```bash
gh pr comment {PR_NUMBER} --repo openshift/release --body "/pj-rehearse {one-job-name}"
```

Once the job's `distributed-tracing-install-otel-konflux-catalogsource` step looks healthy (see below), trigger the rest:

```bash
gh pr comment {PR_NUMBER} --repo openshift/release --body "/pj-rehearse {job-list}"
```

Where `{job-list}` is a space-separated list of the remaining job names from the updated configs, including the disconnected job's periodic name — periodics rehearse via `/pj-rehearse` the same way presubmits do. Job name pattern:
```
periodic-ci-openshift-open-telemetry-opentelemetry-operator-main-opentelemetry-product-ocp-{VERSION}-{VARIANT}-stage-opentelemetry-stage-tests
periodic-ci-openshift-distributed-tracing-qe-main-ocp-4.16-disconnected-distributed-tracing-tests-disconnected
```

**Example:**
```
/pj-rehearse periodic-ci-openshift-open-telemetry-opentelemetry-operator-main-opentelemetry-product-ocp-4.19-stage-opentelemetry-stage-tests periodic-ci-openshift-open-telemetry-opentelemetry-operator-main-opentelemetry-product-ocp-4.20-stage-opentelemetry-stage-tests
```

**What a healthy install step looks like.** In the job's `artifacts/opentelemetry-stage-tests/distributed-tracing-install-otel-konflux-catalogsource/build-log.txt` (URL pattern in [references/browsing-artifacts.md](references/browsing-artifacts.md)):
- `DT_INDEX_IMAGE is set to: quay.io/redhat-user-workloads/ocp-art-tenant/art-fbc@sha256:…` — the digest you pinned.
- `imagedigestmirrorset.config.openshift.io/otel-registry created`. On OCP 4.12, which has no `ImageDigestMirrorSet` CRD, it is `imagecontentsourcepolicy.operator.openshift.io/otel-registry created` instead. Both mirror `registry.redhat.io/rhosdt` to `registry.stage.redhat.io/rhosdt`.
- `otel-catalogsource CatalogSource created successfully` — the catalog reached `READY`.

If the CatalogSource never reaches `READY`, the step dumps the pod and node pull diagnostics in the same log. If the operator pods later hit `ImagePullBackOff`, the mirror or the stage credentials are the first things to check.

Two rehearsal behaviors to plan around:
- Pushing a new commit to the PR aborts the rehearsals that are running. Push first, then comment, and never push while a round is in progress unless you intend to restart it.
- Commenting `/pj-rehearse` with a subset retriggers only those jobs. To rerun one failed job, comment just its name; the others are not affected.

### Step 7: Report Setup Results

Provide the user with:
1. PR URL
2. List of updated config files
3. FBC digest used for each OCP version, with the build date (`created`) from Step 1
4. Rehearsal jobs triggered

Testing is now in progress. Steps 8-9 are a separate, later pass — do NOT run them here. Jobs take hours, are rerun after fixes, and more `/pj-rehearse` rounds usually follow. A status collected now is wrong by the time anyone reads it.

## Final Status Collection

Steps 8-9 — collecting each rehearsed job's final result and posting the table to the Jira tracker. Full procedure in [references/final-status-collection.md](references/final-status-collection.md); read it when running collection mode.

## Browsing CI Job Logs and Artifacts

When a job fails and you need to dig into logs, JUnit XML, or the `openshift-observability-qe-agent` diagnosis, see [references/browsing-artifacts.md](references/browsing-artifacts.md) — gcsweb URL patterns, authentication, and which artifact to read first.
