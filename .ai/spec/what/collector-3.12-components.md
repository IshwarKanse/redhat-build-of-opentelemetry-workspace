# Collector Components for 3.12

Three collector components are new in RHOSDT 3.12 under OBSDA-1475: the Log Deduplication processor, the Syslog exporter and the Webhook Event receiver. Each component enters as **TP (Technology Preview)**. One evaluated component (Logs Transform Processor) was excluded — rationale is documented inline.

**Target upstream version:** 0.161.0 (bump from 0.158.0). All configuration facts below were verified against the component sources. Where a fact depends on the upstream version it is called out. `unixgram` for the syslog exporter merged upstream after v0.161.0 and is therefore not part of 3.12 at 0.161.0.

**Handling of known upstream bugs:** the docs carry a warning for each open bug that affects a new component, and fixes are prepared for upstream contribution. A fix reaches the product only when the pinned upstream version contains it (next candidate after 0.161.0 is 0.162.0); until then the docs warning ships.

## Log Deduplication Processor

**Support Level:** TP
**Component name:** `log_dedup` (deprecated alias `logdedup`)
**Upstream Stability:** Alpha (logs only)
**Ticket:** TRACING-6697
**Feature Request:** OBSDA-1456

### Use Cases on OCP

1. **Kubernetes Events Deduplication**: Kubernetes API exposes all changes to a CR, generating high-volume duplicate logs as objects transition through states (e.g., `ADDED` → `MODIFIED` → `MODIFIED` → `MODIFIED`). The log dedup processor aggregates these into a single record with a `log_count` attribute, reducing noise for downstream consumers like SIEM systems or Ansible Event Driven Automation (EDA). Real customer case: 04523104. Fields that change on every event (for example `body.object.metadata.resourceVersion`, and `body.type` when `ADDED` and `MODIFIED` must be merged) are part of the deduplication key unless removed with `exclude_fields` (or the key is narrowed with `include_fields`); without that, such events do not merge.
2. **Multi-Tenant Log Aggregation**: The `metadata_keys` configuration partitions aggregation by client request metadata (for example an `x-scope-orgid` tenant header), so logs arriving with different tenant IDs are aggregated into separate, independent buckets, preventing cross-tenant data contamination. The deduplication key already includes the resource and scope attributes, so logs from different resources are never merged either way.
3. **Log Volume and Storage Cost Reduction**: Aggregate repetitive logs (health checks, heartbeats, periodic status reports) before sending to storage backends.

### Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `interval` | duration | `10s` | Time window for aggregation. Logs within this interval are grouped and emitted as a single record. Must be greater than 0. |
| `log_count_attribute` | string | `log_count` | Attribute name for the deduplication count (integer) on emitted logs. |
| `timezone` | string | `UTC` | Timezone used to format the `first_observed_timestamp` and `last_observed_timestamp` attributes that the processor adds to each emitted log. It does not change the record timestamps. |
| `conditions` | list(string) | — | OTTL conditions to filter which logs are deduplicated. Logs not matching conditions pass through immediately and unchanged. Use path-prefixed paths such as `log.attributes["k8s.resource.name"]`; the bare `attributes[...]` form is deprecated. |
| `exclude_fields` | list(string) | — | Fields excluded from the deduplication key (e.g., timestamps that differ between otherwise-identical logs); they are also removed from the emitted log. Each path starts with `body` or `attributes` and is dot-delimited (`\.` escapes a literal dot). The whole `body` cannot be excluded. |
| `include_fields` | list(string) | — | If set, only these fields are used as the deduplication key. Same path syntax as `exclude_fields`. Mutually exclusive with `exclude_fields`. |
| `metadata_keys` | list(string) | — | **Client metadata** keys (HTTP headers or gRPC metadata such as `x-scope-orgid`) used to partition deduplication buckets. Each unique combination of values gets an independent aggregation scope. Keys are matched case-insensitively. The receiver must keep the metadata (for the OTLP receiver, `include_metadata: true` on its HTTP or gRPC server settings), otherwise all logs fall into one empty partition. Resource attributes are **not** metadata keys. |
| `metadata_cardinality_limit` | int | `0` (unlimited) | Maximum number of distinct `metadata_keys` value combinations. The processor logs a warning at startup when `metadata_keys` is set without a limit. |

Example configuration:

```yaml
receivers:
  otlp:
    protocols:
      http:
        include_metadata: true

processors:
  log_dedup:
    interval: 30s
    log_count_attribute: log_count
    metadata_keys:
      - x-scope-orgid
    metadata_cardinality_limit: 100
    conditions:
      - 'log.attributes["k8s.resource.name"] == "events"'
```

### Operator Integration

No operator changes required. The log dedup processor is a pure in-memory processor with no Kubernetes RBAC requirements and no ports to expose.

### Upstream Quality Assessment

- **Open issues**: 1 enhancement request (#43647 — preserve first occurrence timestamp; the attempt in #47513 was closed unmerged). No open bugs.
- **Performance concern**: #50851 flags an O(n^2) key lookup in shared `pkg/pdatautil` hashing (`writeMapHash`) used for deduplication keys. The cost is quadratic in the number of attributes of a single map (attribute width), not in log volume. No open fix PR exists (#50852 was closed unmerged). Not blocking for TP; monitor for records with very wide attribute maps.
- **Maintenance**: Active — steady stream of feature PRs (OTTL conditions, multi-tenant `metadata_keys`, `include_fields`). Active codeowner (MikeGoldsmith).

**Upstream tickets to consider fixing:**

| Ticket | Summary | Priority |
|---|---|---|
| #50851 | `pkg/pdatautil` O(n^2) key lookup in `writeMapHash` | Medium — affects dedup performance for wide attribute maps |
| #43647 | Preserve first occurrence timestamp | Low — enhancement, not correctness |

---

## Syslog Exporter

**Support Level:** TP
**Component name:** `syslog`
**Upstream Stability:** Alpha (logs only)
**Ticket:** TRACING-6788

### Use Cases on OCP

1. **SIEM and Security Platform Integration**: Export OTel-collected logs to SIEM systems (Splunk, QRadar, ArcSight) that consume syslog. Common in regulated environments (government, financial services).
2. **Compliance and Audit Log Archiving**: Forward audit logs from OpenShift to syslog-based archival systems required by compliance frameworks (PCI-DSS, HIPAA, SOX).
3. **Open Standard Log Export**: syslog (RFC 5424/3164) is a widely supported standard for log forwarding across heterogeneous infrastructure.

### Documentation Note

The product documentation for the syslog exporter should reference and align with the **OCP Logging syslog documentation**. OCP Logging already documents syslog forwarding — the OTEL docs should provide equivalent guidance covering the same configuration patterns (message fields, RFC modes, TLS transport), ensuring users migrating from OCP Logging to OpenTelemetry have a consistent experience. Include a cross-reference to the OCP Logging docs for users evaluating both approaches. OCP Logging documents syslog forwarding tested against rsyslog (RFC 3164 and RFC 5424) and Splunk through HEC (not syslog); it names no other SIEM products, so the OTEL docs must not claim vendor-specific parity beyond "syslog-capable SIEMs".

### Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `endpoint` | string | *required* | Syslog server **host name or IP address, without a port** (or the socket path when `network` is `unix`). |
| `port` | int | `514` | Server port, 1–65535 (not used for `unix`). The address is built as `endpoint:port`, so a port inside `endpoint` produces an invalid address. |
| `network` | string | `tcp` | Transport: `tcp`, `udp` or `unix`. |
| `protocol` | string | `rfc5424` | Syslog message format: `rfc5424` or `rfc3164`. |
| `enable_octet_counting` | bool | `false` | Use octet-counting framing (RFC 6587). Only valid with `rfc5424`. Because each record carries its length, an embedded newline cannot split it into extra frames. |
| `tls` | object | — | TLS configuration (CA, cert and key for mTLS, `insecure`). Applies to `tcp` only. **TLS is on by default for `tcp`**: sending plaintext requires `tls: {insecure: true}`. |
| `retry_on_failure` | object | enabled | Standard exporter retry settings (initial interval 5s, max interval 30s, max elapsed time 5m). |
| `sending_queue` | object | disabled | Standard exporter queue. Off unless the key is present; when enabled the defaults are 10 consumers and a queue size of 1000 requests. |
| `timeout` | duration | `5s` | Connection timeout. |

Log attributes used for syslog formatting. **The log body is not used**; copy it into `message` explicitly.

| Attribute | Maps to | Default |
|---|---|---|
| `appname` | APP-NAME field | `-` |
| `hostname` | HOSTNAME field | `-` |
| `priority` | PRI field — a raw integer (`facility * 8 + severity`); it is **not** derived from the log severity | `165` |
| `version` | VERSION (RFC 5424 only) | `1` |
| `proc_id` | PROCID (RFC 5424 only) | `-` |
| `msg_id` | MSGID (RFC 5424 only) | `-` |
| `structured_data` | STRUCTURED-DATA (RFC 5424 only). Must be a map of maps (`{sd_id: {param: "value"}}`) with string parameters; other shapes are silently dropped | `-` |
| `message` | MSG field | empty (the body is not used) |

Example configuration:

```yaml
processors:
  transform:
    log_statements:
      - context: log
        statements:
          - set(attributes["message"], body.string)
          - set(attributes["appname"], "otel-collector")

exporters:
  syslog:
    endpoint: siem.example.com
    port: 514
    network: tcp
    protocol: rfc5424
    tls:
      ca_file: /etc/otel/ca.crt
```

### Operator Integration

No operator changes required. The syslog exporter makes outbound connections only — no Kubernetes RBAC or Service ports needed.

### Upstream Quality Assessment

- **Open bugs**:
  - **#49234 — Frame injection via unescaped newlines**: Log attributes containing newlines can inject additional syslog frames on newline-delimited transports (`tcp` without octet counting, and RFC 3164), enabling SIEM record forgery. Security-adjacent, marked Stale; PR #49239 by another contributor is open (Stale). **Critical for compliance use cases** — the primary driver for this exporter.
- **Not applicable to the exporter**: #48041 (`sending_queue` with `block_on_overflow: true` gives no backpressure, P1) is a bug in the syslog **receiver**, not the exporter.
- **Beta promotion**: #49729 — checklist entirely unchecked (config stability, defaults, production testing, docs all pending).
- **Maintenance**: Active — 3 codeowners; datagram-socket (`unixgram`) support merged 2026-09-15 (#50867, after v0.161.0) and octet counting has been in the exporter since early 2024. The exporter's lifecycle tests are still disabled upstream (`.mdatagen.yaml` marks them as a TODO), which is a quality signal for a TP component.

**Upstream tickets to consider fixing:**

| Ticket | Summary | Priority |
|---|---|---|
| #49234 | Frame injection via unescaped newline in log attributes — SIEM record forgery | **High** — security-adjacent, directly undermines the compliance use case. PR #49239 exists |
| #49729 | Promote syslog exporter to beta (checklist) | Low — aspirational, tracks upstream progress |

---

## Webhook Event Receiver (New in 3.12 — TP)

**Support Level:** TP (not ready for GA)
**Component name:** `webhook_event` (deprecated alias `webhookevent`; the rename landed upstream in v0.154.0)
**Upstream Stability:** Beta (logs only)
**Tickets:** TRACING-6641 (add to distro, In Progress — distro PR os-observability/redhat-opentelemetry-collector#153 is folded into the 3.12 component PR), TRACING-6642 (docs, In Progress)

The webhook event receiver is **new in 3.12**. It is not in any 3.11 build: `manifest.yaml` on `main` and on `rhosdt-3.11` has no entry, and the 3.11 release notes and docs do not mention it. This section covers the component and the operator improvement.

### Use Cases on OCP

1. **Audit Log Collection via Webhooks**: Collect audit logs from applications that offer HTTP webhooks but lack OTLP endpoints (CI/CD systems, SaaS platforms).
2. **CI/CD Pipeline Events**: Ingest events from CI/CD pipelines (Tekton, Jenkins, GitHub Actions) directly into the collector for observability correlation.
3. **Batch Log Splitting**: Split logs sent in batches or NDJSON format into individual OTEL log records.

### Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `endpoint` | string | *required — no default* | HTTP listen address, for example `0.0.0.0:8088`. |
| `path` | string | `/events` | URL path for receiving webhook events. **Must start with `/`** — see #50893. |
| `health_path` | string | `/health_check` | URL path for health checks. **Must start with `/`** — see #50893. |
| `read_timeout` | duration | `500ms` | Read timeout for HTTP requests (maximum 10s). |
| `write_timeout` | duration | `500ms` | Write timeout for HTTP responses (maximum 10s). |
| `required_header.key` / `required_header.value` | string | — | Every request must carry this header with exactly this value (plain equality, **not** a signature check). Both fields are required together. |
| `hmac_signature.secret` / `.header` / `.prefix` | string | — | HMAC hex-digest signature verification, compatible with GitHub (`X-Hub-Signature-256: sha256=<hex>`). All three are required once any is set. |
| `split_logs_at_newline` | bool | `false` | Split a body into one log record per line (NDJSON). Mutually exclusive with `split_logs_at_json_boundary`. |
| `split_logs_at_json_boundary` | bool | `false` | Split a body into one log record per top-level JSON object. |
| `header_attribute_regex` | string | — | Request headers whose names match this regular expression are added as log attributes. |
| `max_request_body_size` | int | server default | Maximum request body size (standard HTTP server setting). |

The receiver also accepts the standard HTTP server settings (for example `tls`). `convert_headers_to_attributes` is declared in the configuration but has no effect — do not document or use it.

Example configuration:

```yaml
receivers:
  webhook_event:
    endpoint: 0.0.0.0:8088
    path: /events
    health_path: /health_check
    hmac_signature:
      secret: "${env:WEBHOOK_SECRET}"
      header: X-Hub-Signature-256
      prefix: "sha256="
```

### Operator Improvements (3.12)

**[PLANNED: needs TRACING ticket]** Register a receiver parser for `webhook_event` (deprecated alias `webhookevent`) in the operator's component registry (`internal/components/receivers/helpers.go`), as a single-port parser with a default port of 8088.

Today the operator handles the receiver through its generic fallback parser, which already derives a Service port from the configured `endpoint` (which the receiver requires). Registering the parser adds:

- A default endpoint (`0.0.0.0:8088`) injected when `endpoint` is omitted. This default is chosen by the operator, not by the receiver, and `splunk_hec` already uses 8088 — the upstream issue decides whether to keep it or to register the parser without a default.
- The OpenShift TLS profile defaults applied to a `tls:` block.
- Resolution of the deprecated alias `webhookevent`.

The change is about 6 lines plus tests. It is made **upstream first** (`open-telemetry/opentelemetry-operator`); the product picks it up through the `rhosdt-x.y` release sync, with no downstream patch.

### GA Blockers

The webhook event receiver is **not ready for GA** in 3.12 due to:

1. **#50893 — Panic on path misconfiguration**: A `path` or `health_path` without a leading `/` (or empty) causes a panic in `httprouter` after the listener is bound, holding the port and blocking restart. Production deployments cannot tolerate unrecoverable crashes from a config typo. Needs an upstream fix (validate at config load time); PR #50894 is open.

**Upstream tickets to consider fixing:**

| Ticket | Summary | Priority |
|---|---|---|
| #50893 | Path misconfiguration causes panic and port-binding loop | **High** — blocks GA, config validation fix. PR #50894 exists |
| #50730 | Add `SplitLogsAsArray` mode for JSON arrays | Low — enhancement |

---

## Excluded: Logs Transform Processor

**Decision:** Do not include in RHOSDT 3.12.
**Ticket:** TRACING-6698 (cancelled)

### Rationale

1. **Upstream stability is `development`** — the lowest tier, below alpha. The component is explicitly excluded from all upstream distributions (`distributions: []` in metadata.yaml).
2. **Explicitly slated for deprecation** — upstream issue #19775 proposes deprecation. The README states: "its functionality will be reimplemented in the transform processor in the future."
3. **Quality concerns**: Open bug #31140 (wrong context in long-running tasks, open since Apr 2024). Three merged PRs skip flaky tests (#9773, #13219, #17448). Only 1 active codeowner.
4. **Alternative exists**: The Transform Processor (already GA in RHOSDT) covers log transformation via OTTL. The OTTL roadmap (#18643) is actively porting Stanza operators into the transform processor.

### Recommendation

Document OTTL-based log transformation patterns in the Transform Processor docs section. For users needing advanced parsing of non-filelog logs (the primary logstransform use case), provide OTTL examples for:
- Regex parsing of unstructured log bodies
- Timestamp extraction and normalization
- Severity mapping from raw text

## Constraints

1. All new components enter as TP. Promotion to GA requires: upstream stability at Beta or higher, no open P1/security bugs, production validation on OCP, and complete documentation.
2. The logs transform processor is excluded from the distro despite having a TRACING ticket. The ticket should be closed as "Won't Do" with a reference to this spec.
3. The syslog exporter's frame injection bug (#49234) must be tracked and ideally fixed before any consideration of GA promotion. Until the shipped upstream version contains a fix, users must be warned in docs that log attributes containing newlines may forge additional syslog records on newline-delimited transports, with `enable_octet_counting: true` (RFC 5424) as the mitigation.
4. The webhook event receiver's path validation bug (#50893) must be fixed upstream before any consideration of GA promotion. Until the shipped upstream version contains a fix, docs must state that `path` and `health_path` must start with `/`.
5. The syslog exporter's TLS-on-by-default behavior and the requirement to copy the log body into the `message` attribute must be stated in the docs, because both differ from what users expect coming from OCP Logging.
6. The `webhook_event` receiver is added to the distro in the same change as the log dedup processor and the syslog exporter (3.12), superseding the standalone distro PR #153.
