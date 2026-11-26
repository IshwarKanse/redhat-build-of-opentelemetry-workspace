# Identity-Aware Authentication and Authorization for Telemetry Ingestion

[PLANNED: TRACING-6994] Documents how the OTEL collector supports identity-aware authentication and authorization at the ingestion layer, with multi-tenant routing as the primary use case. The target for 3.13 is a new `k8s_auth` extension, shipped as Technology Preview (see Planned Behavior). Nothing in this file is implemented in the product yet, except where a component is marked as already in the distro.

Related tickets: [TRACING-6994](https://redhat.atlassian.net/browse/TRACING-6994) (epic), [OBSDA-1512](https://redhat.atlassian.net/browse/OBSDA-1512) (parent feature), [RHAIRFE-3630](https://redhat.atlassian.net/browse/RHAIRFE-3630), [RHAISTRAT-2925](https://redhat.atlassian.net/browse/RHAISTRAT-2925). Design: `docs/superpowers/specs/2026-11-26-identity-aware-ingestion-k8s-auth-design.md`.

**How to read the claims in this file.** A cluster test ran on 2026-11-26 on one OpenShift 4.22 nightly (GCP, default token issuer) with upstream contrib 0.163.2 and 0.166.0 and the released Red Hat image (0.158.0). Statements marked **(measured)** come from that test and hold for that setup only. Statements marked **(read from code)** were not run. Upstream (non-OpenShift) Kubernetes, STS and workload-identity clusters, hosted control planes, a real MLflow and signing key rotation were not tested. The numbered findings are in the design document.

## Problem Summary

Organizations that deploy the collector as a shared telemetry gateway need to:

1. **Authenticate senders** — verify _who_ is sending telemetry (not just that they can reach the endpoint).
2. **Authorize per destination** — enforce _what_ a verified sender may write to (which tenant, project, or backend).
3. **Bind identity to data** — replace self-declared identity (headers, attributes) with verified identity so attribution is trustworthy.
4. **Forward identity downstream** — carry verified identity to backends so cross-system correlation is possible.


## Current Collector Capabilities

### Authentication Extensions

The collector has a server-side auth extension interface (`extensionauth.Server`). An extension's `Authenticate(ctx, sources)` validates credentials from request headers/metadata and returns a context enriched with `client.Info` containing `client.AuthData`. Downstream pipeline components access this via `client.FromContext(ctx)`.

| Extension | Support Level | Capabilities | Limitations |
|---|---|---|---|
| **OIDC Auth** (`oidcauth`) | **TP** | Validates JWT tokens via OIDC discovery or JWK file. Multi-provider. Exposes `subject`, `membership` (groups), and arbitrary JWT claims (e.g. `claims.tenant_id`) as auth attributes. Validates K8s SA tokens when given the cluster key set as a `public_keys_file` (measured). | Requires JWT tokens — not all senders have them. For K8s SA tokens: signature check only, so no revocation and no access check; discovery and `jwks_url` do not work against the API server out of the box (see Authentication Option A). |
| **Kubernetes Auth** (`k8s_auth`) | **[PLANNED: TRACING-6994]** TP | Validates K8s tokens with TokenReview, optionally authorizes with SubjectAccessReview, exposes identity as auth attributes. | Does not exist yet. See Planned Behavior. |
| **Bearer Token Auth** (`bearertokenauth`) | **GA** | Static token match (single token, list, or file). | No identity extraction — validates the token matches but sets no `AuthData` attributes. Cannot distinguish senders. |
| **OAuth2 Client** (`oauth2clientauth`) | **TP** | Client-side only (for exporters authenticating to backends). | Not a server authenticator — irrelevant for receiver auth. |

**Bottom line:** OIDC auth is the only extension in the distro today that both authenticates _and_ extracts identity attributes. Bearer token auth is identity-blind. No extension in the distro can ask the cluster whether a token is still valid or whether its owner may write to a destination.

### Identity Propagation Through the Pipeline

Authenticated identity (`client.Info.Auth`) is per-request context — it is available to pipeline components but lost at the batch processor boundary. Two mechanisms use it for different purposes:

**1. Routing connector** — reads auth attributes directly via the OTTL otelcol context to decide which pipeline data goes to. This is per-request and does not persist identity into the telemetry data:

```yaml
connectors:
  routing:
    table:
      - condition: otelcol.client.auth.attributes["k8s.namespace.name"] == "team-a"
        pipelines: [traces/team-a]
      - condition: otelcol.client.auth.attributes["k8s.namespace.name"] == "team-b"
        pipelines: [traces/team-b]
    default_pipelines: [traces/default]
```

Documented in [`pkg/ottl/contexts/ottlotelcol/README.md`](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/contexts/ottlotelcol/README.md): `otelcol.client.auth.attributes["key"]` reads a specific auth attribute; the full map is also available.

**2. Resource/attributes processors** — stamps identity into resource attributes via `from_context` with the `auth.` prefix, so it persists in the telemetry data, survives batching, and is exported with the spans/metrics/logs. Without this, the backend has no record of who sent the data:

```yaml
processors:
  resource:
    attributes:
      - key: sender.namespace
        action: delete                       # clear any sender-supplied value first
      - key: sender.service_account
        action: delete                       # clear any sender-supplied value first
      - key: sender.namespace
        from_context: "auth.k8s.namespace.name"
        action: insert                       # skipped silently if the auth attribute is missing
      - key: sender.service_account
        from_context: "auth.k8s.serviceaccount.name"
        action: insert
```

**Security: delete before stamping, and reject unstamped data.** Using `upsert` alone is unsafe — if the auth extension does not provide the requested attribute, `upsert` leaves any pre-existing value unchanged, so a sender could supply a `sender.namespace` resource attribute that downstream consumers mistake for verified identity. The `delete` first removes any sender-supplied value. Caveat: `insert` does **not** fail visibly — in `attraction.go` (checked at v0.163.0) the action is silently skipped when the `from_context` value is not found, with no log or error, and after the `delete` it behaves the same as `upsert`. The data continues with no `sender.namespace` and nothing tells the operator. The actual enforcement must therefore be structural: route data without a verified identity to the reject pipeline (see the routing connector's `default_pipelines` in the examples below) so unstamped data never reaches a tenant exporter.

Confirmed in [`internal/coreinternal/attraction/attraction.go`](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/internal/coreinternal/attraction/attraction.go) (line 371: `authPrefix = "auth."`).

### Identity Forwarding to Backends

The **headers setter extension** (`headerssetter`) can set outbound headers on exporter requests. It supports two source types:

1. **`from_context`** — reads from `client.Info.Metadata` (request headers/gRPC metadata). Requires `include_metadata: true` on the receiver. Resolves any key present in the incoming request metadata (case-insensitive). Implementation: [`headerssetterextension/internal/source/context.go`](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/extension/headerssetterextension/internal/source/context.go).

2. **`from_attribute`** — reads from `client.Info.Auth.GetAttribute(key)` (auth extension attributes like `subject`, `membership`, `claims.*`). Implementation: [`headerssetterextension/internal/source/attribute.go`](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/extension/headerssetterextension/internal/source/attribute.go).

**Important:** The headers setter's `from_context` and `from_attribute` are different from the resource processor's `from_context`. The resource processor's `from_context` supports the `auth.` prefix to read auth attributes (e.g., `from_context: "auth.claims.tenant_id"`). The headers setter does NOT — its `from_context` reads only from request metadata, and `from_attribute` reads from auth attributes.

### Identity Forwarding and Token Passthrough Example

This example shows the RHOAI Flow 2 pattern for MLflow: the routing connector selects a per-identity pipeline using verified auth attributes, each pipeline sets a **static** experiment header, and the raw bearer token is passed through so MLflow can perform its own `SelfSubjectAccessReview`. It assumes the planned `k8s_auth` extension (Authentication Option B) — it does not exist yet, so this exact config has not been run. The same passthrough mechanism was run with the OIDC extension in place of `k8s_auth` and the batch processor's `metadata_keys` (measured: the backend received the sender's token).

When `include_metadata: true` is set on the receiver, ALL incoming headers (including `Authorization`) are stored in `client.Info.Metadata`. The headers setter extension forwards the token using `from_context` (which reads from metadata). This works for both gRPC ([`configgrpc.go`](https://github.com/open-telemetry/opentelemetry-collector/blob/main/config/configgrpc/configgrpc.go) copies all gRPC metadata) and HTTP ([`confighttp/clientinfohandler.go`](https://github.com/open-telemetry/opentelemetry-collector/blob/main/config/confighttp/clientinfohandler.go) clones all HTTP headers) receivers.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        include_metadata: true            # store request headers in client.Info.Metadata
        auth:
          authenticator: k8s_auth
      http:
        include_metadata: true
        auth:
          authenticator: k8s_auth

extensions:
  k8s_auth: {}                         # audiences defaults to the API server audience — required for MLflow passthrough (see audience note below)
  headers_setter/team-a:
    headers:
      - action: upsert
        key: x-mlflow-experiment-id        # static per-tenant experiment — never taken from sender metadata
        value: "12345"
      - action: upsert
        key: Authorization                 # raw bearer token passthrough for MLflow SSAR
        from_context: authorization        # reads from client.Info.Metadata

processors:
  resource/stamp-identity:
    attributes:
      - key: sender.namespace
        action: delete                     # clear sender-supplied value
      - key: sender.service_account
        action: delete                     # clear sender-supplied value
      - key: sender.namespace
        from_context: "auth.k8s.namespace.name"
        action: insert                     # insert verified identity
      - key: sender.service_account
        from_context: "auth.k8s.serviceaccount.name"
        action: insert

connectors:
  routing:
    table:
      - condition: otelcol.client.auth.attributes["k8s.namespace.name"] == "team-a"
        pipelines: [traces/team-a]
    default_pipelines: [traces/reject]     # data without verified identity never reaches a tenant exporter

exporters:
  otlphttp/mlflow-team-a:
    endpoint: http://mlflow:5000           # the exporter auto-appends /v1/traces; MLflow OTLP/HTTP requires v3.7.0+ (v3.6.0 has gzip and content-type bugs), gRPC not supported. Use TLS in production.
    auth:
      authenticator: headers_setter/team-a
    sending_queue:                         # replaces the deprecated batchprocessor (QueueBatchConfig)
      batch:                               # batching config within the sending queue
        partition:                         # partitioning controls how requests are grouped into batches
          metadata_keys:                   # requests with different values for these keys get separate batches
            - authorization                # each unique bearer token gets its own batch, preserving the token across batching
  debug/reject:
    verbosity: basic

service:
  extensions: [k8s_auth, headers_setter/team-a]
  pipelines:
    traces/ingress:
      receivers: [otlp]
      processors: [resource/stamp-identity]
      exporters: [routing]
    traces/team-a:
      receivers: [routing]
      exporters: [otlphttp/mlflow-team-a]
    traces/reject:
      receivers: [routing]
      exporters: [debug/reject]
```

The `traces/team-a` pipeline pattern repeats per tenant — one headers setter, one exporter, one routing table entry each.

**Three header sources, different trust and durability characteristics:**
- **Static `value:`** — the per-tenant experiment (or tenant) header. The routing connector already selected the pipeline using verified auth attributes before batching, so a hardcoded value is trusted. Safe under batching. Until `k8s_auth` exists, this is the only safe way to set a tenant identifier on a batched exporter. With `k8s_auth`, a header that the extension checked may also be forwarded (Planned Behavior rules 9 to 11).
- **`from_context: authorization`** — token passthrough. The sender controls the header, but the auth extension validates the token at ingestion, so forwarding it is safe. Survives batching when `metadata_keys` includes `authorization`.
- **`from_attribute`** — reads verified identity from `client.Info.Auth`. **Do not use it until the nil check is fixed upstream:** the headers setter's `AttributeSource.Get` calls `cl.Auth.GetAttribute` with no nil check (same code at v0.158.0, v0.163.0 and v0.166.0). Two ways to reach a nil `Auth`:
  - *No server authenticator on the receiver* (measured on 0.163.2 and 0.166.0): with the exporter's default sending queue the sender gets a success response and the collector process then crashes; with the queue disabled the request fails and the process survives.
  - *After a batch merge* (read from code): when a second request merges into an existing batch the batch context carries `client.Info{Metadata: ...}` only. A single request per batch keeps its original context, so this crash would appear only under load.

  With an authenticator and no batching it reads the verified identity. With batching, use static per-pipeline values instead.

**Security: never derive a tenant header from sender metadata.** `from_context` reads from request metadata — the sender controls all incoming headers. **Never use `from_context` with a sender-supplied header as a tenant identifier** (e.g., `X-Scope-OrgID` or `x-mlflow-experiment-id`), because the sender can set any value and select another tenant even when authentication succeeds. The one exception is a header whose value the planned `k8s_auth` extension approved with an access check (Planned Behavior rules 9 to 11): that value is verified, so it may be forwarded. Measured with kube-rbac-proxy doing the check: two tenants sending at the same time through one pipeline, with the header in the batch processor's `metadata_keys`, each reached the backend with their own tenant header. The safe patterns:
- **Without batching, on a receiver that has an authenticator:** `from_attribute` reads verified identity from `client.Info.Auth`. Do not rely on it until the nil check is fixed upstream (see the crash note above); prefer static values.
- **With batching:** per-tenant pipelines with **static** header values, as in the example above — the routing decision is made on verified auth attributes before batching, and the headers setter uses a hardcoded `value:`.

**Batching caveat:** `metadata_keys` preserves specified metadata keys across batching but creates per-token batching buckets — each unique token gets its own batch. This preserves correctness but reduces batching efficiency. The config above uses exporter-level batching (`sending_queue::batch`) which replaces the deprecated `batchprocessor` (see migration RFC: [`docs/rfcs/batching-migration.md`](https://github.com/open-telemetry/opentelemetry-collector/blob/main/docs/rfcs/batching-migration.md)). The exporter-level form has not been run; only the batch processor's `metadata_keys` was (measured).

**Backend denial and batching (measured):** when the backend rejects the forwarded token, a pipeline with no batch processor and the sending queue disabled returns the denial to the sender (HTTP 403). With a batch processor and the default queue the sender gets a success response and the data is dropped; only the collector log shows the failure. The backend in the test was a kube-rbac-proxy, not MLflow.

**Audience constraint for passthrough:** a shared custom audience **cannot work** when the backend validates the forwarded token via the K8s API. MLflow performs its `SelfSubjectAccessReview` with the forwarded token as a bearer credential against kube-apiserver, and the API server only accepts tokens that carry its own audience. A `serviceAccountToken` volume projection takes a single audience, so in practice the sender must use the **default-audience** token (audience `https://kubernetes.default.svc`) and the collector's TokenReview must accept that audience — which is the default. A collector-specific audience (e.g., `otel-gateway`) works only for the collector-terminated pattern, where identity is forwarded as derived attributes and the backend never sees the token. See the audience discussion in the End-to-End Example below.

The headers setter extension is Technology Preview since 3.11 (docs module in review: [openshift/openshift-docs#124255](https://github.com/openshift/openshift-docs/pull/124255), TRACING-6505). The 3.12 build ships `headerssetterextension` v0.163.0 (see `what/collector.md`).

### Routing Connector

The routing connector (TP in the Red Hat distro) routes telemetry to different pipelines based on OTTL conditions. It supports resource, span, log, metric, datapoint, and otelcol contexts. Key capabilities:

- Routes on `otelcol.client.auth.attributes["key"]` — identity-based routing without stamping attributes first.
- Routes on `otelcol.client.metadata["key"]` or `otelcol.grpc.metadata["key"]` — header-based routing.
- Routes on `resource.attributes["key"]` — attribute-based routing (after identity has been stamped).
- Static routing table — adding/removing tenants requires config changes and collector reload.

### Context Lifecycle and Batching

`client.Info` (including auth data) is per-request context. **Both the legacy batch processor and its replacement (exporter-level batching via `sending_queue::batch`, RFC: [`docs/rfcs/batching-migration.md`](https://github.com/open-telemetry/opentelemetry-collector/blob/main/docs/rfcs/batching-migration.md)) discard `client.Info.Auth` during batching.** The new batcher's merge function ([`metadata_partitioner.go`](https://github.com/open-telemetry/opentelemetry-collector/blob/main/exporter/exporterhelper/internal/queuebatch/metadata_partitioner.go)) creates a new context with only `client.Info{Metadata: ...}` — Auth and Addr are explicitly not carried over.

| Context field | What it holds | Preserved after batching? |
|---|---|---|
| `client.Info.Metadata` | Request headers (HTTP) or metadata (gRPC), populated when `include_metadata: true`. E.g., `authorization`, `content-type`, custom headers. | Only entries whose key name is in `metadata_keys` are preserved (both old and new batcher); all other metadata entries are dropped |
| `client.Info.Auth` | Structured identity from an auth extension: claims, subject, groups, raw token. Set by extensions like OIDC (`subject`, `membership`, `claims.*`, `raw`) or the planned `k8s_auth` (`subject`, `membership`, `k8s.namespace.name`, `k8s.serviceaccount.name`, and others — see Planned Behavior). | **Never** — absent in all batching scenarios, including persistent queue (not serialized) (read from code; measured for the batch processor: identity stamped after it is empty). Reading a nil `Auth` via the headers setter's `from_attribute` **crashes the collector** (no nil check in `AttributeSource.Get`) |
| `client.Info.Addr` | The client's network address (`net.Addr`). | Lost in memory batching; preserved in persistent queue serialization |

**Implications for pipeline ordering:**
- The **routing connector** must run before batching — it reads `client.Info.Auth` directly.
- The **resource processor** must stamp auth attributes into resource attributes before batching — stamped attributes survive in the telemetry data.
- The headers setter's **`from_attribute`** reads from `client.Info.Auth` — when `Auth` is nil the collector **crashes** (measured with no authenticator; read from code for the batch-merge case). Do not use it with a batched exporter or on a receiver without an authenticator; use static per-pipeline header values instead (see Identity Forwarding and Token Passthrough Example above).
- The headers setter's **`from_context`** reads from `client.Info.Metadata` — works after batching if the key is listed in `metadata_keys`. Use it for token passthrough. For tenant identifiers use it only with a header that the planned `k8s_auth` extension checked (Planned Behavior rules 9 to 11); any other header is sender-controlled.

## Gap Analysis

### What Works Today

| Need | Mechanism | Status |
|---|---|---|
| Authenticate JWT-bearing senders | OIDC auth extension | **Works** (TP) |
| Authenticate K8s SA tokens by signature | OIDC auth extension with the cluster key set as `public_keys_file` | **Works** (TP; measured on 0.158.0, 0.163.2, 0.166.0) — no revocation, no access check, and nothing keeps the key file in sync |
| Extract identity claims to pipeline context | OIDC auth → `client.Info.Auth` | **Works** |
| Stamp verified identity into resource attributes | Resource processor `from_context: "auth.claims.*"` for string claims; OTTL `otelcol.client.auth.attributes[...]` for nested claims such as `claims.kubernetes.io` | **Works** (measured: the resource processor sets nothing for a map-valued claim) |
| Route to per-tenant pipelines based on identity | Routing connector `otelcol.client.auth.attributes["key"]` | **Works** (TP) |
| Forward identity to multi-tenant backends | Headers setter extension with static per-pipeline values (plus `from_context` for token passthrough only) | **Works** — extension in distro (TP since 3.11) |

### What Is Missing

| Need | Gap | Severity |
|---|---|---|
| **Kubernetes token authentication with revocation** | The OIDC extension checks the signature only: the token of a deleted pod was still accepted (measured; its expiry was one year after issue). Only a TokenReview sees that the pod, service account or token is gone. A new TokenReview auth extension is needed. | **High** — K8s workloads are the primary sender type on OpenShift |
| **Authorization enforcement** | Auth extensions authenticate (who?) but nothing authorizes (may this sender write here?). The routing connector provides implicit authorization (route or drop) via its static routing table — a workable baseline, but explicit SubjectAccessReview-based rejection is preferred (see Authorization section). | **Medium** — implicit authorization drops silently; explicit rejection is preferred |
| **Rejection signaling** | When the routing connector has no matching route, data goes to `default_pipelines` and the sender gets a success response (measured). There is no mechanism to send an error response to the sender explaining why data was rejected. | **Medium** — operators need visibility; senders need feedback |
| **Rejection metrics** | Collector self-metrics at the default level have no authentication failure metric (measured). The OIDC extension logs one warning per failure. | **Medium** — OBSDA-1512 asks for observable rejections |

## Approaches

The problem has two layers: **authentication** (verify who is sending) and **authorization** (enforce what they may send to). This section covers both.

### Authentication: Validating K8s Service Account Tokens

Kubernetes service account tokens are JWTs signed by the cluster's service account issuer. Three options for validating them at the collector:

#### Option A: OIDC Auth Extension — Works With a Key File, Without Revocation

The OIDC auth extension checks the token's signature against the issuer's public keys. It has three ways to get the keys; against the OpenShift API server they behave as follows (measured unless noted):

- **Discovery (`issuer_url` only): fails.** The extension fetches `{issuer_url}/.well-known/openid-configuration` with a plain HTTP client and no bearer token. The API server answers this request anonymously (HTTP 200), so authentication of the discovery request is not the blocker. It fails later: the discovery document points to the key set on the external API URL, whose certificate is signed by a different CA than the in-cluster service URL, and the key set refuses anonymous requests (next two points).
- **`issuer_ca_path` trusts one certificate.** The extension reads only the first PEM block of the file (read from code: a single `pem.Decode`). The service account `ca.crt` bundle held six certificates and the one that signs `kubernetes.default.svc` was the third, so the bundle cannot be used as is. The pool is also exclusive — system roots are not included.
- **`jwks_url` (contrib v0.166.0 and later): fails without help.** The key set endpoint (`/openid/v1/jwks`) answers 403 to an anonymous request and 200 to a request with a service account token; the extension sends no token. It works when a local `oc proxy --accept-paths='^/openid/v1/jwks$'` sidecar serves the key set on `127.0.0.1` and `jwks_url` points at it. No cluster-wide RBAC change is needed for that.
- **`public_keys_file`: works**, on 0.158.0 (the released image), 0.163.2 and 0.166.0. The file is the output of `oc get --raw /openid/v1/jwks` in a ConfigMap. The extension reloads the file when it changes (run on 0.163.2 only: a swapped key took effect in under a minute without a restart; an empty key set is refused and the old keys stay). Nothing keeps the ConfigMap in sync with the cluster, so a sync mechanism is still needed.

**Other facts:**
- **Audience.** Default SA tokens carry `aud: ["https://kubernetes.default.svc"]` on this cluster, and the extension accepts them with `audience: https://kubernetes.default.svc`. A custom projected audience is not required; a token with a different audience is rejected.
- **Issuer URL varies by cluster type.** Standard OpenShift uses `iss: https://kubernetes.default.svc`. AWS STS uses an S3 bucket URL. Azure WIF ARO uses `https://{region}.oic.aro.azure.net/{tenant}/{uuid}`. The config must match the cluster. Not tested on those clusters.
- **Identity.** `subject` is the user name (`system:serviceaccount:<namespace>:<name>`). The namespace, service account and pod are inside the map-valued claim `claims.kubernetes.io` and are readable only with OTTL (`otelcol.client.auth.attributes["claims.kubernetes.io"]["namespace"]`), not with the resource processor.
- **No revocation.** The token of a deleted pod was still accepted. Its expiry was one year after issue.
- **No access check.** Authorization is routing only.

**Verdict:** Usable today for K8s SA tokens with a key file, and it keeps token passthrough working. It is a fallback, not the target: it has no revocation and no access check, and it needs a key sync mechanism.

#### Option B: Kubernetes Auth Extension `k8s_auth` (TokenReview)

A dedicated extension that validates the bearer token via the K8s TokenReview API, extracts identity (namespace, service account name, groups), and exposes them as auth attributes. This does not exist upstream yet — contrib v0.163.0 (the version 3.12 ships), v0.166.0 and contrib main (2026-11-26) have no Kubernetes token auth extension, and a search found no upstream issue that proposes one.

```yaml
extensions:
  k8s_auth: {}   # authentication only; audiences default to the API server's own
```

**Decision [PLANNED: TRACING-6994]:** Red Hat writes this extension, `k8s_auth`, in a Red Hat repository and ships it in 3.13 as Technology Preview. The proposed location, not yet confirmed, is a Go module folder in `redhat-opentelemetry-collector`. It is proposed for `opentelemetry-collector-contrib` in parallel. Its behavior is specified in Planned Behavior below.

**Existing external implementation:** [`github.com/Jamstah/k8ssaauthextension`](https://github.com/Jamstah/k8ssaauthextension) by James Hewitt (IBM), component type `k8ssaauth`. It is a reference, not the code base: development stability, 6 commits, unchanged since February 2026, not proposed for contrib. Read from its code: `Authenticate` returns the incoming context unchanged, so it exposes no identity to the pipeline; its SubjectAccessReview step is mandatory (`resource_attributes` is required), so it has no authentication-only mode; it has no cache. The author is invited as a co-owner for the contrib proposal.

The related core collector issue [#6987](https://github.com/open-telemetry/opentelemetry-collector/issues/6987) (closed) was about client-side K8s SA auth, not server-side. The `k8sattributesprocessor` provides precedent for K8s-specific components in contrib.

**Upstream discussion:** Issue [#48895](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/48895) ("Support Multitenant Kubernetes Self-Service") — the closest upstream conversation to this use case.

#### Option C: Auth Proxy Sidecar (kube-rbac-proxy)

Deploy `kube-rbac-proxy` as a sidecar in front of the collector. The proxy validates SA tokens via TokenReview, optionally checks SubjectAccessReview, and forwards authenticated identity as HTTP headers.

kube-rbac-proxy must be started with `--auth-header-fields-enabled=true`. It then sets `x-remote-user` (e.g. `system:serviceaccount:ns:name`) and `x-remote-groups` on proxied requests. The collector reads these via `include_metadata: true`:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: localhost:4317  # only reachable from the sidecar
        include_metadata: true
      http:
        endpoint: localhost:4318
        include_metadata: true
```

The routing connector routes on `otelcol.client.metadata["x-remote-user"]`. gRPC is supported via `--upstream-force-h2c`.

**Security requirement:** The identity headers are untrusted metadata from the collector's perspective. The receiver must bind to `localhost` so that pods cannot bypass the proxy. Without this, any sender can set `x-remote-user` and impersonate any identity. With the localhost binding, a direct connection to the receiver port was refused, and the proxy overwrote `x-remote-user` and `x-remote-groups` headers that a sender set (measured).

**Measured behavior** (image from the release payload, added with `additionalContainers`):
- 401 without a valid token, 403 with a reason when RBAC denies, 200 when allowed. A denied gRPC sender sees `PermissionDenied`. gRPC needs its own proxy instance with `--upstream-force-h2c`.
- The token of a deleted pod is rejected (401), unless the proxy saw the token while the pod lived; then it was still accepted seconds after deletion (cache; duration not measured).
- The proxy can check a destination namespace taken from a request header (`rewrites.byHttpHeader` in its config file). If any value of that header is forbidden, the request gets 403.
- **The proxy removes the `Authorization` header before the collector**, and none of its flags keeps it. Token passthrough to a backend does not work behind it, so it cannot serve backends that check the sender's token themselves (the RHOAI MLflow flow).
- It logged nothing for 403 denials at default verbosity; only failed authentications were logged.
- The operator's generated NetworkPolicy allowed the receiver ports only. The proxy ports timed out until declared in the collector's `spec.ports`.

**Pros:** Well-established OpenShift pattern. No collector code changes. Works for both HTTP and gRPC. TokenReview and SubjectAccessReview with visible denial.
**Cons:** No token passthrough. Identity is metadata headers, not `client.Info.Auth`. Adds one sidecar per protocol and a network hop. No denial log by default.

#### Authentication Recommendation

**Option B** (the `k8s_auth` TokenReview extension) is the target for 3.13 — the only option that gives revocation, an access check with visible denial and token passthrough together. **Option A** (OIDC with a key file) and **Option C** (kube-rbac-proxy) are tested fallbacks if the extension slips: Option A for backends that check the forwarded token themselves, Option C for backends that trust the gateway. Neither is documented as a product pattern while the extension is on track.

### Authorization: Enforcing What Senders May Send To

Authentication tells us _who_ is sending. Authorization enforces _where_ they can send. Two models:

#### Option A: Implicit Authorization via Routing Connector

The routing connector's OTTL conditions act as an implicit authorization layer: authenticated senders are routed to their allowed pipelines, and unmatched senders go to a reject pipeline.

```yaml
connectors:
  routing:
    table:
      - condition: otelcol.client.auth.attributes["k8s.namespace.name"] == "team-a"
        pipelines: [traces/team-a]
      - condition: otelcol.client.auth.attributes["k8s.namespace.name"] == "team-b"
        pipelines: [traces/team-b]
    default_pipelines: [traces/reject]
```

Each routing rule is an allow rule (identity → pipeline). Per-tenant pipeline isolation prevents cross-tenant writes. Static routing table — adding a tenant requires a config change and collector reload, acceptable for the expected tenant counts.

**Limitation:** The sender receives a success response even when data is dropped (measured: an authenticated sender with no matching route got HTTP 200 and its data went to `default_pipelines`).

#### Option B: Explicit Authorization via K8s RBAC (SubjectAccessReview)

The planned `k8s_auth` extension (Authentication Option B) has an optional SubjectAccessReview step that rejects unauthorized senders _before_ data enters the pipeline:

```yaml
extensions:
  k8s_auth:
    authorization:
      resource_attributes:
        group: telemetry.opentelemetry.io
        resource: traces
        verb: create
        namespace_from_header: x-tenant   # or a fixed `namespace:` value
```

Authorization is managed via standard K8s RBAC — an admin creates a Role granting `create` on `traces` in that API group and binds it to the sender's SA. Senders without the binding get an error. The resource is a name used only for the RBAC check; no such API object exists.

Two kinds of check:
- **Fixed attributes** answer "may this sender use this gateway at all?"
- **A destination taken from a request header** answers "may this sender write to the destination it asked for?" The sender names the destination, RBAC decides, and the approved value is exposed to the pipeline as an auth attribute. The same check was run with kube-rbac-proxy (measured, see Authentication Option C).

**Pros over Option A:** True rejection (sender gets an error, not silent drop). Managed via K8s RBAC — adding a sender is a RoleBinding, not a collector config change. Adding a destination is also only a RoleBinding when the gateway forwards the checked header through a single pipeline; with one pipeline per tenant it also needs a route. Auditable via K8s audit logs.
**Cons:** Adds one synchronous API call per uncached request. One access check per extension instance; a different check per signal needs one instance per receiver.

**Both can coexist:** SAR gates entry and approves the destination (reject with an error), routing directs traffic to the correct pipeline.

#### Authorization Recommendation

**Option B** (SAR in `k8s_auth`) is the target — it provides true rejection and uses standard K8s RBAC. **Option A** (routing connector) works today without new components, but its denial is silent.

**Note on Authorino/Kuadrant:** RHAISTRAT-2925 mentions Authorino/Kuadrant, but these sit in front of the **MaaS gateway** (not the collector). Authorino authenticates callers at the MaaS API layer and forwards identity as HTTP headers. The collector receives traces from the MaaS payload processor after authentication has already happened.


## End-to-End Example: Multi-Tenant Gateway

Combining components for a two-tenant setup where each tenant uses a K8s service account with a projected token. This example assumes the planned `k8s_auth` extension (Authentication Option B), so it has not been run as written. The same shape — authenticate, stamp, route by identity, per-tenant static header — was run with the OIDC extension and with kube-rbac-proxy in its place (measured).

```yaml
extensions:
  k8s_auth:
    audiences: [otel-gateway]   # collector-terminated pattern — see audience note in Key points below
  headers_setter/team-a:
    headers:
      - action: upsert
        key: X-Scope-OrgID
        value: team-a
  headers_setter/team-b:
    headers:
      - action: upsert
        key: X-Scope-OrgID
        value: team-b

receivers:
  otlp:
    protocols:
      grpc:
        auth:
          authenticator: k8s_auth
      http:
        auth:
          authenticator: k8s_auth

processors:
  resource/stamp-identity:
    attributes:
      - key: sender.namespace
        action: delete
      - key: sender.service_account
        action: delete
      - key: sender.namespace
        from_context: "auth.k8s.namespace.name"
        action: insert
      - key: sender.service_account
        from_context: "auth.k8s.serviceaccount.name"
        action: insert
  batch/team-a:
    timeout: 5s
  batch/team-b:
    timeout: 5s

connectors:
  routing:
    table:
      - condition: otelcol.client.auth.attributes["k8s.namespace.name"] == "team-a"
        pipelines: [traces/team-a]
      - condition: otelcol.client.auth.attributes["k8s.namespace.name"] == "team-b"
        pipelines: [traces/team-b]
    default_pipelines: [traces/reject]

exporters:
  otlp/team-a-tempo:
    endpoint: tempo-team-a:4317
    auth:
      authenticator: headers_setter/team-a
  otlp/team-b-tempo:
    endpoint: tempo-team-b:4317
    auth:
      authenticator: headers_setter/team-b
  debug/reject:
    verbosity: basic

service:
  extensions: [k8s_auth, headers_setter/team-a, headers_setter/team-b]
  pipelines:
    traces/ingress:
      receivers: [otlp]
      processors: [resource/stamp-identity]
      exporters: [routing]
    traces/team-a:
      receivers: [routing]
      processors: [batch/team-a]
      exporters: [otlp/team-a-tempo]
    traces/team-b:
      receivers: [routing]
      processors: [batch/team-b]
      exporters: [otlp/team-b-tempo]
    traces/reject:
      receivers: [routing]
      processors: []
      exporters: [debug/reject]
```

**Key points:**
- The TokenReview extension validates SA tokens and exposes structured identity (`k8s.namespace.name`, `k8s.serviceaccount.name`, `k8s.pod.name`, and others) as auth attributes.
- Identity stamping (`resource/stamp-identity`) happens before the routing connector, so identity survives batching in per-tenant pipelines (measured with the batch processor: identity stamped before it survives, stamped after it is empty).
- Routing uses the `k8s.namespace.name` auth attribute — each namespace maps to a tenant pipeline.
- Each tenant pipeline has its own batch processor and exporter with tenant-specific headers.
- Unrecognized senders go to `traces/reject` — data is logged and dropped.
- Senders can project their SA token with an explicit audience via a `serviceAccountToken` volume (optional — if omitted, the token uses the cluster's default audience, typically `https://kubernetes.default.svc`). When set, the audience is a deployment choice:
  - **Collector-terminated:** Use a collector-specific audience (e.g., `otel-gateway`). The token is validated and consumed at the collector; identity is forwarded as derived attributes (e.g., `X-Scope-OrgID`). Suitable when backends trust the collector's identity assertions. This is the pattern shown in this Tempo example.
  - **Token passthrough:** The sender must use the **default-audience** token. Backends like MLflow present the forwarded token to kube-apiserver (SelfSubjectAccessReview), and the API server only accepts tokens carrying its own audience — a collector-specific or shared custom audience breaks the backend's validation. The collector's TokenReview must accept the default audience (which is its default). Required when backends (e.g., MLflow) need the sender's token for their own authorization.
- The collector's service account needs `create` on `tokenreviews` in `authentication.k8s.io` and, when the access check is used, on `subjectaccessreviews` in `authorization.k8s.io`. The built-in ClusterRole `system:auth-delegator` grants both.
- Receiver TLS (OpenShift only): every collector the operator creates gets a serving certificate secret named `<name>-collector-headless-tls`. On upstream Kubernetes nothing creates this secret and the user supplies certificates. Mounting it into the receiver's `tls:` settings works; only the headless service name matches the certificate (measured). The examples omit TLS for readability.

## RHOAI Use Case Mapping

The RHOAI use case (RHAIRFE-3630, RHAISTRAT-2925) wants identity-based OTel trace routing from MaaS (Model-as-a-Service) endpoints to MLflow experiments. MaaS is an RHOAI feature that provides hosted LLM inference endpoints on OpenShift — agents/applications send prompts and get completions back. The MaaS architecture consists of an Envoy gateway with Authorino/Kuadrant for authentication, a payload processor (`ai-gateway-payload-processing`, an Envoy ext-proc plugin handling request/response mutation), and the model serving backend (KServe). RHAISTRAT-2925 describes **two trace flows**:

**Flow 1 — MaaS-captured traces (RHAISTRAT-2925, not in OBSDA-1512 scope):** The MaaS payload processor (`ai-gateway-payload-processing`) captures LLM call traces (prompt, completion, latency, tokens) at the gateway layer without any agent instrumentation. The payload processor resolves routing via a `TraceRoutingRule` CRD that maps identity → workspace + experiment, stamps a `maas.trace.target_experiment` attribute on the span, and exports to the OTel Collector. RHAISTRAT-2925 proposes a **custom MLflow exporter** — an RHOAI-specific collector component (not an upstream OTel component) that uses the MLflow Go SDK (`opendatahub-io/mlflow-go`) to call the MLflow REST tracking API (e.g., `POST /api/2.0/mlflow/runs/create`, `/log-batch`). The exporter reads the `maas.trace.target_experiment` attribute to determine which experiment to write to, and passes workspace context via HTTP headers on the API calls. This component does not exist yet — it is part of the proposed RHAISTRAT-2925 design (auto-generated strategy, `New` status). An alternative that avoids building a custom exporter: use MLflow's native OTLP/HTTP endpoint (`/v1/traces`, requires v3.7.0+) with a standard `otlphttp` exporter and pass the experiment via the `x-mlflow-experiment-id` header. In this flow, Authorino/Kuadrant authenticates the caller at the MaaS API layer — the collector does not perform authentication. Receiver isolation (preventing direct access that bypasses the MaaS gateway) is an RHOAI deployment concern (network policy), not an OTel collector feature.

**Flow 2 — Agent-emitted traces (OBSDA-1512 scope):** Agents send their own OTel traces directly to the collector with their K8s SA token. The collector authenticates the sender, routes by identity to the correct pipeline, and forwards to MLflow with the original token. This flow is what OBSDA-1512 enables — the collector itself is the authenticator.

Both flows converge at the collector and use the same downstream path to MLflow. OBSDA-1512 provides the collector primitives for Flow 2 and the routing/forwarding infrastructure for both.

| RHOAI Need | Flow 1 (MaaS-captured) | Flow 2 (Agent-emitted, OBSDA-1512) |
|---|---|---|
| Identify caller | Authorino/Kuadrant at MaaS gateway | K8s SA token auth at the collector |
| Route to MLflow experiment | `maas.trace.target_experiment` attribute set by payload processor | Routing connector with identity-based OTTL conditions |
| Prevent cross-tenant writes | MaaS gateway authorization + MLflow SAR | Collector auth + MLflow SAR with forwarded token |
| Correlate agent ↔ MaaS traces | Identity stamped into resource attributes by the payload processor | Identity stamped into resource attributes by the collector from the verified SA token |

**MLflow authorization model:**

MLflow on RHOAI uses the [`mlflow-kubernetes-plugins`](https://github.com/HumairAK/mlflow-kubernetes-plugins) authorization plugin (`MLFLOW_K8S_AUTH_AUTHORIZATION_MODE=self_subject_access_review`). Every API request triggers a `SelfSubjectAccessReview` using the caller's bearer token, checking whether the token has permission on **pseudo-resources** in the `mlflow.kubeflow.org` API group. These pseudo-resources (`experiments`, `datasets`, `registeredmodels`, etc.) are not real CRDs — they exist only for RBAC policy evaluation.

Three built-in ClusterRoles:

| ClusterRole | Purpose | Verbs on `mlflow.kubeflow.org` pseudo-resources |
|---|---|---|
| `mlflow-operator-mlflow-view` | Read-only | `get`, `list` |
| `mlflow-operator-mlflow-edit` | Full write (human-facing) | `create`, `update`, `delete` + control-plane |
| `mlflow-operator-mlflow-integration` | Data-plane for service accounts | `get`, `list`, `create`, `update` (no `delete`) |

The **`mlflow-integration`** role is intended for the collector/agent use case. It supports `resourceName` granularity — a SA can be restricted to a specific experiment. Bound via a **RoleBinding** in the target workspace namespace.

Workspace = K8s namespace. The workspace provider maps MLflow workspaces to namespaces. The `X-MLFLOW-WORKSPACE` header selects the workspace on API calls.

**RHOAI-specific notes:**
- Authorization is **per service account**. MLflow performs a `SelfSubjectAccessReview` checking whether the SA has `create`/`update` on `experiments` in `mlflow.kubeflow.org` within the target namespace. "Namespace-level" isolation is an operational convention via RoleBindings, not a technical constraint — a SA could be granted cross-namespace access if needed.
- Each workspace contains multiple experiments; the experiment is targeted via the `x-mlflow-experiment-id` header (OTLP approach) or as an API parameter (custom exporter approach).
- The `TraceRoutingRule` CRD (RHAISTRAT-2925) is an RHOAI-specific abstraction, not a collector/operator feature. OBSDA-1512 provides the underlying collector primitives that such a CRD would configure.
- The `data-science-collector-mlflow-trace-export` ClusterRole mentioned in RHAISTRAT-2925 does not match any real role — the actual role is `mlflow-operator-mlflow-integration`.
- **Token passthrough (Flow 2 only):** MLflow needs the sender's original SA token to perform its own `SelfSubjectAccessReview`. The collector forwards the token via the headers setter extension's metadata passthrough (see "Identity Forwarding and Token Passthrough Example" above). MLflow presents the token to kube-apiserver, which only accepts tokens carrying the API server audience — so senders must use **default-audience** tokens and the collector must accept that audience (its default). A collector-specific audience breaks MLflow's validation.
- **Flow 2 needs a native authenticator.** A kube-rbac-proxy in front of the collector removes the `Authorization` header, so the token never reaches MLflow (measured). Only an auth extension inside the collector (`k8s_auth`, or OIDC with a key file as a fallback) keeps passthrough working.
- **Not yet run against MLflow.** Passthrough, the denial path and the mapping of MLflow's own access check to a `k8s_auth` access check must be validated with the RHOAI team.

## Components Needed in the Red Hat Distro

| Component | Currently in Distro? | Required For |
|---|---|---|
| Kubernetes Auth Extension `k8s_auth` (TokenReview + SAR) | **No — [PLANNED: TRACING-6994], TP in 3.13, built in a Red Hat repository (proposed: a Go module folder in `redhat-opentelemetry-collector`); not in contrib** | Sender authentication and authorization on OpenShift |
| OIDC Auth Extension | Yes (TP) | Sender authentication for JWT-bearing (non-K8s) senders; fallback for K8s SA tokens with a key file |
| Routing Connector | Yes (TP) | Identity-based routing and implicit authorization |
| Resource Processor | Yes (GA) | Stamping verified identity into attributes |
| Attributes Processor | Yes (GA) | Stamping verified identity into span/log/metric attributes |
| Headers Setter Extension | Yes (TP since 3.11) | Forwarding identity to backends |
| Transform Processor | Yes (GA) | Complex identity transformations |

**Action required:** Build the `k8s_auth` extension (see Planned Behavior), add it to the distro, document it, cover it with e2e tests, and propose it for `opentelemetry-collector-contrib`. Headers setter documentation is already in progress (TRACING-6505). The work breakdown is in the design document.

## Planned Behavior: `k8s_auth` Extension

[PLANNED: TRACING-6994] Every rule in this section is planned. Support level: Technology Preview in 3.13.

### Authentication

1. `k8s_auth` is a server-side authenticator for receivers. It reads the bearer token from the `authorization` header or gRPC metadata.
2. It validates the token with a TokenReview against the cluster's API server. It does not check the issuer and has no issuer setting.
3. `audiences` lists the audiences sent in the TokenReview. Empty (the default) means the API server's own audiences, which is what token passthrough needs.
4. A request with no token, an invalid token, a token for another audience, or a token whose pod or service account is gone is rejected.

### Identity

5. On success the extension sets `client.Info.Auth` with these attributes. All values are strings except `membership`, which is a list of strings.

   | Attribute | Value | Present |
   |---|---|---|
   | `subject` | User name, e.g. `system:serviceaccount:team-a:agent` | Always |
   | `membership` | Group names | Always |
   | `uid` | User UID | When the API server returns it |
   | `k8s.namespace.name` | Namespace of the service account | Service account tokens |
   | `k8s.serviceaccount.name` | Service account name | Service account tokens |
   | `k8s.pod.name`, `k8s.pod.uid`, `k8s.node.name` | Pod and node the token is bound to | Bound tokens, when the API server returns these details |
   | `authorized.namespace`, `authorized.name` | Destination approved by the access check | When the access check takes the value from a header |

6. The raw token is not exposed as an auth attribute. Token passthrough uses request metadata (`include_metadata: true` and the headers setter's `from_context: authorization`).

### Authorization

7. The `authorization` block is optional. Without it the extension only authenticates.
8. With it, the extension sends a SubjectAccessReview for the authenticated user with the configured resource attributes (API group, resource, verb, namespace, name) and rejects the request when the review denies it.
9. `namespace` and `name` are each either a fixed value or taken from one request header (`namespace_from_header`, `name_from_header`).
10. When a value is taken from a header, a request that carries that header more than once, or not at all, is rejected.
11. The approved header value is exposed as `authorized.namespace` or `authorized.name`. Pipelines route on these attributes. They set tenant headers from fixed values or by forwarding the checked header, never by forwarding an unchecked header.

### Failure behavior

12. The extension fails closed: a request that needs a new review is rejected if the API server cannot be reached or returns an error. A result that is already cached stays valid until its cache time ends (rule 17), also while the API server is unreachable.
13. Over gRPC the sender sees `Unauthenticated` (rule 4), `PermissionDenied` (rule 8), `InvalidArgument` (rule 10) or `Unavailable` (rule 12).
14. Over HTTP the sender sees status 401 in all four cases, because the collector's HTTP server sets 401 for every authentication error (read from code). A change in the upstream collector is needed to return 403, 400 and 503.
15. Error text returned to the sender is short and fixed. API server messages and other details go to the collector log only.

### Cache

16. TokenReview and SubjectAccessReview results are cached in memory, keyed by a SHA-256 hash of the token and, for access checks, the checked attributes.
17. Accepted and allowed results are reused for `ttl` (default 30 seconds); rejected and denied results for `failure_ttl` (default 10 seconds). The cache holds at most `max_entries` (default 10000).
18. `ttl` is the revocation window: a deleted pod or a removed RoleBinding takes effect within that time. The same bound applies to an API server outage: a token accepted before the outage keeps working for at most `ttl`.

### Observability and security

19. The extension emits a counter of results by outcome (accepted, unauthenticated, denied, limited, error), cache hit and miss counters, and a histogram of API call time.
20. It logs one line per rejection with the outcome, the user name when known and the client address.
21. A token never appears in a log line, a metric attribute or an error message.

### Permissions and packaging

22. The collector's service account needs `create` on `tokenreviews` and, when `authorization` is set, on `subjectaccessreviews`. For Technology Preview the user binds the built-in ClusterRole `system:auth-delegator`; the operator does not create this RBAC.
23. The extension is a Go module in a Red Hat repository (proposed: a folder in `redhat-opentelemetry-collector`), built into the product binary through `manifest.yaml`. It is not part of any upstream distribution, so it cannot be promoted to GA until `opentelemetry-collector-contrib` accepts it (see `what/collector.md`, Promotion from TP to GA).

### Platform support

24. The extension uses only core Kubernetes APIs (TokenReview and SubjectAccessReview) and runs on any conformant Kubernetes cluster, OpenShift included. It needs no OpenShift-specific API or resource.
25. Pod and node attributes are optional. When the API server does not return those details, authentication still succeeds and the attributes are absent.
26. Receiver TLS is configured outside the extension. On OpenShift the serving certificate secret that the operator requests can be used; on upstream Kubernetes the user supplies certificates, for example with cert-manager.
27. The extension is tested on upstream Kubernetes (kind) as well as on OpenShift.

### API call limits

28. The extension limits its TokenReview and SubjectAccessReview calls with a rate limit shared by all senders (default 50 per second, burst 100) and a timeout per review (default 5 seconds). The cache alone does not bound these calls: every token that is not cached, valid or not, costs a review.
29. When the rate limit is reached, a request that needs a new review is rejected at once and is not queued. The sender sees the same result as for an unreachable API server (rules 13 and 14). Requests whose result is cached are not affected.
30. Requests that arrive together with the same uncached token share one review.
31. A request without a token is rejected without an API call.

## Risks and Open Questions

### Risks

1. **The `k8s_auth` extension is new code that upstream has not accepted.** It does not exist yet. Contrib requires a new component to live outside contrib first, to have a sponsor who is an approver or maintainer from another company, and to have at least three code owners. Until contrib accepts it, the product carries the code and cannot promote it to GA. If it slips, the tested fallbacks are OIDC with a key file and the kube-rbac-proxy sidecar (Authentication Options A and C).

2. **The fallbacks are incomplete.** OIDC with a key file has no revocation and no access check, and needs a key sync mechanism. The kube-rbac-proxy sidecar cannot forward the sender's token. No tested option gives revocation, a visible access check and token passthrough together. For non-K8s senders (external services with JWT tokens), the OIDC extension works as-is.

3. **Context loss at batch processor boundary.** If the pipeline order is wrong (batch before identity stamping), auth context is silently lost (measured). The headers setter's `from_attribute` does not just lose the header when `Auth` is nil — it **crashes the collector** (measured with no authenticator on the receiver; read from code for the batch-merge case, which would be visible only under load). This is a configuration footgun that documentation must address clearly.

4. **No error signaling to senders.** When data is dropped due to routing (implicit authorization), the sender receives a success response (measured). The same happens when a backend rejects forwarded data behind a batch processor or a sending queue. This matches how many multi-tenant telemetry systems work but makes debugging harder.

5. **Routing connector and OIDC extension are both TP.** Building a supported multi-tenant capability on TP components has product implications. Promotion to GA should be evaluated.

6. **Token passthrough forwards API-capable credentials through the shared collector.** With passthrough, every sender's SA token — usable against the K8s API within the SA's RBAC permissions — transits the collector and is forwarded to the backend. A compromised collector, a compromised backend, or an eavesdropped connection can replay the token until it expires. Mitigations: TLS on the collector→backend hop (the examples show plain `http://` for readability only), short-lived bound SA tokens, and backend Roles scoped to the minimum verbs (e.g., `mlflow-operator-mlflow-integration`).

7. **The gateway depends on the API server.** With `k8s_auth`, every request with an uncached token costs one or two API calls, bounded by the extension's rate limit (rules 28 to 31), and an API server outage stops ingestion because the extension fails closed. gRPC senders retry on `Unavailable`; HTTP senders see 401 and drop data until the upstream HTTP status change lands.

8. **The collector version of 3.13 is not decided.** The distro builds unmodified upstream modules, so an upstream fix (headers setter nil check, HTTP status for authorization errors) helps 3.13 only if it is in the pinned version.

9. **Only OpenShift has been tested.** The planned extension uses nothing OpenShift-specific, but it has not run on upstream Kubernetes. Every measured statement in this file comes from an OpenShift cluster.

### Open Questions

1. **Will contrib accept `k8s_auth`, and who sponsors it?** Red Hat builds the extension in its own repository and proposes it upstream (decided, see Authentication Option B). The sponsor and the code owners are not found yet. Related upstream discussion: [#48895](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/48895).

2. **Should the operator generate multi-tenant config?** If this becomes a common pattern, operator-level support (generating the routing table, per-tenant pipelines and headers from a CRD) would reduce configuration burden significantly. Is there appetite for this API surface?

3. **What support level should identity-aware ingestion have?** The OIDC extension and routing connector are both TP today. Should this capability be GA, requiring promotion of both components?

4. **How does this interact with the signing spec (TRACING-6499)?** Signing provides non-repudiation — proof that telemetry was produced by a specific entity. Identity-aware ingestion provides sender authentication at the gateway. These are complementary: signing proves origin, auth proves the sender is allowed to submit. Should they share identity primitives?

5. **TokenReview caching strategy.** TokenReview is a synchronous per-request API call — unlike the K8s informer (List+Watch) pattern used by `k8sattributesprocessor` and `k8sclusterreceiver` for resource discovery. None of the existing collector auth extensions (OIDC, bearer token) cache token validation results — they validate every request. A TokenReview auth extension would be the first to need a per-request validation cache.

   The K8s ecosystem pattern is **passive TTL-based expiration with no active revocation** — no project implements push-based cache invalidation for TokenReview results:
   - **kube-rbac-proxy:** caches TokenReview results. The image in the 4.22 release payload has no flag to set the cache time (37 flags listed, none for it). A token the proxy had seen while the pod lived was still accepted seconds after the pod was deleted; the cache duration was not measured.
   - **kube-apiserver:** 2 min default for webhook token cache (`--authentication-token-webhook-cache-ttl`), 30s for unauthorized SAR results
   - **Asymmetric caching is standard:** cache positive (authenticated) results longer, negative (rejected) results briefly or not at all

   Revocation is handled by **bound SA tokens** — projected tokens are bound to the pod, so a TokenReview rejects the token once the pod is deleted. Measured: a token that the proxy had not seen before was rejected (401) three seconds after its pod was deleted. The token's own expiry does not help here: the default projected token expired one year after issue. This is the ecosystem's preferred revocation mechanism over explicit cache invalidation.

   **Decision for `k8s_auth`:** configurable TTL with defaults of 30 seconds for accepted and 10 seconds for rejected results, a bounded number of entries, and the SHA-256 hash of the token as the cache key (Planned Behavior rules 16 to 18). Still open: what is the expected request rate, and can the K8s API server handle the uncached share? Rules 28 to 31 cap that share; the default limits still need a load test.
