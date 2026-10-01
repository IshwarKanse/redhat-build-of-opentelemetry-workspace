# Design: propagate TLS curve preferences from the cluster TLS security profile

**Date:** 2026-10-01
**Status:** Design — pending review
**Jira:** [TRACING-6785](https://redhat.atlassian.net/browse/TRACING-6785)
**Repos:** `open-telemetry/opentelemetry-operator`, `open-telemetry/opentelemetry-collector`, `openshift/openshift-docs`
**Behavioral spec:** [`.ai/spec/what/tls-profile.md`](../../../.ai/spec/what/tls-profile.md)

## Summary

OpenShift's `APIServer` CR carries a cluster-wide TLS policy in
`spec.tlsSecurityProfile` with three fields: `minTLSVersion`, `ciphers`, and
`groups` (supported groups / elliptic curves). The OpenTelemetry Operator
already fetches the profile and propagates the first two fields to the
collector operands it generates. It **fetches `groups` and then discards it**
before the profile reaches any operand.

This design closes that gap, and extends profile adherence to the Target
Allocator, which today ignores the cluster profile entirely and hardcodes
TLS 1.2.

The work spans two upstream repos. The operator change is self-contained. A
small, independent collector change is required before two of the seven
OpenShift groups can be expressed at all.

## Goals

- `groups` travels the same path as `minTLSVersion` and `ciphers`, end to end.
- The Target Allocator's HTTPS server honours all three profile fields.
- Operator configuration surface is symmetric: a manual flag for curves to
  match the existing manual flags for version and ciphers.
- The collector's curve allowlist catches up with Go 1.26, so no OpenShift
  group is inexpressible.

## Non-goals

- OpAMP Bridge TLS profile adherence. It is marked **Not supported** in
  `.ai/spec/what/operator.md` rule 15.
- Reworking how the profile is fetched or how profile changes trigger restarts.
  Both already work and already cover `groups`.
- Validating that operands accept every value in the profile. See decision 1.
- Correcting user-supplied TLS settings in `spec.config`. Operator injection
  sets defaults only; that is existing, intended behaviour.

## Current state

### What already works

`openshifttls.NewTLSConfigFromProfile` (in
`github.com/openshift/controller-runtime-common/pkg/tls`) already sets
`tls.Config.CurvePreferences` from `profile.Groups`, via `library-go`'s
`TLSGroupsToCurveIDs`. The operator feeds the resulting function into both its
servers, so **both already honour curves today**:

| Consumer | Curves today | Wiring |
|---|---|---|
| Webhook server | Yes | `webhook.Options{TLSOpts: tlsOptsFuncs}` — `setup.go:97` |
| Metrics server (secure serving) | Yes | `metricsOptions.TLSOpts` — `setup.go:277` |

### Where it is dropped

`internal/operator/setup.go:84`. The `tls.Config` has `CurvePreferences`
populated; only two of its three fields are carried forward:

```go
cfg.Internal.OperandTLSProfile = components.NewStaticTLSProfile(
    tlsCfg.MinVersion, tlsCfg.CipherSuites)   // CurvePreferences discarded
```

### Collector operands receiving the profile today

Everything flows through `Config.Internal.OperandTLSProfile` →
`collector/configmap.go:29` and `collector/volume.go:24` →
`otelconfig.ApplyDefaults(..., components.WithTLSProfile(...))` →
`DefaultConfig.TLSProfile` → `components.TLSConfig.ApplyTLSProfileDefaults`.

Four injection points consume it:

| Injection point | Covers |
|---|---|
| `single_endpoint.go:99` (`AddressDefaulter`) | every receiver/extension built via `NewSinglePortParserBuilder` / `NewSilentSinglePortParserBuilder` |
| `multi_endpoint.go:98` | multi-endpoint receivers — both the gRPC and HTTP legs of OTLP |
| `healthcheckv1.go:42` | `health_check` extension |
| `jaeger_query_extension.go:115` | `jaeger_query` extension, HTTP leg |

Because all four already route through one shared helper, adding a field to
that helper reaches all of them with no per-component edits.

### Target Allocator

Receives no TLS profile at all. `HTTPSServerConfig.NewTLSConfig`
(`cmd/otel-allocator/internal/config/config.go:588-593`) hand-builds a
`tls.Config` with `MinVersion: tls.VersionTLS12` hardcoded, no `CipherSuites`,
no `CurvePreferences`. Its `https` config block is only emitted when mTLS is
enabled (`targetallocator/configmap.go:137`, guarded by `IsTAMTLSEnabled`) —
which is also the only condition under which the Target Allocator serves TLS,
so profile adherence is naturally scoped to mTLS.

The operator reaches the Target Allocator **only** through the generated
`targetallocator.yaml` ConfigMap; `targetallocator/container.go:95-100` passes
through just the user's own `spec.args`.

## Design

### Layer 0 — operator servers

No change. Already correct.

### Layer 1 — stop discarding curves

```go
cfg.Internal.OperandTLSProfile = components.NewStaticTLSProfile(
    tlsCfg.MinVersion, tlsCfg.CipherSuites, tlsCfg.CurvePreferences)
```

Drive-by in the same area: `setup.go:260` logs the slice returned by
`NewTLSConfigFromProfile` under the key `unsupportedCiphers`, but upstream now
appends unsupported *groups* to that same slice. Rename the key to
`unsupported`.

### Layer 2 — teach `components.TLSProfile` about curves

Add two accessors, serving the two different consumers:

- `CurveIDs() []tls.CurveID` — for the Target Allocator, which builds a
  `tls.Config` directly.
- `CurveNamesOTEL() []string` — collector vocabulary, for config injection.

`StaticTLSProfile` gains a `curves []tls.CurveID` field.

> **Trap worth calling out.** `CipherSuites()` returns `nil` when min version
> is TLS 1.3, because Go forbids configuring 1.3 cipher suites
> (`tls_profile.go:107`). Curves are **not** like that — supported groups
> remain configurable under TLS 1.3. `CurveIDs()` must not copy the guard from
> the method directly above it.

### Layer 3 — collector config injection

One field on `components.TLSConfig`, one clause in
`ApplyTLSProfileDefaults`:

```go
Curves []string `mapstructure:"curve_preferences,omitempty"`
```

All four injection points inherit it. Set only when the user left it unset.

### Layer 4 — Target Allocator

1. `HTTPSServerConfig` gains `min_version`, `cipher_suites`,
   `curve_preferences`.
2. Each gets a paired CLI flag (`--https-min-version`,
   `--https-cipher-suites`, `--https-curve-preferences`) that overrides the
   config file, matching the existing `--https-ca-file` ↔ `ca_file_path`
   convention.
3. `NewTLSConfig` applies all three, keeping `VersionTLS12` as the fallback
   when unset.
4. The operator populates the three fields from
   `params.Config.Internal.OperandTLSProfile` inside the existing
   `IsTAMTLSEnabled` block.

### Layer 5 — operator manual flag

`--tls-curve-preferences` + `TLS_CURVE_PREFERENCES` + `config.TLSConfig.Curves`,
applied in `ApplyTLSConfig`.

Precedence needs no change and is already correct: `setup.go:236-264` appends
the cluster-profile function *after* the manual one, so the cluster profile
wins whenever `--tls-cluster-profile` is set.

### Profile-change restarts

`SecurityProfileWatcher` diffs the whole `TLSProfileSpec`, so a `groups`-only
edit already triggers the graceful restart. Expected to be a no-op — covered by
a test, not a code change.

## Name translation

Three distinct vocabularies. Go's `CurveID.String()` yields `CurveP256`, which
matches neither OpenShift nor the collector, so this is an explicit map rather
than any string manipulation.

| OpenShift `groups` | Go `crypto/tls` | Collector `curve_preferences` |
|---|---|---|
| `X25519` | `X25519` | `X25519` |
| `secp256r1` | `CurveP256` | `P256` |
| `secp384r1` | `CurveP384` | `P384` |
| `secp521r1` | `CurveP521` | `P521` |
| `X25519MLKEM768` | `X25519MLKEM768` | `X25519MLKEM768` |
| `SecP256r1MLKEM768` | `SecP256r1MLKEM768` | `SecP256r1MLKEM768` † |
| `SecP384r1MLKEM1024` | `SecP384r1MLKEM1024` | `SecP384r1MLKEM1024` † |

† Requires the upstream collector task before a collector will accept it.

## Key decisions

**1. Pass groups through unfiltered; no degradation logic in the operator.**
The alternatives were filter-and-warn or fail-the-reconcile. Rejected in favour
of pass-through: the upstream collector task makes every OpenShift group
expressible, so filtering would be permanent complexity serving a temporary
problem. Accepted consequence: until that task ships, a `Custom` profile naming
either MLKEM hybrid makes collector pods fail to start with
`invalid curve type`. The default `Old` / `Intermediate` / `Modern` profiles do
not contain these groups, so only custom profiles are exposed.

**2. Scope is collector + Target Allocator.** The Target Allocator gets full
profile plumbing (version, ciphers, curves), not just curves, since it has none
today. OpAMP Bridge excluded as **Not supported**.

**3. Target Allocator uses Go / `component-base` names.** `VersionTLS12`,
`TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256`, `CurveP256`. Matches the operator's
own flags and allows reuse of `k8sapiflag.TLSVersion` / `TLSCipherSuites`; only
curves need a hand-written parser. Collector vocabulary was rejected — the
Target Allocator is not a collector and cannot reuse `configtls`.

**4. Both the operator flag and the Target Allocator flags are in scope.** The
operator already has `--tls-min-version` and `--tls-cipher-suites`; omitting the
curve equivalent would leave two of three fields manually settable and one not.
The Target Allocator flags are unused on the product path (the operator drives
it by ConfigMap) but preserve its local flag/config-field convention.

## Testing

| Level | Coverage |
|---|---|
| Unit — `components` | Curve accessors on `StaticTLSProfile`; explicit test that curves survive `MinVersion >= TLS 1.3`; name map covers all 7 `library-go` groups; `ApplyTLSProfileDefaults` sets curves only when the user left them unset |
| Unit — `config` | `ApplyTLSConfig` sets `CurvePreferences`; cluster profile overrides manual flag when both set |
| Unit — Target Allocator | `NewTLSConfig` honours all three fields and still defaults to `VersionTLS12` when unset; flag-over-config-file precedence |
| Manifest / golden | `curve_preferences` present in the generated collector ConfigMap at all four injection points; Target Allocator ConfigMap `https` block carries all three fields when mTLS is on |
| e2e (`tests/e2e-openshift`) | Set a `Custom` APIServer profile with `groups`, assert both ConfigMaps; flip the profile and assert the graceful restart picks up new curves |
| Upstream collector | Unit test asserting the two new hybrid names resolve |

## Epic task list

| # | Repo | Task | Depends on |
|---|---|---|---|
| 1 | `opentelemetry-collector` | Add `SecP256r1MLKEM768` + `SecP384r1MLKEM1024` to `tlsCurveTypes`; fix `invalid curve type` printing `curveID` instead of `curve`; make default curve ordering deterministic | — |
| 2 | `opentelemetry-operator` | Extend `TLSProfile` / `StaticTLSProfile` with curves + name map; capture `tlsCfg.CurvePreferences` at `setup.go:84`; fix `unsupportedCiphers` log label | — |
| 3 | `opentelemetry-operator` | `curve_preferences` on `components.TLSConfig` + `ApplyTLSProfileDefaults` → all four collector injection points | 2 |
| 4 | `opentelemetry-operator` | `--tls-curve-preferences` flag + `TLS_CURVE_PREFERENCES` env + `config.TLSConfig.Curves` | 2 |
| 5 | `opentelemetry-operator` (TA) | `HTTPSServerConfig` gains the three fields (Go-style names) + paired CLI flags; `NewTLSConfig` applies them | — |
| 6 | `opentelemetry-operator` | Target Allocator ConfigMap generator populates the three fields from `OperandTLSProfile` | 2, 5 |
| 7 | `opentelemetry-operator` | Verify `SecurityProfileWatcher` restarts on a `groups`-only change (test-only; expected no-op) | 2 |
| 8 | `opentelemetry-operator` | e2e-openshift test | 3, 6 |
| 9 | `openshift-docs` | Document curve propagation on the TLS profile page | 3, 6 |
| 10 | workspace | `.ai/spec` update | — |

Task 1 is upstream-only and may land on a different release train. Nothing in
2-9 blocks on it, because the operator passes group names straight through
(decision 1).

## Open upstream dependency

Collector `configtls` recognises only `X25519MLKEM768` among the post-quantum
hybrids. The other two became expressible when Go 1.26 added
`tls.SecP256r1MLKEM768` and `tls.SecP384r1MLKEM1024`. The collector's curve
allowlist was last touched in October 2025 (PR #13992, the FIPS/non-FIPS
split), before those constants existed, and has not caught up even though the
collector now declares `go 1.26.0`.

There is a second effect independent of this work. `configtls` substitutes its
own allowlist whenever `curve_preferences` is unset, rather than deferring to
Go:

```go
// configtls.go:154-169
allowedCurves := slices.Collect(maps.Values(tlsCurveTypes))
...
if len(curvePreferences) == 0 {
    curvePreferences = allowedCurves   // not "leave to Go's default"
}
```

So the collector already disables both hybrids by default and offers no
configuration path to re-enable them. Only an upstream allowlist change fixes
that.

## Notes

- The Red Hat collector builds with `GOFIPS140=certified` and
  `GODEBUG=fips140=auto` (`redhat-opentelemetry-collector/Dockerfile.art`), not
  the `requirefips` build tag. The FIPS-trimmed curve map in `curves_fips.go` is
  therefore not in play, and `X25519` resolves normally.
- The Google doc referenced on the Jira is also cited in a `TODO` inside
  `NewTLSConfigFromProfile`, concerning how to handle cipher suites under
  TLS 1.3.

## References

- `internal/operator/setup.go` — profile fetch, `tls.Config` assembly, the drop at line 84
- `internal/components/tls_profile.go` — `TLSProfile` interface, `StaticTLSProfile`
- `internal/config/tls.go` — manual flag application
- `cmd/otel-allocator/internal/config/config.go:567-640` — Target Allocator `NewTLSConfig`
- `internal/manifests/targetallocator/configmap.go:137` — Target Allocator `https` block
- `go.opentelemetry.io/collector/config/configtls` — `curve_preferences`, `tlsCurveTypes`
- `github.com/openshift/library-go/pkg/crypto` — `TLSGroupsToCurveIDs`, `tlsGroupToCurveID`
