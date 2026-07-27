# Auto-Instrumentation

The Instrumentation CRD configures automatic injection of OpenTelemetry instrumentation into application pods. The operator injects init containers (or a sidecar for Go) that add language-specific instrumentation libraries without code changes.

The entire auto-instrumentation feature is **TP (Technology Preview)**. The operator only supports the injection mechanism — it does not support the instrumentation libraries or upstream images themselves.

## Behavioral Rules

### Supported Languages

All languages are **TP**:

| Language | Injection Method | Support Level | Notes |
|---|---|---|---|
| Java | Init container | **TP** | By default injects unsupported upstream instrumentation libraries |
| Node.js | Init container | **TP** | By default injects unsupported upstream instrumentation libraries |
| Python | Init container | **TP** | By default injects unsupported upstream instrumentation libraries |
| .NET | Init container | **TP** | By default injects unsupported upstream instrumentation libraries |
| Go | Sidecar (eBPF/uprobes) | **TP** | Requires privileged security context. By default injects unsupported upstream instrumentation libraries |
| Apache HTTPD | Init container | **TP** | |
| Nginx | Init container | **TP** | |

### Injection Mechanism

1. **TP**: Instrumentation is triggered by pod annotations (e.g., `instrumentation.opentelemetry.io/inject-java: "true"`).
2. Each language has its own container image configured in the Instrumentation CR.
3. VolumeClaimTemplates can be configured per language for persistent instrumentation storage.

### Configuration Precedence

4. Environment variable precedence (highest to lowest): original container env → language-specific env → common env → Instrumentation spec fields (exporter, resource, sampler, propagators).

### Propagators

5. Supported propagators: tracecontext, baggage, b3, b3multi, jaeger, xray, ottrace, none.

### Sampler

6. A sampler type and argument can be configured to control trace sampling at the SDK level.

### Exporter

7. The exporter endpoint defines where instrumented applications send telemetry.
8. TLS can be configured via Secrets and ConfigMaps for the exporter connection.

### Resource Attributes

9. Custom resource attributes can be set via the `resource` field.
10. `addK8sUIDAttributes` adds Kubernetes UID-based resource attributes when true.
11. `useLabelsForResourceAttributes` uses pod labels to populate resource attributes when enabled.

### Security

12. `initContainerSecurityContext` applies to all init-container-based languages (excludes Go).
13. Go instrumentation requires its own SecurityContext with elevated privileges for eBPF.

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
4. The operator supports only the injection mechanism. The instrumentation libraries themselves and upstream images are not supported by Red Hat.
