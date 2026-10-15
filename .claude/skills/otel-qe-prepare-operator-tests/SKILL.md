---
name: otel-qe-prepare-operator-tests
description: Prepare the OpenTelemetry operator repository's product branch (rhosdt-<version>) for QE product/pre-GA testing (the e2e matrix jobs in OpenShift CI, the Konflux integration tests, IBM P/Z, and other product-branch test flows) — clones/syncs the branch and applies the modifications it needs for testing. Use when the user asks to prepare, sync, or set up the OpenTelemetry operator repo for product testing.
---

# Prepare OpenTelemetry Operator for Testing

This skill provides instructions for preparing the OpenTelemetry operator repository for product testing.

## When to Use This Skill

Use this skill when:
- Preparing the OpenTelemetry operator repository for product testing
- Setting up additional e2e-otel component tests
- Running local tests with the product branch

## Repository Setup

### Clone and Checkout Product Branch

Ask the user for the release version (e.g. `0.158`) if not provided as an argument. Use `rhosdt-<version>` as the branch name throughout.

The product branch lives in `openshift/open-telemetry-opentelemetry-operator`.

The modifications below reach CI in two ways. The e2e matrix jobs of the product branch (`otel-qe-ocp-ci-tests`) run the tests of the pull request they are triggered on, so open the modifications as a pull request to `rhosdt-<version>`: that pull request is the first choice for running the matrix for the release, and the modifications are what it tests. A test directory that the job lists in `release` must exist in the pull request (see "Test Lists of the OpenShift CI Jobs" below). The Konflux integration tests and the downstream periodics clone `rhosdt-<version>` of `openshift/open-telemetry-opentelemetry-operator`, so they see the modifications once the pull request is merged. Applying them in a local clone does not change what CI runs.

```bash
git clone git@github.com:openshift/open-telemetry-opentelemetry-operator.git
cd open-telemetry-opentelemetry-operator
git checkout rhosdt-<version>
```

If the repo is already present (check for a directory named `open-telemetry-opentelemetry-operator` with `origin` pointing at `openshift/open-telemetry-opentelemetry-operator`), `cd` into that directory and sync with the product branch. This clone is disposable test-fixture scratch space, not a place for uncommitted work — confirm that with the user before running `git clean -fd`, since it deletes untracked files:

```bash
cd open-telemetry-opentelemetry-operator
git restore .
git clean -fd
git checkout rhosdt-<version>
git pull --rebase origin rhosdt-<version>
```

## Product Branch Modifications

The pre-merge jobs of the product branch (`e2e-pre-merge` and the e2e matrix jobs in `release`, see `otel-qe-ocp-ci-tests/references/ci-job-layout.md`) run the chainsaw tests exactly as they are in the pull request and apply none of the modifications below themselves. On the pull request that carries the modifications, they test the modified tests; on any other pull request, the tests of that pull request.

The `rhosdt-<version>` branch must contain the following modifications for product testing:

### Scope of the changes

Limit every edit to `tests/`. The branch also holds the ART build inputs — `Dockerfile.art`, `Dockerfile.ta.art`, `bundle/art.yaml`, `bundle/image-references` and `bundle/opentelemetry-product.package.yaml` — which drive the product build. Test preparation must not change them.

### Additional e2e-otel Component Tests

Copy the end-to-end tests for OpenTelemetry Collector components from [distributed-tracing-qe](https://github.com/openshift/distributed-tracing-qe/tree/main/tests/e2e-otel) to `tests/e2e-otel/`. These tests provide configuration blueprints and testing patterns for various OpenTelemetry receivers, processors, exporters, and extensions.

### Additional UI Test (OpenShift Console)

Copy `tests/e2e-otel-ui` from [distributed-tracing-qe](https://github.com/openshift/distributed-tracing-qe/tree/main/tests/e2e-otel-ui) to `tests/e2e-otel-ui/` unchanged, including `Dockerfile.playwright`. It verifies the OpenTelemetry Collector dashboard in the OpenShift console (Observe > Dashboards) with Playwright and is run by the `e2e-ui-ocp-<x>-<y>` pre-merge job and the UI downstream job. From a distributed-tracing-qe clone: `git archive origin/main tests/e2e-otel-ui | tar -x -C <operator-repo>`.

This repo's `.gitignore` ignores `package-lock.json`, but the test runs `npm ci` and needs `tests/e2e-otel-ui/collector-dashboard/ui/package-lock.json`. Add the same entries as distributed-tracing-qe to `.gitignore`, once per branch:

```
!tests/e2e-otel-ui/collector-dashboard/ui/package-lock.json
tests/e2e-otel-ui/**/artifacts/
tests/e2e-otel-ui/**/playwright-report/
tests/e2e-otel-ui/**/test-results/
```

The existing `sed` for the community collector image below does not touch these files: their collectors use the operator's default image.

### Test Lists of the OpenShift CI Jobs

The pre-merge jobs run the test directories listed in `release` (see "The tests" in `otel-qe-ocp-ci-tests/references/ci-job-layout.md`). When a test directory that those lists name is renamed or removed on the branch, update the lists in `release` as well (`otel-qe-prepare-ci`); a listed directory that does not exist fails the job.

### Remove Hardcoded Community Collector Image

Some `OpenTelemetryCollector` CRs across the `tests/` tree — both the freshly-copied `tests/e2e-otel/` tests and pre-existing ones elsewhere (e.g. `tests/e2e/smoke-collector/`, `tests/e2e-openshift/`) — hardcode `image: ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib:...`. Remove that line wherever it appears under `tests/` so the operator injects its default product image instead. Scope the search and the deletion to `tests/` only — the same string also appears in `docs/` (an unrelated usage example) and in generated `junit_*.xml` reports, neither of which should be touched. Anchor the deletion to the `image:` field itself, not just any line containing the string, in case a future file references it elsewhere (e.g. a comment):

```bash
FILES=$(grep -rl "ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib" tests/ || true)
if [ -n "$FILES" ]; then
  echo "$FILES" | xargs sed -i '/^\s*image:.*ghcr\.io\/open-telemetry\/opentelemetry-collector-releases\/opentelemetry-collector-contrib/d'
fi
```

The CI jobs run the pull request or the branch as it is and do not apply this `sed`, so the result must be committed. `rhosdt-0.158` is already clean; run it again after copying new tests from distributed-tracing-qe, and push the result.

### Remove nodeAffinity from Target Allocator Tests

Remove the `ingress-ready` nodeAffinity requirement from the following target allocator test files to allow tests to run on any node:

- `tests/e2e-targetallocator-cr/01-install.yaml`
- `tests/e2e-targetallocator/targetallocator-features/00-assert.yaml`
- `tests/e2e-targetallocator/targetallocator-features/00-install.yaml`

## Verify Modifications

Confirm each modification above actually landed before running any tests — a silent no-op (an empty `tests/e2e-otel/` from a failed copy, a `sed` pattern that matched nothing, a stale `nodeAffinity` block) surfaces later as confusing test failures instead of an obvious setup error. Run all six checks and report each as pass/fail; if any fails, fix the corresponding step above and re-verify before proceeding:

```bash
echo "=== e2e-otel tests copied ==="
COUNT=$(find tests/e2e-otel -name 'chainsaw-test.yaml' 2>/dev/null | wc -l)
echo "$COUNT chainsaw-test.yaml files found"; [ "$COUNT" -gt 0 ] && echo PASS || echo FAIL

echo "=== no hardcoded community image left under tests/ ==="
if grep -rn "ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib" tests/; then
  echo FAIL
else
  echo PASS
fi

echo "=== no ingress-ready nodeAffinity left in target allocator tests ==="
if grep -n "ingress-ready" \
    tests/e2e-targetallocator-cr/01-install.yaml \
    tests/e2e-targetallocator/targetallocator-features/00-assert.yaml \
    tests/e2e-targetallocator/targetallocator-features/00-install.yaml; then
  echo FAIL
else
  echo PASS
fi

echo "=== UI test copied and its lock file is not ignored ==="
if [ -f tests/e2e-otel-ui/collector-dashboard/chainsaw-test.yaml ] && ! git check-ignore -q tests/e2e-otel-ui/collector-dashboard/ui/package-lock.json; then
  echo PASS
else
  echo FAIL
fi

echo "=== ART build inputs untouched ===
if git diff --name-only | grep -E '^(Dockerfile\.art|Dockerfile\.ta\.art|bundle/)'; then
  echo FAIL
else
  echo PASS
fi

echo "=== files touched by the image-removal sed still parse as valid YAML ==="
FAILED=0
for f in $(git diff --name-only -- tests/ | grep '\.yaml$'); do
  python3 -c "import sys, yaml; list(yaml.safe_load_all(open(sys.argv[1])))" "$f" || { echo "INVALID YAML: $f"; FAILED=1; }
done
[ "$FAILED" -eq 0 ] && echo PASS || echo FAIL
```
