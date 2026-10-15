# Release

ART auto-releases component images to stage registry (not FBC fragments).
However, the production release process runs the stage release again to ensure all Konflux checks still pass.

The release is documented in https://art-docs.engineering.redhat.com/konflux/self-service-fbc-release/
and requires running Tekton pipelines: `release-from-fbc` and `trigger-prod-release`.

The pipelines can be run from:
* [ARC OpenShift](https://console-openshift-console.apps.artc2023.pc3z.p1.openshiftapps.com/k8s/ns/art-rhosdt-tenant/tekton.dev~v1~Pipeline)
* [ART pipelines](https://art-pipelines-ui-art-pipelines-ui.apps.artc2023.pc3z.p1.openshiftapps.com/#/pipelines). This UI allows customizing parameters for rerun.

## Release testing

### ART team: check the integration test results

Release only FBC builds whose tests passed. Konflux integration tests (ITS) run automatically on every FBC build, in the application `fbc-rhosdt-<art version with dashes>` of `art-rhosdt-tenant`: e2e tests on the minimum and the maximum supported OCP version, a DAST scan on the maximum, and an upgrade test. The tests run only for the FBC builds of those OCP versions; the other FBC builds have no test. The scenarios are defined in `konflux-release-data` (`tenants-config/cluster/kflux-ocp-p01/tenants/art-rhosdt-tenant/otel-integration-tests.yaml`), the pipelines are in `distributed-tracing-qe` (`konflux/integration-tests/`, see its README), and the runs are in the [Konflux UI](https://konflux-ui.apps.kflux-ocp-p01.7ayg.p1.openshiftapps.com/ns/art-rhosdt-tenant/applications).

1. Choose the FBC builds to release with [get-fbc-images.sh](./get-fbc-images.sh), which pins them by digest.
2. Check the results of exactly these builds with [check-its.sh](./check-its.sh): it takes the pullspecs, finds the Snapshot of each digest and prints, as YAML, the result of its scenarios with a link to every PipelineRun (the link opens while Konflux still keeps the run, the result stays on the Snapshot). It exits non-zero when a result is missing, still running or not passed.
   ```bash
   ./get-fbc-images.sh 0.158 > fbc-images.yaml
   ./check-its.sh "$(sed -n "s/^pullspecs: *'\(.*\)'$/\1/p" fbc-images.yaml)" > its.yaml
   ```
3. To run a scenario again, label its Snapshot: `oc label --overwrite -n art-rhosdt-tenant snapshot <name> test.appstudio.openshift.io/run=<scenario>`. The label is removed when the run starts; Konflux does not start a second run of the same scenario on a Snapshot while one is in progress. How to read a failed run: "Operating the scenarios" in the `otel-qe-prepare-ci` skill (`references/konflux-its.md`).

This is the whole check for every release type: major, minor, patch and CVE fix.

### Product team: release testing

For a major or minor release (a new `rhosdt-<version>` branch and ART group), run the `/otel-qe-release-testing` skill with the version (e.g. `0.159`). It walks through the checklist (branch and CI preparation, Konflux integration tests, the pre-merge e2e matrix on every supported OCP version with FIPS, arm64 and the console UI, disconnected mirroring, IBM P and Z, release notes and docs, CVE and bug fixes), naming the QE skill that runs each part. A patch or CVE fix release of the same branch needs no QE testing: the critical e2e tests ran pre-merge on every pull request to the branch (`e2e-pre-merge`), and the integration tests above are the ART team's check. CVE and bug fixes are verified on their issues with `otel-qe-verify-fixes` when asked.

## Run `release-from-fbc` pipeline
Create the [pipeline CR](./release-from-fbc.yaml), replacing:
* `<GROUP>` — e.g. `rhosdt-0.158` (the ocp-build-data group branch)
* `<ASSEMBLY_VERSION>` — e.g. `0.158.0`
* `<FBC_PULLSPECS>` — comma-separated FBC pullspecs from [get-fbc-images.sh](./get-fbc-images.sh)
* `jira-bugs` — comma-separated list of JIRA issue IDs to include in the advisory. CVE trackers need correct component label e.g. `pscomponent:rhosdt/opentelemetry-rhel9-operator`
* `force` — the template sets `false`. Set to `true` to override the existing shipment merge request.
* `dry-run` — the template sets `true`. Set to `false` to actually create the shipment MR.

The pipeline creates a shipment merge request in [hybrid-platforms/art/ocp-shipment-data](https://gitlab.cee.redhat.com/hybrid-platforms/art/ocp-shipment-data/) (e.g. https://gitlab.cee.redhat.com/hybrid-platforms/art/ocp-shipment-data/-/merge_requests/973), and triggers a GitLab CI pipeline on the MR. The pipeline releases the images to stage again to make sure Conforma checks pass.

Review the MR (e.g. the release notes) and approve it.

## Run `trigger-prod-release` pipeline
Run `trigger-prod-release` pipeline to continue the release to production registry.
The pipeline takes argument the merge request from the previous step to [hybrid-platforms/art/ocp-shipment-data](https://gitlab.cee.redhat.com/hybrid-platforms/art/ocp-shipment-data/).

Create the [pipeline CR](./trigger-prod-release.yaml), replacing:
* `<MR_IID>` — the merge request ID from the previous step (e.g. `742`)
* `dry-run` — `true` (default). Set to `false` to actually trigger the prod release.

The pipeline enables release to production registry on Gitlab MR pipeline. If the Gitlab MR pipeline fails (or partly fails) just rerun the `trigger-prod-release`
and the unreleased FBCs will rerun.

## Prepare for next release
1. Operator CSV version in `bundle/opentelemetry-product.package.yaml` on the `rhosdt-<version>` branch
1. Bundle CSV modifications (`version`, `replaces`, `name`) in `bundle/art.yaml`

### New ART group (a new `rhosdt-<version>` branch)
We follow the rolling release model, so only the latest version is supported and tested. Every new major or minor operator version gets a new `rhosdt-<version>` branch and a new ART group; patch and CVE fix releases stay on the branch.
1. Request new branches in `ocp-build-data` from the ART team
1. Update version in `ocp-build-data`  in `group.yml` on the `rhosdt-<version>` branch (only for a new major or minor version)
1. Create downstream branches - copy ART configuration `bundle`/[`art.yaml`, `image-references`, `opentelemetry-product.package.yaml`] with `Dockerfile.art` and `renovate.json`.
1. Update versions in the ART configuration files in `bundle`
1. Update the CI with the `otel-qe-prepare-ci` skill: move the pre-merge CI config of the operator and of the collector in `release` to the new branch, and replace the Konflux integration test scenarios of the previous release with the ones of the new ART group. A patch or CVE fix release needs no change in either place.
1. Configure mintmaker for new downstream branches in `konflux-release-data`
