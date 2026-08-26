---
name: otel-qe-test-jobs
description: Use this skill for OpenTelemetry QE upstream, stage, and downstream release testing, OpenTelemetry operator tests, tracing UI tests, CI strategy, CI job configs, operator build steps, release criteria, stage job triggering, and disconnected testing workflows.
---

# OpenTelemetry - Testing a Release

This skill provides the quality engineering procedures for upstream, stage, and downstream release testing of Red Hat build of OpenTelemetry (OpenTelemetry Operator) and Tracing UI (Distributed Tracing Console Plugin). For team contacts, repositories, and product info, use the `rhosdt-team` skill.

## When to Use This Skill

Use for: running or looking up OTEL/Tracing UI tests, CI jobs, or CI configs; planning or executing release testing (upstream/stage/downstream); building operators locally; triggering stage jobs via Gangway API; running tests on ARM, IBM P/Z, or disconnected environments; checking release criteria or QE release trackers.

## QE Tasks Summary

QE owns: strategy and planning, test design (integration/E2E/performance/compatibility), release testing and sign-off, test automation and CI maintenance, exploratory testing, and defect reporting including bug and CVE fix verification.

## Test Matrix

Essential cluster configs: [Distributed Tracing Test Matrix](https://docs.google.com/spreadsheets/d/1HMXgIxR9pUBIOaqJ8OQcxZbfeLOGFIA3WC1xjRxuPs8/)

## CI/CD Tools and Services

OpenShift CI (Prow) for automated testing, Jenkins flexy-install for manual cluster provisioning, Cluster Bot for quick clusters, Chainsaw for e2e tests, Cypress for UI tests, Konflux for building/testing/releasing.

## CI Strategy

**Upstream:** Daily OpenShift CI rebase PR on forked repos in OpenShift org, with e2e job that builds operator+bundle and runs full test suites on a provisioned cluster.
**Stage:** OpenShift CI jobs accept FBC fragment or bundle image and run full e2e suite on a provisioned cluster.
**Downstream:** OpenShift CI installs stable operators from production catalog and runs full e2e suite across OCP versions N, N-1, N-2.

## QE Release Trackers

| Release | Jira Key |
|---------|----------|
| RHOSDT 3.9.1 | [TRACING-6099](https://redhat.atlassian.net/browse/TRACING-6099) |
| RHOSDT 3.9.0 | [TRACING-5986](https://redhat.atlassian.net/browse/TRACING-5986) |
| RHOSDT 3.8.0 | [TRACING-5771](https://redhat.atlassian.net/browse/TRACING-5771) |
| RHOSDT 3.7.0 | [TRACING-5625](https://redhat.atlassian.net/browse/TRACING-5625) |

## Release Criteria

All required: (1) 100% test pass rate — failures must be investigated, resolved, and re-tested. (2) Every bug and CVE fix verified by QE with no regressions. (3) Documentation verified by QE and approved by docs team.

## Konflux

- [RHOSDT workspace](https://konflux-ui.apps.stone-prd-rh01.pg1f.p1.openshiftapps.com/ns/rhosdt-tenant/applications/)
- [COO workspace](https://konflux-ui.apps.stone-prd-rh01.pg1f.p1.openshiftapps.com/ns/cluster-observabilit-tenant/applications)
- [RHOSDT Konflux productization docs](https://gitlab.cee.redhat.com/distributed-tracing/konflux)
- [Release payloads](https://gitlab.cee.redhat.com/distributed-tracing/konflux/-/tree/main/release-payloads?ref_type=heads)

### Konflux Integration Tests

E2E tests trigger on new bundle builds, upgrade tests trigger on new FBC builds — both on main branch commits only (`/test` does NOT trigger them). Pipelines are in `.tekton/integration-tests/pipelines/` of each `konflux-*` repo. Tests use the `rhosdt-x.y` branch from [os-observability](https://github.com/os-observability) repos, configured in `konflux-release-data`.

**View results:** Konflux Activity tab → Pipeline runs → filter by "Tests".
**Re-run:** `kubectl label snapshot <name> test.appstudio.openshift.io/run=all` or use the Konflux UI Pipeline runs → three dots → Rerun.

---

## Test Suites

### Verify Operator and Related Images and Versions

Confirm operator, operand, and component versions are accurate and images can be pulled. Runs from Konflux CI integration test jobs — pipelines in [konflux-opentelemetry](https://github.com/os-observability/konflux-opentelemetry).

### Security Testing (SAST and DAST)

**SAST:** Automated Snyk scans via `openshift-ci-security` workflow (on demand). Valid vulnerabilities get a TRACING Jira issue.

**DAST:** RapiDAST e2e suite runs as a Tekton step in Konflux integration test pipelines, auto-triggered on new builds. [Test suite](https://github.com/openshift/distributed-tracing-qe/tree/main/tests/e2e-dast). High alerts are release blockers — create a TRACING Jira issue and triage with Dev/ProdSec. Low severity alerts are NOT release blockers. [DAST Workflow](https://docs.google.com/document/d/1HSW6pJ8J6GJ4F-VfLm31bSxuPkWf0UH3aHgVbTKVQ8A/)

### Multiarch ARM, IBM P and Z Environment Tests

**Environments:** Any one supported OCP version

**Goal:** Test Distributed Tracing operators on ARM, IBM P and Z environments. OpenShift CI jobs are auto-triggered once the Konflux CI FBC build pipeline completes.

**Required Parameters:** `MULTISTAGE_PARAM_OVERRIDE_OTEL_INDEX_IMAGE` (OTEL FBC/bundle) and `MULTISTAGE_PARAM_OVERRIDE_TEMPO_INDEX_IMAGE` (Tempo FBC/bundle) — both mandatory, pass via steps.env or Gangway API pod_spec_options. Multiarch tests expect the bundle image, not the IIB.

**IBM P/Z Cluster Provisioning:** Automatic cluster provisioning for IBM P and Z does not work. Clusters must be requested explicitly from IBM contacts listed in the `rhosdt-team` skill.

**Automation:** OpenShift CI job configs in [openshift/release](https://github.com/openshift/release) — OTEL configs under `ci-operator/config/openshift/open-telemetry-opentelemetry-operator/` (ARM, IBM P, IBM Z stage variants). Test steps: [OTEL stage](https://github.com/openshift/release/tree/main/ci-operator/step-registry/distributed-tracing/tests/opentelemetry/stage).

### Cluster Observability Operator and Distributed Tracing UI Plugin Tests

**Environments:** All supported OCP versions

**Goal:** Test features, bug fixes, and detect regressions.

**Automation:**
- [OpenShift CI job configs](https://github.com/openshift/release/tree/main/ci-operator/config/openshift/distributed-tracing-console-plugin)
- [OpenShift CI step to run tests](https://github.com/openshift/release/tree/main/ci-operator/step-registry/distributed-tracing/tests/tracing-ui)
- [Tracing UI tests](https://github.com/openshift/distributed-tracing-console-plugin/tree/main/tests)

#### Building COO and Console Plugin Images

**COO Operator:** Clone [rhobs/observability-operator](https://github.com/rhobs/observability-operator). Set `openshift.enabled` to `true` in `cmd/operator/main.go`. Build with `make generate bundle operator-image bundle-image operator-push bundle-push` using `IMG_BASE`, `VERSION`, `BUNDLE_IMG` env vars pointing to your quay.io registry. Install with `operator-sdk run bundle <bundle-img> --install-mode AllNamespaces` in the `observability-operator` namespace.

**Console Plugin:** Clone [openshift/distributed-tracing-console-plugin](https://github.com/openshift/distributed-tracing-console-plugin). Build with `podman build --platform=linux/amd64 -f Dockerfile .` and push. Update the COO CSV with `--images=ui-distributed-tracing=<img>` (also `pf5` and `pf4` variants). Run Cypress e2e tests per the README.

### OpenTelemetry Automated Tests

**Environments:** All supported OpenShift versions.

**Goal:** Run OpenTelemetry automated e2e tests.

**Stage Install Namespace:** `opentelemetry-operator-system` (stage jobs only; downstream jobs use `openshift-opentelemetry-operator`)

**Stage Test Repository:** [os-observability/opentelemetry-operator](https://github.com/os-observability/opentelemetry-operator) - use `MULTISTAGE_PARAM_OVERRIDE_OTEL_TESTS_BRANCH` parameter to specify the branch

**Automation:**
- [OpenShift CI job configs](https://github.com/openshift/release/tree/main/ci-operator/config/openshift/open-telemetry-opentelemetry-operator)
- [OpenShift CI steps to run the tests](https://github.com/openshift/release/tree/main/ci-operator/step-registry/distributed-tracing/tests/opentelemetry)
- [OpenTelemetry operator tests](https://github.com/open-telemetry/opentelemetry-operator/tree/main/tests)
- [Additional OpenTelemetry components tests](https://github.com/openshift/distributed-tracing-qe/tree/main/tests/e2e-otel)

#### Building and Installing OpenTelemetry Operator

See [building-operator.md](building-operator.md) for the full build, install, and test-run procedure.

### Upgrade Tests

Verify upgrade mechanism and data integrity between releases. Konflux CI pipelines in `.tekton/integration-tests/pipelines/` of [konflux-opentelemetry](https://github.com/os-observability/konflux-opentelemetry). Tests in `tests/e2e-openshift-upgrade/upgrade` of each operator repo.

### Disconnected Tests

Verify full e2e suite passes in disconnected environments. Requires `MULTISTAGE_PARAM_OVERRIDE_OTEL_INDEX_IMAGE` and `MULTISTAGE_PARAM_OVERRIDE_TEMPO_INDEX_IMAGE`. Tests in [e2e-disconnected](https://github.com/openshift/distributed-tracing-qe/tree/main/tests/e2e-disconnected). CI steps in `step-registry/distributed-tracing/install/disconnected` and `tests/disconnected`.

---

## Appendix

### Triggering Release Testing Stage Jobs

1. Find stage testing jobs:
   ```bash
   cat *periodics.yaml | grep -i 'name: periodic-ci-openshift' | grep -i stage | cut -d ':' -f 2
   ```
2. Set variables:
   ```bash
   JOB_NAME="<job-name-from-step-1>"
   GANGWAY_API="https://gangway-ci.apps.ci.l2s4.p1.openshiftapps.com"
   TOKEN=""  # Get from OCP CI console: https://console-openshift-console.apps.ci.l2s4.p1.openshiftapps.com/
   ```
3. Trigger via Gangway API. ALL parameters are mandatory — missing parameters cause immediate job failure. Use `brew.registry.redhat.io` for images, not `registry-proxy.engineering.redhat.com`.
   ```bash
   curl -X POST -d '{
     "job_execution_type": "1",
     "pod_spec_options": {
       "envs": {
         "MULTISTAGE_PARAM_OVERRIDE_OTEL_INDEX_IMAGE": "brew.registry.redhat.io/rh-osbs/iib:<id>",
         "MULTISTAGE_PARAM_OVERRIDE_OTEL_TESTS_BRANCH": "rhosdt-3.10"
       }
     }
   }' -H "Authorization: Bearer ${TOKEN}" "${GANGWAY_API}/v1/executions/${JOB_NAME}"
   ```
4. Get job URL and check status:
   ```bash
   curl -X GET -H "Authorization: Bearer ${TOKEN}" "${GANGWAY_API}/v1/executions/<id-from-step-3>"
   ```
   QE Private Deck: https://qe-private-deck-ci.apps.ci.l2s4.p1.openshiftapps.com/?type=periodic (filter with `job=*opentelemetry*`).
