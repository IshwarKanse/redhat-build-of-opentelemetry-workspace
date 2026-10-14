# Task 3: Konflux E2E and Upgrade Integration Test Jobs

The description of the Task `[QE] RHOSDT {version} Konflux E2E and Upgrade Integration Test Jobs`. Fill in `{version}` and `{art version with dashes}` (the version with dashes, e.g. `0-158` for `0.158`), and use real newlines.

```
Goal: Verify the Konflux integration tests (ITS) pass for {version}. They run automatically on every FBC build of ART. Complete this before the Tests on Supported OCP Versions Task — see Testing order in the Epic description.

1. Choose the FBC builds to release (`otel-art-reference/get-fbc-images.sh {version}`) and check the result of the ITS of exactly these builds: `check-its.sh` in `otel-art-reference` with the pullspecs of `get-fbc-images.sh` (see "Check integration test results" in its `RELEASE.md`) (application `fbc-rhosdt-{art version with dashes}`; runs: https://konflux-ui.apps.kflux-ocp-p01.7ayg.p1.openshiftapps.com/ns/art-rhosdt-tenant/applications, Activity tab → Pipeline runs). It lists only the runs for the OCP version of each scenario, as YAML with a link to every PipelineRun.
2. The e2e ITS verify the versions and images and run the chainsaw tests of the product branch. The 4.22 e2e also runs the DAST scan — triage any high-severity DAST alerts (these are release blockers); the results are in the GCS folder `rhosdt/{version}/otel` (for example `rhosdt/0.158/otel`). The upgrade ITS upgrades the released operator to the FBC.
3. Read the result of each scenario on the Snapshot of its OCP version, look at the task that failed, and re-run a failed ITS. Re-running: `otel-art-reference/RELEASE.md`. Access, results and how to read a failure: "Operating the scenarios" in `otel-qe-prepare-ci/references/konflux-its.md`.
```
