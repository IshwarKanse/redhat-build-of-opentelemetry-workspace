# Trace Non-Repudiation Signing

**Jira:** [TRACING-6499](https://redhat.atlassian.net/browse/TRACING-6499) (Epic), parent: [OBSDA-1454](https://redhat.atlassian.net/browse/OBSDA-1454) (Feature)
**Status:** Design
**Support Level:** TP (Technology Preview)

## Problem

The EU AI Act requires organizations to demonstrate that AI agent actions are authentic and untampered. When an AI agent performs an action (modifies infrastructure, sends a request, makes a decision), the resulting trace must provide cryptographic proof that:

1. The trace was emitted by the claimed agent (authentication)
2. The trace content has not been altered in transit (integrity)
3. The agent cannot deny having performed the action (non-repudiation)

Standard OpenTelemetry pipelines provide no span-level integrity or signing. Transport-level authentication (mTLS, OIDC) authenticates the collector connection, not individual spans. There is no upstream OpenTelemetry work on per-span signing.

## Scope

**In scope:**
- Collector-side signature verification processor (TP, supported)
- Collector-side key management extension (TP, supported)
- Canonical serialization format for deterministic signing
- Reference SDK signing processors for Go and Java (unsupported examples)

**Out of scope:**
- Key provisioning and lifecycle management (handled by external PKI/SPIFFE/Vault)
- TPM/HSM integration at the SDK level (users bring their own `crypto.Signer`)
- Upstream OTEP or contribution (deferred until design is validated downstream)
- Tracestate propagation (signatures travel in span attributes via OTLP, not HTTP context headers)

## Architecture

```
Agent App (SDK)                    Gateway Collector
┌─────────────────┐               ┌──────────────────────────────────┐
│ App Code         │               │ OTLP Receiver                    │
│   ↓              │               │   ↓                              │
│ SigningSpan-     │   OTLP/gRPC   │ signatureverification processor  │
│ Processor        │ ─────────────→│   ↓ (uses signingkeys extension) │
│   ↓              │               │ [enrichment processors]          │
│ OTLP Exporter    │               │   ↓                              │
└─────────────────┘               │ Storage Exporter (e.g. Tempo)    │
                                   └──────────────────────────────────┘
```

The signing happens at the SDK layer before export. The verification processor in the gateway collector runs before any enrichment processors (k8s attributes, resource detection, transform) so the signature covers the span exactly as the SDK produced it.

## Signature Attributes

The signing processor sets these span attributes:

| Attribute | Type | Description |
|---|---|---|
| `rht.sig.value` | string | Base64-encoded signature |
| `rht.sig.alg` | string | Algorithm identifier (e.g., `ECDSA-P256-SHA256`) |
| `rht.sig.kid` | string | Key ID — free-form string used to look up the public key |
| `rht.sig.ts` | int64 | Signing timestamp (Unix nanos) |

These attributes are excluded from the canonical payload (you cannot sign your own signature).

## Canonical Serialization

The signed payload must be deterministic — identical span content must produce identical bytes on both signer and verifier.

**Format:** OTLP protobuf wire format with sorted map keys, versioned as `v1`.

**Field order:** trace_id, span_id, parent_span_id, name, kind, start_time, end_time, status (code + message), attributes (sorted by key), events (in order, each with sorted attributes), links (in order, each with sorted attributes).

**Exclusions:** The `rht.sig.*` attributes are stripped before serialization.

**Rationale:** Both SDK and collector already have OTLP proto libraries. Protobuf with sorted keys is compact and deterministic. No new serialization dependency needed.

## Cryptographic Approach

**Pluggable algorithm interface.** The signing and verification logic accepts any algorithm that implements the standard signing interface (`crypto.Signer` in Go, `java.security.Signature` in Java).

**Default:** ECDSA P-256 with SHA-256 (`ECDSA-P256-SHA256`). FIPS-compliant via Go 1.24+ native FIPS module.

**Supported algorithms** (verification processor accepts these when configured):

| Algorithm ID | Type | FIPS Compliant | Non-Repudiation |
|---|---|---|---|
| `ECDSA-P256-SHA256` | Asymmetric | Yes | Yes |
| `ECDSA-P384-SHA384` | Asymmetric | Yes | Yes |
| `Ed25519` | Asymmetric | Yes | Yes |

HMAC-based algorithms are intentionally excluded — shared secrets cannot provide non-repudiation, which is the core requirement.

## Verification Processor

**Component type:** Processor (`signatureverification`)

**Configuration:**

```yaml
processors:
  signatureverification:
    policy: permissive          # enforce | permissive | audit
    allowed_algorithms:
      - ECDSA-P256-SHA256
    keys_extension: signingkeys/default
    unsigned_policy: allow      # allow | reject
    result_attribute: rht.sig.verified   # true | false
    reason_attribute: rht.sig.reason     # valid | invalid_signature | unknown_key | unsigned | unsupported_algorithm
```

**Policy behavior:**

| Policy | Valid signature | Invalid signature | Unknown key | Unsigned span (policy: reject) | Unsigned span (policy: allow) |
|---|---|---|---|---|---|
| `enforce` | Forward | Drop | Drop | Drop | Forward |
| `permissive` | Forward, `verified=true` | Forward, `verified=false` | Forward, `verified=false` | Forward, `verified=false` | Forward, `verified=true` |
| `audit` | Forward, log info | Forward, log warning | Forward, log warning | Forward, log warning | Forward, log info |

**Pipeline placement:** Must be before any enrichment processors:

```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [signatureverification, k8sattributes, batch]
      exporters: [otlp/tempo]
```

## Key Management Extension

**Component type:** Extension (`signingkeys`)

**Configuration:**

```yaml
extensions:
  signingkeys/default:
    backend: kubernetes         # file | kubernetes | spiffe
    refresh_interval: 5m

    file:
      directory: /etc/otel/signing-keys/
      # Files named <kid>.pem

    kubernetes:
      namespace: observability
      label_selector: rht.sig/signing-key=true
      # Secret data: "kid" → key ID, "public-key" → PEM

    spiffe:
      trust_bundle_path: /run/spiffe/bundle/bundle.pem
      workload_api_socket: unix:///run/spiffe/sockets/agent.sock
```

**Key resolution flow:**
1. Verification processor receives span with `rht.sig.kid`
2. Calls `GetPublicKey(kid)` on the extension
3. Extension checks in-memory cache
4. On cache miss, loads from configured backend
5. Returns public key or error (unknown key)

**Rotation:** Keys are refreshed at `refresh_interval`. Expired/removed keys are evicted. New keys are picked up automatically. No collector restart required.

**Backend details:**

| Backend | Key ID convention | Source |
|---|---|---|
| `file` | Filename without `.pem` extension | PEM files in a directory |
| `kubernetes` | Value of `kid` data key in the Secret | K8s Secrets matching label selector |
| `spiffe` | SPIFFE ID (e.g., `spiffe://cluster.local/ns/default/sa/agent`) | SPIFFE trust bundle or Workload API |

The SPIFFE backend integrates with Red Hat Zero Trust Workload Identity Manager, which can automatically provision per-workload identities with signing keys.

## Reference SDK Signing Processors

Unsupported reference implementations for Go and Java, provided as examples.

**Go:**
- `SigningSpanProcessor` implementing `SpanProcessor` interface
- Wraps any `crypto.Signer` (file-based PEM key loader included)
- Canonical serialization library shared with the collector verification processor

**Java:**
- `SigningSpanProcessor` implementing `SpanProcessor` interface
- Uses `java.security.Signature` and `KeyStore` abstraction
- Canonical serialization producing identical bytes to the Go implementation

**Included:** Signing processor, canonical serialization, file-based key loader, example configuration, integration tests (sign a span in SDK, verify in collector).

**Not included:** TPM/HSM integration, key provisioning, SPIFFE SVID integration at SDK level.

## Repo Placement

| Component | Repo |
|---|---|
| `signatureverification` processor | `redhat-opentelemetry-collector` |
| `signingkeys` extension | `redhat-opentelemetry-collector` |
| Canonical serialization library | `redhat-opentelemetry-collector` |
| Go reference signing processor | `redhat-opentelemetry-examples` or similar |
| Java reference signing processor | Same examples repo |
| Documentation | `openshift-docs` (`standalone-otel-docs-main`) |

## Constraints

1. All signing/verification crypto must be FIPS-compliant (built with `GOEXPERIMENT=strictfipsruntime`).
2. The canonical serialization format is versioned (`v1`). Future changes must not break verification of existing signatures.
3. The verification processor must not buffer spans — it verifies inline and forwards/drops immediately to avoid memory pressure.
4. Performance target: < 0.1ms per span for ECDSA P-256 verification.
5. The `rht.sig.*` attribute namespace is Red Hat-specific. If upstreamed, the prefix would change (e.g., `otel.sig.*`).
6. Key ID is a free-form string — its interpretation is a convention between the signer and the key management backend.

## Open Questions

1. **Canonical serialization determinism across languages.** Go and Java protobuf libraries may produce different byte orderings for the same span. The canonical format must be specified precisely enough that any conforming implementation produces identical bytes. Needs cross-language test vectors to validate.

## Upstream Strategy

Build and validate downstream first. Once the signing format and verification behavior are proven with real customers, propose an OTEP and contribute the components to `opentelemetry-collector-contrib`.
