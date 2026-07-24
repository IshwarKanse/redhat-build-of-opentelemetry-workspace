# Operator

The OpenTelemetry Operator is a Kubernetes operator that manages the lifecycle of OpenTelemetry Collector instances, auto-instrumentation injection, target allocation, and OpAMP bridge on OpenShift. It defines five CRDs.

## Behavioral Rules

### CRDs

1. **OpenTelemetryCollector** (v1beta1, storage version) manages collector instances. Short names: `otelcol`, `otelcols`.
2. **Instrumentation** (v1alpha1) configures auto-instrumentation injection. Short names: `otelinst`, `otelinsts`. See `what/auto-instrumentation.md`.
3. **TargetAllocator** (v1alpha1, standalone) manages Prometheus target distribution. See `what/target-allocator.md`.
4. **OpAMPBridge** (v1alpha1) provides remote configuration management via Open Agent Management Protocol.
5. **ClusterObservability** (v1alpha1, cluster-scoped) provides simplified cluster-wide observability with a single OTLP HTTP endpoint.

### Collector Modes

6. Deployment mode (default): standard Kubernetes Deployment with configurable replicas.
7. DaemonSet mode: one collector pod per node.
8. StatefulSet mode: supports persistent storage via VolumeClaimTemplates.
9. Sidecar mode: injected into application pods. Sidecar mode prohibits tolerations, priorityClassName, affinity, and additionalContainers.

### Management State

10. When `managementState` is `managed` (default), the operator reconciles the CR and manages all child resources.
11. When `managementState` is `unmanaged`, the operator stops reconciling — the user controls child resources directly.

### Autoscaling

12. HPA-based autoscaling is supported with CPU/memory utilization targets and custom metrics.
13. MinReplicas, MaxReplicas, and scaling behavior are configurable.

### Networking

14. Ingress, HTTPRoute, and NetworkPolicy resources can be configured per collector instance.

### API Versioning

15. v1beta1 is the stable storage version for OpenTelemetryCollector.
16. v1alpha1 OpenTelemetryCollector is deprecated; its config field is a raw string, not structured.
17. All other CRDs are v1alpha1.

### OpAMP Bridge

18. OpAMPBridge is limited to a single replica.
19. It connects to an OpAMP server endpoint and manages collector configurations based on declared capabilities.

### ClusterObservability

20. ClusterObservability is cluster-scoped (not namespaced).
21. It provides a single unified OTLP HTTP endpoint with optional per-signal endpoint overrides (traces, metrics, logs, profiles).

## Configuration Surface

| Field | Type | Default | Description |
|---|---|---|---|
| spec.mode | Enum | `deployment` | Collector scheduling mode |
| spec.replicas | int | 1 | Number of collector replicas |
| spec.managementState | Enum | `managed` | Whether operator reconciles this CR |
| spec.config | Structured | — | Collector pipeline configuration |
| spec.targetAllocator.enabled | bool | false | Enable embedded target allocator |
| spec.autoscaler | Object | — | HPA configuration |
| spec.ingress | Object | — | Ingress configuration |
| spec.configVersions | int | 3 | Number of config versions to retain |

## Constraints

1. The operator depends on `openshift/api` for OpenShift-specific integrations.
2. CRD types live in `apis/v1alpha1/` and `apis/v1beta1/` in the `opentelemetry-operator` repo.
3. E2E tests use the Chainsaw framework in the `tests/` directory.
