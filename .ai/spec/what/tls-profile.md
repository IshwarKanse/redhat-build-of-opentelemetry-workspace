# Cluster TLS Security Profile Adherence

OpenShift exposes a cluster-wide TLS security policy on the `APIServer` CR (`spec.tlsSecurityProfile`). The operator reads that profile and propagates it to every TLS server it controls — its own webhook and metrics endpoints, the collector operands it generates, and the Target Allocator.

Profile adherence is **GA** (introduced in 3.10.0).

The profile carries three fields. The operator currently propagates two of them end to end; `groups` (elliptic curves / supported groups) is fetched but dropped before it reaches the operands. Closing that gap is tracked by TRACING-6785.

| `TLSProfileSpec` field | Meaning | Propagated today |
|---|---|---|
| `minTLSVersion` | Lowest TLS version to negotiate | Yes |
| `ciphers` | Permitted cipher suites (TLS 1.2 and below) | Yes |
| `groups` | Supported groups / elliptic curves, in preference order | Operator's own servers only |

## Behavioral Rules

### Profile Acquisition

1. **GA**: When `--tls-cluster-profile` is set, the operator fetches `spec.tlsSecurityProfile` from the `APIServer` CR at startup. This is OpenShift-only.
2. **GA**: Failure to fetch the profile is fatal — the operator exits rather than starting with an unknown TLS policy.
3. **GA**: When `--tls-cluster-profile` is not set, the operator uses its own `--tls-min-version` and `--tls-cipher-suites` settings, plus `--tls-curve-preferences` once **[PLANNED: TRACING-6785]** lands.
4. **GA**: When both are present, the cluster profile wins. Manual settings are applied first and the cluster profile is applied over them.
5. **GA**: The operator watches the `APIServer` CR. A change to any profile field — including `groups` — triggers a graceful restart so the new policy takes effect.

### Operator Servers

6. **GA**: The webhook server honours the profile's minimum version, cipher suites, and groups.
7. **GA**: The metrics server, when secure serving is enabled, honours the same three fields.

### Collector Operands

8. **GA**: When `--tls-configure-operands` is set, the operator injects the profile into generated collector configuration as `min_version` and `cipher_suites` under each component's `tls` block.
9. **[PLANNED: TRACING-6785]** The operator also injects `curve_preferences`, derived from the profile's `groups`.
10. Injection applies to every component the operator applies defaults for: single-endpoint receivers and extensions, multi-endpoint receivers (both the gRPC and HTTP legs of OTLP), the `health_check` extension, and the `jaeger_query` extension.
11. Injected values are defaults only. A value the user set explicitly in `spec.config` is never overwritten.
12. Injection is skipped entirely when `--tls-configure-operands` is not set.

### Target Allocator

13. **[PLANNED: TRACING-6785]** The Target Allocator's HTTPS server honours the cluster profile's minimum version, cipher suites, and groups.
14. **[PLANNED: TRACING-6785]** Profile adherence applies only when Target Allocator mTLS is enabled, because that is the only condition under which the Target Allocator serves TLS.
15. **[PLANNED: TRACING-6785]** Absent a profile, the Target Allocator's HTTPS server defaults to TLS 1.2 minimum with Go's default cipher suites and curves.

### Version and Cipher Semantics

16. **GA**: Cipher suites are propagated only when the minimum version is below TLS 1.3. Go does not permit configuring TLS 1.3 cipher suites, so the operator omits them rather than emitting a setting that would be ignored.
17. **[PLANNED: TRACING-6785]** Groups are propagated regardless of minimum version. Unlike cipher suites, supported groups remain configurable under TLS 1.3, so the TLS 1.3 suppression that applies to ciphers must not be applied to groups.

### Group Name Translation

18. **[PLANNED: TRACING-6785]** OpenShift group names, Go `CurveID` names, and collector `curve_preferences` names are three distinct vocabularies. The operator translates explicitly; no string manipulation or `CurveID.String()` shortcut produces the collector spelling.

| OpenShift `groups` | Go `crypto/tls` | Collector `curve_preferences` |
|---|---|---|
| `X25519` | `X25519` | `X25519` |
| `secp256r1` | `CurveP256` | `P256` |
| `secp384r1` | `CurveP384` | `P384` |
| `secp521r1` | `CurveP521` | `P521` |
| `X25519MLKEM768` | `X25519MLKEM768` | `X25519MLKEM768` |
| `SecP256r1MLKEM768` | `SecP256r1MLKEM768` | `SecP256r1MLKEM768` (see rule 20) |
| `SecP384r1MLKEM1024` | `SecP384r1MLKEM1024` | `SecP384r1MLKEM1024` (see rule 20) |

19. **[PLANNED: TRACING-6785]** The operator passes every group in the profile through to the operand. It does not filter, substitute, or drop groups the operand may not accept.
20. **[PLANNED: TRACING-6785]** `SecP256r1MLKEM768` and `SecP384r1MLKEM1024` require a corresponding upstream collector change before a collector will accept them. Until that lands, a `Custom` profile naming either group causes collector startup to fail with `invalid curve type`. The default `Old`, `Intermediate`, and `Modern` profiles do not contain these groups, so only custom profiles are affected.

### Target Allocator Configuration Vocabulary

21. **[PLANNED: TRACING-6785]** The Target Allocator uses Go / `component-base` names for all three fields (`VersionTLS12`, `TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256`, `CurveP256`), matching the operator's own CLI flags. It does not use the collector's vocabulary; it is not a collector and cannot reuse `configtls`.

## Configuration Surface

### Operator flags and environment variables

| Flag | Env | Type | Default | Description | Support |
|---|---|---|---|---|---|
| `--tls-cluster-profile` | `TLS_CLUSTER_PROFILE` | bool | false | Fetch the TLS profile from the cluster's `APIServer` CR | **GA** |
| `--tls-configure-operands` | `TLS_CONFIGURE_OPERANDS` | bool | false | Inject TLS settings into generated operand configuration | **GA** |
| `--tls-min-version` | `TLS_MIN_VERSION` | string | `VersionTLS12` | Minimum TLS version, Go constant names | **GA** |
| `--tls-cipher-suites` | `TLS_CIPHER_SUITES` | []string | — | Cipher suites, Go constant names | **GA** |
| `--tls-curve-preferences` | `TLS_CURVE_PREFERENCES` | []string | — | Supported groups, Go `CurveID` names | **[PLANNED: TRACING-6785]** |

### Target Allocator configuration

Delivered through the generated `targetallocator.yaml` ConfigMap under the `https` block; each field also has a paired CLI flag that overrides the file value, matching the existing Target Allocator convention.

| Config field | Flag | Type | Default | Description | Support |
|---|---|---|---|---|---|
| `https.min_version` | `--https-min-version` | string | `VersionTLS12` | Minimum TLS version | **[PLANNED: TRACING-6785]** |
| `https.cipher_suites` | `--https-cipher-suites` | []string | — | Cipher suites | **[PLANNED: TRACING-6785]** |
| `https.curve_preferences` | `--https-curve-preferences` | []string | — | Supported groups | **[PLANNED: TRACING-6785]** |

## Constraints

1. Profile adherence depends on the `APIServer` CR and is therefore OpenShift-only. On plain Kubernetes only the manual flags apply.
2. The operator applies the profile at startup, not per reconcile. Picking up a changed profile depends on the restart in rule 5.
3. The operator does not validate that an operand supports every value in the profile. Rule 19 makes pass-through the contract, and rule 20 records the one case where that currently breaks.
4. Operand injection sets defaults only (rule 11), so a user who hardcodes weaker TLS settings in `spec.config` is not corrected by the operator. The cluster profile constrains what the operator generates, not what a user may override.
5. The OpAMP Bridge receives no TLS profile. It is marked **Not supported** in `operator.md`, so this is intentional rather than a gap.

## Open Upstream Dependency

Collector `configtls` recognises only `X25519MLKEM768` among the post-quantum hybrids. The other two became expressible when Go 1.26 added `tls.SecP256r1MLKEM768` and `tls.SecP384r1MLKEM1024`; the collector's curve allowlist was last touched in October 2025, before those constants existed, and has not caught up even though the collector now builds with Go 1.26.

This has a second effect independent of the operator: because `configtls` substitutes its own allowlist whenever `curve_preferences` is unset, rather than deferring to Go, the collector already disables both hybrids by default and offers no configuration path to re-enable them. Only an upstream change to the allowlist fixes that.

## Cross-References

- `what/operator.md` — operator behaviour and configuration surface
- `what/target-allocator.md` — Target Allocator behaviour, including mTLS
- `what/collector.md` — collector pipeline and component configuration
- `how/repo-map.md` — which repository and file to edit
