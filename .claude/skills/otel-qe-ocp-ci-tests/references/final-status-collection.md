## Final Status Collection

**Input:** `{PR_NUMBER}` (the pull request of `openshift/open-telemetry-opentelemetry-operator` the jobs ran on; it may be merged by now, the statuses stay), from the skill arguments (see Modes). Ask for it when missing — do not guess a PR number from the branch or from recent work.

**Run this only when the user says testing on the PR is finished.** Invoking the skill with `collect` and a PR number is itself that signal; the other triggers are "testing is done", "all jobs have passed", "give me the results". If any job is still running or is queued for a rerun, testing is not finished — say so and wait.

**Failing jobs do not block the table.** A red job at this point has normally already been debugged, with bugs filed or fixes landed elsewhere. Report the failures in the table and name them in the summary line, with the bug for each; only a job still *running* is a reason to wait.

### Step 5: Collect the final job status

Every job of the matrix must have a result, not only the ones that were triggered. The expected jobs are the optional tests of the config (Step 2 of the skill) plus the always-run `e2e-pre-merge` and `fips-check`, which belong in the table too. Compare that list with the statuses of the PR.

**Statuses from GitHub.** Prow posts one status per job and commit, context `ci/prow/art-build-<test>`:
```bash
gh pr view {PR_NUMBER} --repo openshift/open-telemetry-opentelemetry-operator --json headRefOid -q .headRefOid
gh api repos/openshift/open-telemetry-opentelemetry-operator/commits/{SHA}/statuses --paginate \
  --jq '.[] | select((.context|startswith("ci/prow/art-build-e2e-")) or .context=="ci/prow/art-build-fips-check") | "\(.state)\t\(.context)\t\(.target_url)"'
```
A context appears once per run, newest first; the first entry of each context is the result of its latest run (`success`, `failure`, `error`, `pending`). `pending` means testing is not finished; stop and say so. A job of the matrix with no status on the head commit was not run on that commit: look at the earlier commits of the PR (`gh pr view --json commits`) and report the newest run, and say on which commit it ran. A job with no status on any commit is **NOT RUN** in the table.

**History.** Every run of a job on the PR, across commits and reruns, including aborted ones, comes from the `get_prow_job_history` tool of the `openshift-ci` MCP server (`/otel-openshift-ci`), one call per job of the matrix:
- `job_name`: `pull-ci-openshift-open-telemetry-opentelemetry-operator-rhosdt-{version}-art-build-{test}`
- `deck`: `qe-private`, `pr`: `{PR_NUMBER}`, `org_repo`: `openshift/open-telemetry-opentelemetry-operator`

It returns the PR's runs newest first, each with its result, commit (`pr_sha`) and Spyglass link; a note that the PR directory does not exist means the job never ran on the PR, or its runs have aged out of storage: if the job has a status on the PR (above), report that result and say its run logs are gone, not NOT RUN.

Use the history to fill the `Runs` column (count and earlier results) and when the statuses look incomplete. The `target_url` of a status is the Spyglass page of that run. The job history page of the private deck stays the link for people in the table below.

**Take the result of the most recent run of each job.** An earlier failure that was later fixed and reran green is a PASS; note the rerun in passing rather than reporting the stale failure.

### Step 6: Post the results table on the pull request

Post the table as a comment on the pull request the jobs ran on; it is the matrix result of the release testing (`/otel-qe-release-testing`) and stays with the PR.

```bash
gh pr comment {PR_NUMBER} --repo openshift/open-telemetry-opentelemetry-operator --body-file /tmp/matrix-results.md
```

Show the user the rendered table before posting. If a later rerun changes a result, edit that comment (`gh api -X PATCH repos/openshift/open-telemetry-opentelemetry-operator/issues/comments/{id} -f body=...`, the id from `gh api repos/.../issues/{PR_NUMBER}/comments`) rather than adding a second one, so the PR carries one final table.

**Comment format:**
```markdown
Final results of the e2e matrix jobs on this PR (statuses of commit `abc1234`, run history on the private deck):

| Job | Result | Runs | Run |
| --- | --- | --- | --- |
| `e2e-ocp-4-12` | ✅ PASS | 1 | [spyglass](https://qe-private-deck-ci.apps.ci.l2s4.p1.openshiftapps.com/view/gs/qe-private-deck/pr-logs/pull/openshift_open-telemetry-opentelemetry-operator/350/pull-ci-openshift-open-telemetry-opentelemetry-operator-rhosdt-0.158-art-build-e2e-ocp-4-12/2110463341993398272) |
| `e2e-ocp-5-0` | ❌ FAIL | 3 (FAILURE, ABORTED earlier) | [spyglass](...) |
| `e2e-ocp-4-18-arm64` | ⚪ NOT RUN | 0 | — |

Run history: the job history pages of the private deck, e.g. [e2e-ocp-4-12](https://qe-private-deck-ci.apps.ci.l2s4.p1.openshiftapps.com/job-history/gs/qe-private-deck/pr-logs/directory/pull-ci-openshift-open-telemetry-opentelemetry-operator-rhosdt-0.158-art-build-e2e-ocp-4-12)

**5 passed, 1 failed, 1 not run.** Still failing: `e2e-ocp-5-0`. Not run: `e2e-ocp-4-18-arm64`.
```
The first column is the test name (`art-build-` and the job prefix stripped). The `Run` link is the `target_url` of the latest status. The `Runs` column carries the earlier results in parentheses so a rerun history is visible without opening the link.

**Rules:**
- Bucket and host must match: the jobs of the product branch report to `qe-private-deck` on the private deck host above.
- Name the TRACING bug next to every failed job that has one.
