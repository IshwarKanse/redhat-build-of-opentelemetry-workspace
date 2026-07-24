# Auto-Instrumentation

The Instrumentation CRD configures automatic injection of OpenTelemetry instrumentation into application pods. The operator injects init containers (or a sidecar for Go) that add language-specific instrumentation libraries without code changes.

## Behavioral Rules

### Supported Languages

1. Seven languages are supported: Java, Node.js, Python, .NET, Go, Apache HTTPD, and Nginx.
2. Java, Node.js, Python, .NET, Apache HTTPD, and Nginx use init-container injection.
3. Go uses sidecar injection with eBPF/uprobes, requiring a privileged security context.

### Injection Mechanism

4. Instrumentation is triggered by pod annotations (e.g., `instrumentation.opentelemetry.io/inject-java: "true"`).
5. Each language has its own container image configured in the Instrumentation CR.
6. VolumeClaimTemplates can be configured per language for persistent instrumentation storage.

### Configuration Precedence

7. Environment variable precedence (highest to lowest): original container env → language-specific env → common env → Instrumentation spec fields (exporter, resource, sampler, propagators).

### Propagators

8. Supported propagators: tracecontext, baggage, b3, b3multi, jaeger, xray, ottrace, none.

### Sampler

9. A sampler type and argument can be configured to control trace sampling at the SDK level.

### Exporter

10. The exporter endpoint defines where instrumented applications send telemetry.
11. TLS can be configured via Secrets and ConfigMaps for the exporter connection.

### Resource Attributes

12. Custom resource attributes can be set via the `resource` field.
13. `addK8sUIDAttributes` adds Kubernetes UID-based resource attributes when true.
14. `useLabelsForResourceAttributes` uses pod labels to populate resource attributes when enabled.

### Security

15. `initContainerSecurityContext` applies to all init-container-based languages (excludes Go).
16. Go instrumentation requires its own SecurityContext with elevated privileges for eBPF.

## Configuration Surface

| Field | Type | Default | Description |
|---|---|---|---|
| spec.exporter.endpoint | string | — | OTLP endpoint for instrumented apps |
| spec.propagators | list | — | Context propagation formats |
| spec.sampler.type | string | — | SDK-level sampling strategy |
| spec.sampler.argument | string | — | Sampler configuration argument |
| spec.java.image | string | — | Java instrumentation agent image |
| spec.nodejs.image | string | — | Node.js instrumentation image |
| spec.python.image | string | — | Python instrumentation image |
| spec.dotnet.image | string | — | .NET instrumentation image |
| spec.go.image | string | — | Go eBPF instrumentation image |
| spec.apacheHttpd.image | string | — | Apache HTTPD module image |
| spec.nginx.image | string | — | Nginx module image |

## Constraints

1. Go auto-instrumentation is the only language that runs as a sidecar rather than an init container.
2. Apache HTTPD supports version 2.4 and 2.2 with a configurable `configPath`.
3. Nginx requires a `configFile` path to the Nginx configuration.
