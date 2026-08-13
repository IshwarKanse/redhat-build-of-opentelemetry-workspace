---
name: otel-qe-prepare-konflux-tests
description: Use this skill to prepare Konflux integration tests for a new RHOSDT release. Updates version parameters in OpenTelemetry integration test pipeline configurations.
---

# Prepare Konflux Integration Tests

This skill provides instructions for updating Konflux integration tests for a new RHOSDT release.

## When to Use This Skill

Use this skill when:
- Preparing Konflux CI integration tests for a new RHOSDT release
- Updating operator and operand versions in OpenTelemetry integration test pipeline configurations
- Bumping the test branch to a new product branch

## Repository

Integration test configurations are defined directly in the product repository:

```bash
git clone git@github.com:os-observability/konflux-opentelemetry.git
cd konflux-opentelemetry/.tekton/integration-tests/pipelines
```

## Files to Update

### OpenTelemetry Integration Tests

**Directory:** `konflux-opentelemetry/.tekton/integration-tests/pipelines/`

**Files to update:**
- `opentelemetry-operator-e2e-test-pipeline-4-14.yaml`
- `opentelemetry-operator-e2e-test-pipeline-4-18.yaml`
- `opentelemetry-operator-e2e-test-pipeline-4-21-olmv1.yaml`
- `opentelemetry-operator-upgrade-test-fbc-pipeline-4-14.yaml`
- `opentelemetry-operator-upgrade-test-fbc-pipeline-4-18.yaml`

**Parameters to update in e2e test pipelines:**

| Parameter | Description | Example |
|-----------|-------------|---------|
| `operator_version` | OpenTelemetry operator version | `"0.152.0"` |
| `operator_otel_collector_version` | Collector image version | `"0.152.1"` |
| `operator_targetallocator_version` | Target allocator image version | `"0.152.0"` |
| `otel_collector_version` | Collector version string | `"0.152.1"` |
| `otel_tests_branch` | Product test branch | `"rhosdt-3.10"` |
| `rhosdt_version` | RHOSDT release version | `"3.10"` |

**Additional parameters in upgrade test pipelines:**

| Parameter | Description | Example |
|-----------|-------------|---------|
| `operator_csv_version` | CSV version for upgrade tests | `"opentelemetry-operator.v0.152.0-1"` |
| `collector_version` | Collector version for upgrade tests | `"0.152.1"` |
| `ta_version` | Target allocator version for upgrade tests | `"0.152.0"` |

**Version sources:**
* The operator version is defined in [bundle-patch/patch_csv.yaml](https://github.com/os-observability/konflux-opentelemetry/blob/main/bundle-patch/patch_csv.yaml#L23) in the `spec.version` field.
* The component versions are defined in the [os-observability/konflux-opentelemetry](https://github.com/os-observability/konflux-opentelemetry) in the `versions.txt` in the operator submodule.

## Notes

- The `skip_tests` parameter lists tests to skip - review if any need to be added/removed for the new release
- Ensure the test branches (e.g., `rhosdt-3.10`) exist in the os-observability repos before merging
- Changes are committed directly to the product repos, no manifest generation step is needed
