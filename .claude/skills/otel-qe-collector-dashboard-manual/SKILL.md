---
name: otel-qe-collector-dashboard-manual
description: Manual test for OpenTelemetry collector dashboards on OpenShift. Use when the user asks to manually verify or test the collector dashboards.
---

# OpenTelemetry Collector Dashboard Manual Test

This skill provides instructions for manually testing the OpenTelemetry collector dashboards on OpenShift.

## When to Use This Skill

Use this skill when:
- Verifying that OpenTelemetry collector dashboards are working as expected
- Testing collector metrics visualization in the OpenShift console
- Validating dashboard functionality after operator deployment

## Prerequisites

Ensure OpenShift user workload monitoring is enabled:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: cluster-monitoring-config
  namespace: openshift-monitoring
data:
  config.yaml: |
    enableUserWorkload: true
```

## Test Steps

1. Deploy the OpenTelemetry Collector with metrics enabled:

   ```bash
   kubectl apply -f otel-dashboard-01-collector.yaml
   ```

2. Deploy the telemetry generator to send test metrics, logs and traces:

   ```bash
   kubectl apply -f otel-dashboard-02-telemetrygen.yaml
   ```

## Verification

Go to the `opentelemetry-collector` dashboard in the OpenShift console:

- Example URL: `https://console-openshift-console.apps-crc.testing/monitoring/dashboards/opentelemetry-collector`

Verify that the dashboard shows all charts with metrics data.

## Cleanup

```bash
kubectl delete -f otel-dashboard-02-telemetrygen.yaml
kubectl delete -f otel-dashboard-01-collector.yaml
```
