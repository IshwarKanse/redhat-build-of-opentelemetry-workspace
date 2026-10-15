---
name: otel-qe-release-testing
description: Step-by-step QE testing of a major or minor Red Hat build of OpenTelemetry (RHOSDT, OTEL operator) release, a new rhosdt-<version> branch and ART group - prepare the branch and CI, Konflux integration tests, the pre-merge e2e matrix with FIPS, arm64 and console UI, disconnected mirroring, IBM P and Z, release notes and docs, CVE and bug fix verification. Use whenever someone asks how to test, verify, qualify or sign off an RHOSDT or OpenTelemetry operator release, what the release testing checklist is, or which skill runs which part, even when they only name a version such as 0.158 or say "the next OTEL release". Patch and CVE fix releases need no QE testing.
argument-hint: '{version} (e.g. "0.159"), the operator version of the major or minor release'
---

# RHOSDT OTEL release testing

What QE runs and checks before a major or minor release of the Red Hat build of OpenTelemetry ships, in order, with the skill that does each part. Nothing here is tracked in Jira: there is no release Epic and no progress comment. Results are reported to the person asking, in the chat and on the pull requests the jobs ran on; Jira is touched only to file a bug for an unexplained failure, or to reply on an existing issue when a CVE or bug fix is verified.

## Step 1: Identify the release

Ask for the version if it was not given. The version is the operator version (ART version), for example `0.159`; it names the product branch `rhosdt-<version>` of `openshift/open-telemetry-opentelemetry-operator` and `openshift/redhat-opentelemetry-collector`, the ART group in `ocp-build-data`, the FBC tags and the Konflux application `fbc-rhosdt-<version with dashes>`. Only the latest version is supported and tested (rolling release model).

This checklist is for a **major or minor release**: a new `rhosdt-<version>` branch and a new ART group (for example `0.158` after `3.11`, `0.159` after `0.158`). A **patch or CVE fix release** is a new build of the existing branch and needs no QE testing: the critical `e2e-pre-merge` job gated every pull request to the branch, and the ART team checks the Konflux integration tests of the FBC builds it releases (`otel-art-reference`, `RELEASE.md`, "Check integration test results"). When someone asks about a patch or CVE fix release, say that and stop; if the release carries CVE or bug fixes they want verified, that is `otel-qe-verify-fixes` on its own.

## Step 2: The checklist

Run the parts in this order; the later ones depend on the earlier ones.

### 2.1 Prepare the product branch

`otel-qe-prepare-operator-tests` with the version: it syncs `rhosdt-<version>`, adds the collector component tests and the console UI test, removes the hardcoded community collector image and the node affinity of the target allocator tests, and opens the pull request. That pull request is where the e2e matrix runs (2.4), so open it before the matrix and merge it once the matrix is green.

### 2.2 Prepare CI

`otel-qe-prepare-ci`: move the pre-merge CI config of the operator and the collector in `openshift/release` to the new branch, review the OpenShift versions of the matrix and the test lists, and replace the Konflux integration test scenarios of the previous release in `konflux-release-data`.

### 2.3 Konflux integration tests

Check the integration tests of the FBC builds to release with the procedure in `otel-art-reference` (`RELEASE.md`, "Check integration test results"): `get-fbc-images.sh`, then `check-its.sh` on those pullspecs. Every scenario of each FBC must have passed; a failed scenario is rerun by labelling its Snapshot, and "Operating the scenarios" in `otel-qe-prepare-ci/references/konflux-its.md` explains how to read a failure.

**Triage the DAST result**: a high-severity alert in the RapiDAST report (GCS folder `rhosdt/<version>/otel`) is a release blocker.

Do this before the matrix: an FBC that does not install or a failing upgrade is fixed first, and the matrix is cheaper to run once the branch is stable.

### 2.4 The pre-merge e2e matrix on a sample of the supported OpenShift versions

`otel-qe-ocp-ci-tests` with the version and the pull request of 2.1 (Step 1 of that skill says which pull request to use). It lists the optional jobs of the `art-build` config in `openshift/release` and triggers them with `/test` comments: the full chainsaw suite on each sampled OpenShift version (the versions are in the tests table of `otel-qe-ocp-ci-tests/references/ci-job-layout.md`; the Konflux integration tests cover the rest), the FIPS and arm64 variants, and the OpenTelemetry Collector dashboard test in the OpenShift console. Every job defined in the config must pass; nothing is skipped without the user saying so.

For a failing job follow Steps 3 and 4 of `otel-qe-ocp-ci-tests` (qe-agent step first, rerun with `/test`; a new commit needs the optional jobs triggered again) and file a TRACING bug for an unexplained failure. When every job is green, the collection mode of `otel-qe-ocp-ci-tests` posts the results table as a comment on the pull request.

### 2.5 Disconnected mirroring pre-check

`otel-qe-verify-disconnected-mirroring` on the bundle of the FBC: every image the operator needs must be in `spec.relatedImages`, pinned by digest, or air-gapped mirroring breaks. Takes seconds and needs no cluster.

### 2.6 IBM P and IBM Z

`otel-qe-test-ibm` on a ppc64le and an s390x cluster (manually requested, outside OpenShift CI; the `rhosdt-team` skill has the contacts). It installs the operator from the FBC with its dependencies and runs the chainsaw suites, and lists the failures expected on these architectures (the eBPF `obi` receiver, Node.js auto-instrumentation). File bugs only for unexplained failures.

### 2.7 Release notes and documentation

Read the release notes in the shipment merge request of `hybrid-platforms/art/ocp-shipment-data` that the `release-from-fbc` pipeline creates (`otel-art-reference`, `RELEASE.md`). Check that every documented feature, known issue and fix is reflected in the product documentation (`openshift-docs`, branch `standalone-otel-docs-main`), and raise the gaps with the docs team.

### 2.8 CVE and bug fixes

`otel-qe-verify-fixes`: look up each Jira issue and CVE of the release from the shipment merge request, verify the fix, and reply on the issue with the result. This is the one place Jira is written to.
