# Target Allocator

The Target Allocator distributes Prometheus scrape targets across OpenTelemetry Collector instances. It can be embedded in an OpenTelemetryCollector CR or managed as a standalone CRD.

## Behavioral Rules

### Allocation Strategies

1. **consistent-hashing** (default): distributes targets using consistent hashing for stable assignment across collector instances.
2. **least-weighted**: assigns targets to the collector instance with the fewest current targets.
3. **per-node**: assigns targets to the collector instance running on the same node as the target.

### Filter Strategy

4. **relabel-config** (default): applies Prometheus relabel_config rules to filter targets before allocation.
5. An empty filter strategy disables filtering.

### Prometheus CRD Integration

6. When `prometheusCR.enabled` is true, the target allocator discovers scrape targets from Prometheus Operator CRDs: ServiceMonitor, PodMonitor, Probe, and ScrapeConfig.
7. Namespace selectors and label selectors can be configured independently for each Prometheus CRD type.
8. `scrapeInterval` defaults to 30s; `evaluationInterval` defaults to 30s.

### Collector Coordination

9. `collectorNotReadyGracePeriod` (default: 30s) defines how long to wait before redistributing targets from an unready collector.
10. `collectorTargetReloadInterval` (default: 30s) defines how often collectors poll for target updates.

### Security

11. mTLS can be configured between the target allocator and collector instances.
12. `allowInsecureAuthSecrets` controls whether auth secrets can be transmitted without TLS.

### Standalone CRD

13. The standalone TargetAllocator CRD (v1alpha1) allows managing target allocation independently of an OpenTelemetryCollector CR.
14. It supports `globalConfig` and `scrapeConfigs` fields for direct Prometheus configuration.

## Configuration Surface

| Field | Type | Default | Description |
|---|---|---|---|
| spec.allocationStrategy | Enum | `consistent-hashing` | How targets are distributed |
| spec.filterStrategy | Enum | `relabel-config` | How targets are filtered |
| spec.prometheusCR.enabled | bool | false | Discover targets from Prometheus CRDs |
| spec.prometheusCR.scrapeInterval | duration | `30s` | Default scrape interval |
| spec.collectorNotReadyGracePeriod | duration | `30s` | Grace period for unready collectors |
| spec.collectorTargetReloadInterval | duration | `30s` | Target reload poll interval |
| spec.mtls | Object | — | mTLS configuration |

## Constraints

1. The per-node allocation strategy requires collectors to run in DaemonSet mode to be meaningful.
2. PrometheusCR integration requires the Prometheus Operator CRDs to be installed on the cluster.
