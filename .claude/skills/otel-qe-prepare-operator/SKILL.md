---
name: otel-qe-prepare-operator
description: Use this skill to prepare OpenTelemetry operator for product testing.
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

```bash
git clone git@github.com:os-observability/opentelemetry-operator.git
cd opentelemetry-operator
git checkout rhosdt-3.10
```

If the repo is already present, sync with the product branch:

```bash
git restore .
git clean -fd
git checkout rhosdt-3.10
git pull --rebase origin rhosdt-3.10
```

## Product Branch Modifications

The `rhosdt-3.10` branch must contain the following modifications for product testing:

### Additional e2e-otel Component Tests

Copy the end-to-end tests for OpenTelemetry Collector components from [distributed-tracing-qe](https://github.com/openshift/distributed-tracing-qe/tree/main/tests/e2e-otel) to `tests/e2e-otel/`. These tests provide configuration blueprints and testing patterns for various OpenTelemetry receivers, processors, exporters, and extensions.

After copying, remove the `image:` field specifying `ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib` from the `OpenTelemetryCollector` CR specs. This allows the operator to use its default product image instead of the upstream image.

### Remove nodeAffinity from Target Allocator Tests

Remove the `ingress-ready` nodeAffinity requirement from the following target allocator test files to allow tests to run on any node:

- `tests/e2e-targetallocator-cr/01-install.yaml`
- `tests/e2e-targetallocator/targetallocator-features/00-assert.yaml`
- `tests/e2e-targetallocator/targetallocator-features/00-install.yaml`
