---
name: otel-qe-prepare-ci
description: Use this skill to prepare CI for every new major or minor RHOSDT version, which gets a new rhosdt-* product branch (a new ART group). It replaces the Konflux integration test scenarios of the ART tenant and moves the pre-merge CI config of the operator and the collector in release to the new branch. A patch or CVE fix release or a new ART build on the same branch needs neither.
---

# Prepare CI for a Release

Run this skill for every new major or minor version. Each gets its own `rhosdt-*` branch and its own ART group; patch and CVE fix releases do not. It prepares two things:

1. **Pre-merge CI in `release`:** move the config of the operator and of the collector to the new branch, and do not keep the config of the old branch. Steps: [references/pre-merge-ci.md](references/pre-merge-ci.md). What the jobs do: [`ci-job-layout.md`](../otel-qe-ocp-ci-tests/references/ci-job-layout.md).
2. **Konflux integration tests:** replace the scenarios of the previous release in `konflux-release-data`. The pipelines need no change for a release. Steps and conventions: [references/konflux-its.md](references/konflux-its.md). How to check the results: `otel-art-reference` ([RELEASE.md](../otel-art-reference/RELEASE.md#check-integration-test-results)).

We follow the rolling release model, so only one version is supported at a time. A patch release, a CVE fix release or a new ART build on the same branch needs neither change.

The stage and downstream jobs in `release` are not covered here. They are re-pinned for every release, patch releases included (`MULTISTAGE_PARAM_OVERRIDE_OTEL_INDEX_IMAGE` and `OTEL_TESTS_BRANCH`), with the `otel-qe-ocp-ci-tests` skill.
