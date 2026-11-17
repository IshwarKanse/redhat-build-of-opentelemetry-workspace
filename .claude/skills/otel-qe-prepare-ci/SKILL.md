---
name: otel-qe-prepare-ci
description: Use this skill to prepare CI for every new major or minor RHOSDT version, which gets a new rhosdt-* product branch (a new ART group). It moves or copies the Konflux integration test scenarios of the ART tenant and the pre-merge CI config of the operator and the collector in release to the new branch, and carries over the changes of the upstream OpenShift CI jobs. A patch or CVE fix release or a new ART build on the same branch needs neither.
---

# Prepare CI for a Release

Run this skill for every new major or minor version: each gets its own `rhosdt-*` branch and ART group. It prepares two things:

1. **Pre-merge CI in `release`:** move or copy the config of the operator (the critical `e2e-pre-merge` job and the optional e2e matrix jobs) and of the collector to the new branch, carry over what changed in the upstream CI jobs and steps since the previous version (new tests, a new way to run them, new image builds), and review the OpenShift versions of the matrix. Steps: [references/pre-merge-ci.md](references/pre-merge-ci.md). What the jobs do: [`ci-job-layout.md`](../otel-qe-ocp-ci-tests/references/ci-job-layout.md).
2. **Konflux integration tests:** move or copy the scenarios of the previous release in `konflux-release-data` to the new ART group. The pipelines need no change for a release. Steps and conventions: [references/konflux-its.md](references/konflux-its.md). How to check the results: `/otel-art-reference` ([RELEASE.md](../otel-art-reference/RELEASE.md#release-checks)).

## Move or copy: ask first

We follow the rolling release model, so only one version is supported at a time, but releases overlap: while the new major or minor version is productized, the previous version can still have CVE or patch releases that build and test on its branch. Before changing anything, ask the user, and wait for the answer, which of these they want, for the pre-merge CI and for the Konflux scenarios:

- **Move** to the new branch and ART group: the previous version keeps no CI. Fits when it has no release in progress or planned.
- **Copy** for the new branch and ART group, with the changes the new version needs: the previous version keeps its jobs and scenarios until its last release is out. Remove them then, in a separate pull request (and merge request).

The steps in the references cover both.

Running the e2e matrix for a release is not covered here: that is the `/otel-qe-ocp-ci-tests` skill, on a pull request to the product branch.
