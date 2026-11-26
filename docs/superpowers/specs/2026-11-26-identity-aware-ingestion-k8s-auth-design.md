# Identity-Aware Ingestion: Kubernetes Auth Extension for 3.13

**Date:** 2026-11-26
**Epic:** [TRACING-6994](https://redhat.atlassian.net/browse/TRACING-6994); parent [OBSDA-1512](https://redhat.atlassian.net/browse/OBSDA-1512); related [RHAIRFE-3630](https://redhat.atlassian.net/browse/RHAIRFE-3630), [RHAISTRAT-2925](https://redhat.atlassian.net/browse/RHAISTRAT-2925)
**Status:** Proposed. Implementation has not started.
**Builds on:** `2026-11-12-identity-aware-ingestion-design.md` (research). Where the two differ, this document wins; the differences are listed in "What changed since the research design".
**Behavioral spec:** `.ai/spec/what/identity-aware-ingestion.md`

## Intent

A shared collector gateway must know who sends telemetry, decide what each sender may write to, and pass that verified identity on. Today the product has no component that verifies a Kubernetes service account token against the cluster and can also reject a sender with a visible error.

This design adds one new collector extension, `k8s_auth`, and the product work around it (build, operator, docs, tests, upstream), so that 3.13 ships identity-aware ingestion as Technology Preview.

The motivating user is the RHOAI agent platform: agents send traces with their service account token, and the gateway must route them to the right MLflow workspace and forward the token so MLflow can run its own access check.

## Goals

1. Verify a sender's Kubernetes token at the receiver with the TokenReview API, on every OpenShift variant, with no sidecar.
2. Optionally authorize the sender with a SubjectAccessReview, including a per-destination check, and reject with an error the sender sees.
3. Expose the verified identity to the pipeline so existing components can stamp, route and forward it.
4. Keep token passthrough to the backend working.
5. Make rejections visible to operators through logs and metrics, without exposing tokens.
6. Ship in the supported build for 3.13 as Technology Preview, documented and covered by e2e tests.
7. Start the donation to `opentelemetry-collector-contrib` early, so a later release can promote the extension to GA.
8. Run on upstream Kubernetes and on OpenShift with the same code and settings, using only core Kubernetes APIs.

## Non-goals

- GA in 3.13. The GA rules in `what/collector.md` need the component in an upstream distribution first.
- RHOAI Flow 1 (traces captured by the MaaS gateway). It is outside OBSDA-1512.
- A `TraceRoutingRule` CRD, a gateway plugin or a custom MLflow exporter. These belong to RHOAI (RHAISTRAT-2925).
- An operator API that generates multi-tenant routing config (upstream contrib issue 48895 discusses it).
- Client certificate (mTLS) sender authentication.
- Changing how batching handles `client.Info.Auth`.

## Anti-goals

The work fails, even if it runs, when any of these is true:

- The gateway trusts an identity or destination that the sender declared and nothing verified.
- A token appears in a log line, a metric label or an error returned to a sender.
- The gateway accepts a request it could not check: one that needs a new review while the API server is unreachable. Results already cached stay valid until their cache time ends (see Cache).
- The extension needs an OpenShift-only API or resource to work.
- The setup needs a cluster-wide security change, such as anonymous access to the token signing keys.
- The issuer or audience is hard-coded, so it breaks on STS or workload-identity clusters.

## Constraints

- **Schedule:** 3.13 is planned for February or March 2027 (OBSDA-1512 target date 2027-02-03).
- **Collector version:** the collector version that 3.13 ships is not decided (TRACING-6993 has no description). The extension must build against whatever `manifest.yaml` pins on the release branch.
- **No patch mechanism:** the distro builds unmodified upstream modules. An upstream fix helps 3.13 only if it is in the pinned version. Every upstream item below has a fallback.
- **Upstream donation rules** (contrib `docs/new-components.md`): the component must first live outside contrib as a Go module; the proposal needs a sponsor who is an approver or maintainer from another company, and at least three code owners.
- **Upstream AI policy:** issue, PR and comment text for `opentelemetry-collector` and `opentelemetry-collector-contrib` is written by a human.
- **Naming:** components must use `lower_snake_case` (core `docs/coding-guidelines.md`).
- **FIPS:** the distro builds with `GOFIPS140=certified` and checks crypto use with `make fips-check`.

## What was tested

One cluster test ran on 2026-11-26. Read every statement below with this scope:

- One OpenShift 4.22 nightly on GCP, default token issuer (`https://kubernetes.default.svc`).
- Collector images: upstream contrib 0.163.2 (the version line of the 3.12 build), upstream contrib 0.166.0 (latest release that day), and the released Red Hat image (0.158.0). The full set ran on 0.163.2 and again on 0.166.0 with the same results, with two exceptions: the keys-file reload (finding 3) ran on 0.163.2 only, and the discovery and `jwks_url` cases (findings 5 and 6) ran on 0.166.0 only. The released image ran the OIDC keys-file, routing and passthrough cases.
- Operator: a build of upstream 0.164.0 installed from the OpenShift bundle.
- Not tested: upstream (non-OpenShift) Kubernetes, STS and workload-identity clusters, hosted control planes, a real MLflow, signing key rotation by OpenShift, the external TokenReview extension, metrics at the detailed level.

Labels: **M** measured on the cluster, **R** read from code, **U** untested.

| # | Finding | Label |
|---|---|---|
| 1 | The OIDC extension with `public_keys_file` (the cluster JWKS in a ConfigMap) accepts service account tokens and returns 401 without a token. The default token audience was accepted with `audience: https://kubernetes.default.svc`. | M |
| 2 | OIDC identity is readable with OTTL: `otelcol.client.auth.attributes["subject"]`, `["claims.kubernetes.io"]["namespace"]`, `["serviceaccount"]["name"]`, `["pod"]["name"]`. The resource processor `from_context: auth.claims.kubernetes.io` sets nothing, because the claim is a map. | M |
| 3 | The keys file is reloaded without a restart: an unrelated key gave 401 after about 20 seconds, the right keys gave 200 again after about 60 seconds. An empty key set is refused and the old keys stay. Nothing keeps the ConfigMap in sync with the cluster. | M |
| 4 | OIDC discovery (`/.well-known/openid-configuration`) answers 200 to an anonymous pod. The key set (`/openid/v1/jwks`) answers 403 to anonymous and 200 with a service account token. | M |
| 5 | `issuer_ca_path` trusts only the first certificate of a bundle. The service account `ca.crt` held six, and the one that signs `kubernetes.default.svc` was the third. | M (R for the cause) |
| 6 | `jwks_url` (contrib 0.166.0 and later) works when a local `oc proxy --accept-paths='^/openid/v1/jwks$'` sidecar serves the key set on 127.0.0.1. | M |
| 7 | The OIDC route has no revocation. The token of a deleted pod was still accepted; its expiry was one year after issue. | M |
| 8 | kube-rbac-proxy as a sidecar (image from the release payload, `additionalContainers`, receiver bound to 127.0.0.1) gives 401 without a valid token, 403 with a reason when RBAC denies, 200 when allowed. It rejected the token of a deleted pod (401). | M |
| 9 | The sidecar overwrites sender-set `x-remote-user` and `x-remote-groups` headers. | M |
| 10 | The sidecar can check a destination namespace taken from a request header (`rewrites.byHttpHeader`). If any value of that header is forbidden, the request gets 403. | M |
| 11 | gRPC through the sidecar works with `--upstream-force-h2c`; a denied sender sees `PermissionDenied`. | M |
| 12 | The sidecar removes the `Authorization` header before the collector. None of its 37 flags keeps it. Token passthrough to a backend does not work behind it. | M |
| 13 | The sidecar logged nothing for 403 denials at default verbosity. | M |
| 14 | Token passthrough works on the native route: headers setter `from_context: authorization`, receiver `include_metadata: true`, batch processor `metadata_keys: [authorization]`. The backend received the same token. | M |
| 15 | When the backend rejects the forwarded token, a synchronous pipeline returns 403 to the sender. With a batch processor and the default queue the sender gets 200 and the data is dropped. The backend in this test was kube-rbac-proxy, not MLflow. | M |
| 16 | Identity stamped before the batch processor survives; stamped after it, the identity is empty. | M |
| 17 | A sender that passes authentication but matches no route gets 200. The data goes to `default_pipelines`. | M |
| 18 | Headers setter `from_attribute` with no server authenticator: with the default sending queue the sender gets 200 and the collector process then crashes (nil pointer in `internal/source/attribute.go`). With the queue disabled the request fails and the process survives. Seen on the 0.163.2 and 0.166.0 images. | M |
| 19 | The same crash after a batch merge, when an authenticator is configured. | R |
| 20 | Exporter-level batching (`sending_queue::batch::partition::metadata_keys`). | U |
| 21 | The OIDC extension logs one warning with the client address per failed authentication. Collector self-metrics at the default level have no auth failure metric. | M |
| 22 | Auth error text reaches the sender. One error included the API server's own message. | M |
| 23 | The operator's NetworkPolicy allowed the receiver ports only. Sidecar ports timed out until declared in `spec.ports`. The policy has no source restriction. The OpenShift bundle turns the `operand.networkpolicy` gate on; the product CSV was not checked. | M |
| 24 | Every collector got a `<name>-collector-headless-tls` serving certificate secret. Mounting it into the receiver `tls:` settings works. Only the headless service name matches the certificate. | M |
| 25 | Auth extensions that the operator has no parser for (`oidc`, `headers_setter`, `bearertokenauth`) run unchanged in an `OpenTelemetryCollector`. | M |
| 26 | Over HTTP every authentication error becomes status 401 (`confighttp`). Over gRPC the extension can choose the code. | R |
| 27 | `k8s.io/client-go` is already in the distro build (`_build/go.mod`). | R |
| 28 | A tenant header that the sidecar checked (finding 10) can be forwarded with headers setter `from_context` through one shared pipeline. With the header in the batch processor's `metadata_keys`, two tenants sending at the same time were batched apart and each batch reached the backend with its own tenant header. Run on 0.166.0. | M |

## What changed since the research design

| Research design (2026-11-12) | Now |
|---|---|
| "OIDC does not work for service account tokens on OpenShift", because discovery returns 401. | Discovery is anonymous. The real blockers are the single-certificate CA option and the 403 on the key set. With a keys file it works today (findings 1 to 6). It still has no revocation and no access check. |
| Senders must project a token with a custom audience for OIDC. | The default token works (finding 1). |
| kube-rbac-proxy sidecar is the interim solution. | It cannot forward the sender's token (finding 12), so it does not serve the RHOAI flow. It is kept as a tested fallback for backends that trust the gateway. |
| The sidecar's access check is coarse. | It can check a destination namespace from a header (finding 10). |
| The headers setter crash needs a batch merge. | It also happens with no authenticator at all (finding 18). |
| The extension starts from the external `k8ssaauthextension`. | The extension is written new in a Red Hat repository; the external author is invited as a co-owner for the donation. |

## Approaches

### What 3.13 delivers

1. **Tested patterns only.** Document the OIDC keys-file route and the sidecar, no new component. This was the recommendation before the release date was known. No tested pattern gives token passthrough together with revocation and a gateway access check.
2. **New TokenReview extension in 3.13.** One native component gives all three.
3. **Improve the OIDC extension only.** Fix the CA option and let it fetch keys with a token. Small upstream changes, but still no revocation and no access check.

**Picked: 2.** The release is in February or March, so there is time to build it. Approach 1 stays as the fallback if the extension slips, and the tested configs are in the appendix for that reason.

### Where the extension lives first

1. **Our own repository, then donate to contrib.** We control the schedule and can ship it in 3.13. We carry it until upstream accepts it.
2. **Join the existing external extension.** Less duplicate work and a second company behind the donation. Its repository has not changed since February 2026, it sets no identity on the request, its access check is mandatory, and the product would build from a personal repository.
3. **Add a TokenReview mode to an existing contrib extension.** No donation process, but it stretches a component built for something else and maintainers may refuse it. Not discussed with them.

**Picked: 1.** The external author is invited as a co-owner, which also helps the code-owner rule.

### Which repository

1. **A module folder in the distro repository** (`openshift/redhat-opentelemetry-collector`, folder `extension/k8sauthextension`), wired into the build with a `replaces` line, the same way OBI is wired today. No new repository, one PR can change the extension and the manifest together, and the build stays self-contained. The folder lives on each release branch, so it always matches that branch's collector version.
2. **A new dedicated repository.** A cleaner home for outside contributors and for the donation review, with its own versioning. It needs a new repository in the organization, its own CI, and a tagged release before the distro can pin it.

**Proposed: 1. The epic owner has not confirmed this.** The signing component already lives in `redhat-opentelemetry-collector` as a Go module (`what/signing.md`), though that component is not meant for upstream and this one is. The folder removes the repository and release steps from the 3.13 path. Either choice meets the contrib rule that the component first lives outside contrib as a Go module. Changing this later affects stories 1 and 6 in the work breakdown and nothing else.

## Design

### The `k8s_auth` extension

A server-side authenticator (`extensionauth.Server`) for receivers. Component type `k8s_auth`, Go package `k8sauthextension`. Stability starts at `development`; the product support level is Technology Preview.

#### Configuration

```yaml
extensions:
  k8s_auth:
    # How the extension reaches the API server. Default: the pod's service account.
    auth_type: serviceAccount
    # Audiences sent in the TokenReview. Empty means the API server's own audiences.
    audiences: []
    # Optional. Without this block the extension only authenticates.
    authorization:
      resource_attributes:
        group: telemetry.opentelemetry.io
        resource: traces
        verb: create
        namespace: ""                    # fixed value, or
        namespace_from_header: x-tenant  # taken from one request header
        name: ""
        name_from_header: ""
    cache:
      ttl: 30s           # how long an accepted token or an allowed check is reused
      failure_ttl: 10s   # how long a rejected token or a denied check is reused
      max_entries: 10000
    limits:
      reviews_per_second: 50   # new TokenReview and SubjectAccessReview calls, all senders together
      burst: 100
      review_timeout: 5s
```

Field names follow existing components (`auth_type` as in the Kubernetes receivers and processors, `audiences` and `resource_attributes` as in the external extension). The exact names are settled in the first implementation PR.

#### Authentication

1. Read the bearer token from the `authorization` header or gRPC metadata, matching the key without regard to case.
2. Send a TokenReview with the configured audiences.
3. If the API server says the token is not authenticated, reject.
4. Build the identity from the TokenReview status and attach it to the request as `client.Info.Auth`.

The issuer plays no part, so the same config works on clusters with an external issuer (expected; to be confirmed on STS and hosted control planes).

The extension calls two core Kubernetes APIs, TokenReview and SubjectAccessReview, and nothing OpenShift-specific. It is meant to run on any conformant Kubernetes cluster (see Kubernetes and OpenShift).

Token passthrough needs default-audience tokens, because the backend presents the token to the API server. Leaving `audiences` empty supports that.

#### Identity attributes

All values are strings, except `membership`, which is a list of strings. The resource processor supports only these two types (finding 2).

| Attribute | Value | Present |
|---|---|---|
| `subject` | User name, for example `system:serviceaccount:team-a:agent` | Always |
| `membership` | Group names | Always |
| `uid` | User UID | When the API server returns it |
| `k8s.namespace.name` | Namespace of the service account | Service account tokens |
| `k8s.serviceaccount.name` | Service account name | Service account tokens |
| `k8s.pod.name`, `k8s.pod.uid`, `k8s.node.name` | Pod and node the token is bound to | Bound tokens, when the API server returns these details |
| `authorized.namespace`, `authorized.name` | The destination that the access check approved | When `authorization` takes the value from a header |

`subject` and `membership` use the same names as the OIDC extension, so existing configs and docs carry over. The raw token is not exposed as an attribute; passthrough uses request metadata. Pod and node details are optional: when the API server does not return them, authentication still succeeds and those attributes are absent.

#### Authorization

When `authorization` is set, the extension sends a SubjectAccessReview for the authenticated user with the configured resource attributes.

- A fixed `namespace` or `name` answers "may this sender use this gateway".
- `namespace_from_header` or `name_from_header` answers "may this sender write to the destination it asked for". The sender names the destination; Kubernetes RBAC decides.
- A request that carries the configured header more than once, or not at all, is rejected. This removes any doubt about which value was checked (finding 10 showed why this matters).
- The approved value is exposed as `authorized.namespace` or `authorized.name`. Routing and forwarding use this attribute, or the same header, never an unchecked one.

Adding a sender is then a RoleBinding, not a collector config change. Adding a destination is also only a RoleBinding when the gateway forwards the checked header (the dynamic topology under Gateway configuration). With one pipeline per tenant it also needs a route.

The extension does not know the signal. A different access check per signal needs one extension instance per receiver, for example `k8s_auth/traces` and `k8s_auth/logs`.

#### What the sender sees

| Case | gRPC | HTTP today | HTTP after the core change |
|---|---|---|---|
| No token, bad token, wrong audience, deleted pod | `Unauthenticated` | 401 | 401 |
| Access check denies | `PermissionDenied` | 401 | 403 |
| Destination header missing or repeated | `InvalidArgument` | 401 | 400 |
| API server unreachable or errors | `Unavailable` | 401 | 503 |
| Review rate limit reached | `Unavailable` | 401 | 503 |

The extension fails closed: a request that needs a new review is rejected when the review cannot be made. Error text sent to the sender is short and fixed; details, including API server messages, go to the collector log only (finding 22).

Over HTTP the status is 401 for all cases until core lets an authenticator set it (finding 26). OTLP senders treat 401 as final, so during an API server outage HTTP senders drop data while gRPC senders retry. The docs recommend gRPC where this matters.

#### Cache

- Results are cached in memory, keyed by the SHA-256 of the token and, for access checks, the checked attributes.
- Accepted and allowed results live for `ttl`; rejected and denied results for `failure_ttl`.
- `ttl` is the revocation window: a deleted pod or a removed RoleBinding takes effect within that time. The default is 30 seconds.
- Cached results are also used while the API server is unreachable. A token or an access check that was accepted before the outage keeps working until its cache time ends, at most `ttl`. After that the request is rejected.
- The cache is bounded by `max_entries`.

#### API call limits

The cache only saves calls for tokens it has already seen. Every new token, valid or not, costs a TokenReview, so a sender can send many different invalid tokens and load the API server. The Kubernetes client's own default limit (5 calls per second, then it queues) is too low for a gateway and would let requests pile up. The extension therefore sets explicit limits on its own calls:

- A rate limit on new reviews, shared by all senders (`reviews_per_second`, `burst`). The defaults are 50 per second with a burst of 100.
- A timeout per review (`review_timeout`, default 5 seconds). The rate limit and the timeout together bound the number of reviews in flight.
- Requests that arrive together with the same uncached token share one review.
- When the rate limit is reached, a request that needs a new review is rejected at once and is not queued. The sender sees the same result as for an unreachable API server. Requests whose result is cached are not affected.
- A request without a token is rejected without an API call.

#### Telemetry and logging

- A counter of authentication results by outcome (accepted, unauthenticated, denied, limited, error), a counter of cache hits and misses, and a histogram of API call time. Names follow the collector's internal telemetry conventions and are defined with `mdatagen`.
- One log line per rejection with the outcome, the user name when known and the client address. Never the token.

#### Permissions

The collector's service account needs `create` on `tokenreviews` (`authentication.k8s.io`) and, when `authorization` is set, on `subjectaccessreviews` (`authorization.k8s.io`). The built-in ClusterRole `system:auth-delegator` grants both; the sidecar test used it.

#### Kubernetes and OpenShift

The extension must run on upstream Kubernetes and on OpenShift with the same code and the same settings.

Common to both:

- The two APIs it calls, and the built-in `system:auth-delegator` ClusterRole.
- The config. Nothing names an issuer or an audience.

Different per cluster, and handled outside the extension:

- **Receiver TLS.** On OpenShift the serving certificate secret that the operator requests can be mounted (finding 24). On upstream Kubernetes nothing creates that secret; the user supplies certificates, for example with cert-manager.
- **Token audience and issuer.** The defaults differ between distributions and cloud providers. Leaving `audiences` empty follows the cluster.
- **Pod and node details.** Which details the API server returns depends on the Kubernetes version, so they are optional.
- **Other token kinds.** A TokenReview accepts whatever the cluster's API server accepts. On OpenShift that includes user OAuth tokens. Tests use service account tokens.

Kubernetes versions: the extension is tested on the versions that contrib's e2e matrix uses (v1.34 and v1.35 on 2026-11-26) and on the OpenShift versions the product supports.

Everything measured so far ran on OpenShift. Upstream Kubernetes is covered by story 19.

### Build and productization

- The extension is added to `manifest.yaml` and built into the product binary. It is a folder in the distro repository, wired with a `replaces` line as OBI is.
- **The first story proves the build path with a stub extension**: `make build`, the vendored source archive used for the RPM (`make archive`), the image build (`Dockerfile.art`) and `make fips-check`. Only then does feature work start.
- The Kubernetes client is already a dependency (finding 27). `fips-check` still decides whether an allowlist entry is needed.
- Config schema files are generated with `make generate-schemas`, as for every component.
- The extension folder gets unit tests and a CI job. CI is configured only for the product branches today, so `main` needs its own config.
- ART builds are hermetic and prefetch Go modules from the paths listed in `ocp-build-data`. A local module was not tried in an ART build; OBI is built from a local path today, which suggests it works. Story 6 confirms it.
- When contrib accepts the component, the manifest switches to the contrib module and the folder is removed.

### Operator

- For Technology Preview the docs tell the user to bind `system:auth-delegator` to the collector's service account. No operator change is needed for the extension to run (finding 25).
- Automatic RBAC needs a small parser in the operator (the `k8s_observer` parser is the model), an `e2e-automatic-rbac` test and regenerated component docs. Whether upstream accepts a parser for a component that is not yet in contrib must be asked first. If not, this waits for the donation.
- With automatic RBAC, the operator's admission check rejects a collector resource when the user creating it does not hold the permissions the collector would get. The docs must say so.
- On OpenShift, receiver TLS uses the serving certificate secret the operator already requests (finding 24). On upstream Kubernetes that request has no effect and the user supplies certificates. Senders use the headless service name. Making the certificate also match the normal service name is a possible operator improvement, not required for 3.13.
- The generated NetworkPolicy does not limit senders (finding 23). With authentication at the receiver this is acceptable, and it is what lets operators relax network rules.

### Gateway configuration

The reference setup for the docs and the e2e tests:

```yaml
extensions:
  k8s_auth:
    authorization:
      resource_attributes:
        group: telemetry.opentelemetry.io
        resource: traces
        verb: create
        namespace_from_header: x-tenant
  headers_setter/team-a:
    headers:
      - {action: upsert, key: X-Scope-OrgID, value: team-a}
      - {action: upsert, key: Authorization, from_context: authorization}   # only for backends that check the token themselves

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317   # the receiver's default is localhost, which remote senders cannot reach
        include_metadata: true
        auth: {authenticator: k8s_auth}
        tls: {cert_file: /etc/serving/tls.crt, key_file: /etc/serving/tls.key}

processors:
  resource/identity:
    attributes:
      - {key: sender.subject, action: delete}
      - {key: sender.namespace, action: delete}
      - {key: sender.service_account, action: delete}
      - {key: sender.subject, action: insert, from_context: auth.subject}   # set for every authenticated sender
      - {key: sender.namespace, action: insert, from_context: auth.k8s.namespace.name}   # this and the next one: service account tokens only
      - {key: sender.service_account, action: insert, from_context: auth.k8s.serviceaccount.name}

connectors:
  routing:
    default_pipelines: [traces/unmatched]
    table:
      - condition: otelcol.client.auth.attributes["authorized.namespace"] == "team-a"
        pipelines: [traces/team-a]

exporters:
  otlp/team-a:
    endpoint: tempo-team-a:4317
    auth: {authenticator: headers_setter/team-a}
  debug/unmatched: {}

service:
  extensions: [k8s_auth, headers_setter/team-a]
  pipelines:
    traces/in: {receivers: [otlp], processors: [resource/identity], exporters: [routing]}
    traces/team-a: {receivers: [routing], exporters: [otlp/team-a]}
    traces/unmatched: {receivers: [routing], exporters: [debug/unmatched]}
```

The setup above is the **static topology**: one pipeline per tenant. A new tenant needs a RoleBinding and also a route, a pipeline, an exporter and a headers setter. A destination that RBAC approves but that has no route gets 200 and lands in the unmatched pipeline (finding 17), so routes and RBAC must be kept in step.

The **dynamic topology** uses one pipeline for all tenants. The gateway forwards the header that the extension checked, so a new tenant needs only a RoleBinding:

```yaml
extensions:
  k8s_auth:
    authorization:
      resource_attributes:
        group: telemetry.opentelemetry.io
        resource: traces
        verb: create
        namespace_from_header: x-scope-orgid
  headers_setter/tenant:
    headers:
      - {action: upsert, key: X-Scope-OrgID, from_context: x-scope-orgid}
```

This is safe only because the extension rejects a missing or repeated header and has checked the one value that remains. It uses `from_context`, not `from_attribute`, so it does not depend on the headers setter fix. With a batch processor the header must be listed in `metadata_keys`. This topology was run with the sidecar doing the check in place of the extension (finding 28).

Both topologies are documented and tested in 3.13. The dynamic one is the fit for RHOAI, where workspaces and experiments are many and change often.

Rules the docs must state, each backed by a finding:

1. Delete sender-set identity attributes before stamping, and stamp before any batching (16).
2. Route on verified attributes. Send everything else to a pipeline that does not reach a tenant backend (17).
3. Set tenant headers from fixed values, or forward the same header that the extension checked. Never forward an unchecked header.
4. Do not use headers setter `from_attribute` until the nil check fix is in the shipped version (18, 19).
5. For token passthrough, keep the pipeline synchronous if the sender must see the backend's denial; with a batch processor or a queue the sender gets 200 (15). With the batch processor, list `authorization` in `metadata_keys` (14).
6. Use TLS on the receiver and on the hop to the backend. Forwarded tokens can call the Kubernetes API.

### Upstream work

| Item | Repository | Why | If it is not in the 3.13 collector version |
|---|---|---|---|
| Propose `k8s_auth` as a new component: find a sponsor, name code owners, invite the external author | contrib | GA path | 3.13 ships it from our module as Technology Preview |
| Nil check in headers setter `from_attribute` | contrib | Finding 18 | Docs warn not to use `from_attribute` |
| Let a server authenticator set the HTTP status | core | Findings 26, sender-visible 403 and 503 | Docs describe 401 over HTTP and recommend gRPC |
| Read every certificate in `issuer_ca_path` (OIDC) | contrib | Finding 5 | No effect on `k8s_auth`; low priority |

Text for these issues and PRs is written by a person. Code and tests can be prepared in a local worktree.

### Documentation

- A new extension module, marked Technology Preview, with the config, the permissions and a verification step, plus a release note.
- A gateway procedure: authenticate, stamp, route, forward, receiver TLS, sender setup (a collector with `bearertokenauth` reading the token file), and the six rules above.
- The headers setter module (openshift-docs PR 124255) is a dependency.
- The OIDC keys-file route and the sidecar are not documented as product patterns while the extension is on track.

### Tests

New suite in `distributed-tracing-qe` under `tests/e2e-otel/`, based on the cases already run by hand:

- **Authentication:** valid token, no token, malformed token, wrong audience, token of a deleted pod (after the cache time).
- **Authorization:** allowed and denied sender, destination from header, missing and repeated header, denial visible over gRPC and HTTP.
- **Identity:** stamped attributes, sender-set attributes removed, identity lost when batching comes first.
- **Routing:** tenant isolation, unmatched sender.
- **Forwarding:** fixed tenant header, token passthrough, backend denial with a synchronous pipeline.
- **Transport:** receiver TLS, gRPC and HTTP, sender collector with `bearertokenauth`.
- **Signals:** traces first, then one metrics and one logs case.
- **Platforms:** one run on an STS cluster and one on a hosted control plane before the docs claim support there.
- **Upstream Kubernetes:** the authentication and authorization cases also run on kind, following contrib's e2e pattern (story 19).

The suite cannot use the upstream contrib image that the other tests pin, because the extension is not in it. It runs against an image built from the distro repository: the image that CI builds from `main` until the 3.13 product branch exists, then the ART build.

## OBSDA-1512 acceptance criteria

| # | Criterion | How it is met | Open part |
|---|---|---|---|
| 1 | Verify sender identity, including Kubernetes service accounts | TokenReview in `k8s_auth` | STS and hosted control plane run |
| 2 | Per-destination access, denial visible to sender and operators | SubjectAccessReview with destination from header; gRPC `PermissionDenied`; metrics and logs | HTTP shows 401 until the core change |
| 3 | Sender-supplied identity or routing claims are not trusted unless verified | Identity only from the TokenReview; destination only after the access check; delete-then-stamp | None |
| 4 | Verified identity is passed to the backend consistently | Stamped resource attributes, fixed or checked tenant headers, token passthrough | Real MLflow run (story 17; not a gate for the extension's Technology Preview) |
| 5 | Unauthenticated and unauthorized requests are rejected, and rejections are observable without exposing credentials | Fail closed; outcome metrics; logs without tokens; fixed error text | None |
| 6 | Operators can relax network restrictions without losing protection | Authentication and TLS at the receiver | Docs |
| 7 | Traces first, other signals covered or sequenced, in the supported build, documented | Receiver-level auth covers all signals; Technology Preview in 3.13 | Collector version of 3.13 |

## Work breakdown

Candidate stories. Jira issues are created from this list after approval.

**Extension**

1. Stub extension proven through binary build, RPM archive, image build and `fips-check`. Add a CI config for the distro `main` branch that builds the image and runs the extension's unit tests; today CI exists only for the product branches.
2. TokenReview authentication, audiences, identity attributes.
3. SubjectAccessReview with fixed and header-based destination, `authorized.*` attributes.
4. Result cache and API call limits.
5. Metrics, logs, error mapping and fixed sender-facing error text.
6. Config schema and README. When the 3.13 product branch and its ART group exist: confirm the hermetic ART build takes the local module, and add its path to the Go module list in `ocp-build-data` if the build needs it.

**Upstream**

7. Component proposal in contrib and donation follow-up.
8. Headers setter nil check.
9. HTTP status from a server authenticator in core.
10. OIDC CA bundle fix (low priority).

**Operator**

11. Ask upstream about a parser before donation; then parser, RBAC test and component docs, or defer.

**Documentation**

12. Extension module and release note.
13. Identity-aware gateway procedure, static and dynamic topology.

**Tests**

14. e2e: authentication and identity.
15. e2e: authorization, routing, forwarding, passthrough, for the static and the dynamic topology.
16. STS and hosted control plane run; metrics and logs cases.

**Alignment**

17. Run the gateway against a real MLflow with the team that owns RHAISTRAT-2925: passthrough, the workspace and experiment check, which resource attributes mirror MLflow's own check, and whether the agents send over gRPC or HTTP.

**Only if the checkpoint below fails**

18. Document and test the OIDC keys-file route and the sidecar as the 3.13 patterns.

**Upstream Kubernetes**

19. e2e tests for the extension on kind, following contrib's pattern. The story also decides where they run: the distro repository has no GitHub Actions workflow, and no OpenShift CI step uses kind.

Order:

- 1 first, then 2 to 5 in sequence, then 6.
- 8, 9 and 11 start at once. 10 has no deadline.
- 7 starts as soon as 2 is reviewable.
- 12 to 15 start when 3 is done; 16 follows 15.
- 19 starts when 2 is done, and must pass before the donation pull requests in 7.
- 17 starts at once with the OIDC keys-file gateway from the appendix, which works today, and is repeated with `k8s_auth` after 3. It does not hold up 3: the access check already takes namespace and name from two separate headers, which is the shape MLflow's own check needs.

Development happens on the distro `main` branch; the product branch is cut from it.

**Checkpoint.** When the 3.13 product branch is created, the epic owner checks whether stories 1 to 3 are merged. If not, the epic owner decides whether docs and tests switch to story 18.

Upstream issue, PR and comment text (stories 7 to 10) is written by the engineer who takes the story.

## Risks

1. **Upstream does not accept the component in time, or at all.** The product then carries the code and cannot promote it to GA. Start the proposal early and keep the design close to existing contrib patterns.
2. **API server load.** Every request with a token that is not in the cache costs one or two API calls. The cache only helps for repeated tokens; many different tokens, valid or not, each cost a review. The extension's rate limit bounds those calls, at the price of rejecting legitimate new tokens while a flood lasts. The default TTL trades load against the revocation window.
3. **API server outage stops ingestion.** Failing closed is deliberate. gRPC senders retry; HTTP senders see 401 until the core change.
4. **Forwarded tokens are powerful.** A passthrough token can call the Kubernetes API with the sender's rights. TLS on every hop and narrow RBAC for senders are required.
5. **The collector version of 3.13 is unknown**, so it is unknown which upstream fixes it contains.
6. **Technology Preview dependencies.** The routing connector and the headers setter are Technology Preview too.
7. **RHOAI fit is unproven.** MLflow was not part of the test; story 17 covers it.
8. **Only OpenShift has been tested.** The design uses nothing OpenShift-specific, but upstream Kubernetes is unproven until story 19.

## Open questions

1. **When is the 3.13 collector version fixed, and when are the product branch and its ART group created?** This date is the deadline for the upstream fixes (stories 8 and 9) to be in a released version, and the first moment the ART build can be checked (story 6).
2. **Do the RHOAI agents send OTLP over gRPC or HTTP?** Over HTTP every rejection is 401 and an API server outage drops data until the core change lands. If the agents use HTTP, story 9 is a must for that user, not a nice-to-have. Story 17 answers this.
3. **Who sponsors `k8s_auth` in contrib, and who are the other code owners?**
4. **Where do the kind e2e tests run?** The distro repository has no GitHub Actions workflow, and no OpenShift CI step uses kind.

## Decisions made while writing

These were not discussed with the epic owner and can be changed in review:

- Both gateway topologies, static and dynamic, are in scope for 3.13 docs and tests.
- The tested Kubernetes versions follow contrib's e2e matrix.
- Cached results stay valid during an API server outage, up to their cache time. The alternative, dropping the cache when the API server is unreachable, would turn a short outage into a full stop of ingestion.
- The MLflow run (story 17) does not hold up the extension and is not a gate for its Technology Preview. It is required before the docs describe an MLflow setup.
- The slip checkpoint is the creation of the 3.13 product branch, and the epic owner decides.
- Component type `k8s_auth` and package `k8sauthextension`.
- Identity attribute names, including `k8s.*` and `authorized.*`; no raw token attribute.
- A repeated or missing destination header is rejected.
- Cache defaults: 30 seconds, 10 seconds, 10 000 entries.
- API call limit defaults: 50 new reviews per second, burst 100, 5 seconds per review. A request over the limit is rejected, not queued.
- Manual RBAC for Technology Preview; automatic RBAC only once upstream takes the parser.
- The OIDC keys-file route and the sidecar are kept as fallbacks and are not documented as product patterns.
- Module folder in the distro repository rather than a new repository (see "Which repository"). "Our own repository" was picked; which one was not.

## Left to the builder

- Package layout, the cache implementation and the Kubernetes client setup.
- Exact config field names and metric names, within the conventions named above.
- Test harness details and the split of e2e cases into chainsaw tests.

## Appendix: configs that were run

These ran on the test cluster and are the fallback if the extension slips. Names are shortened; values are the ones used.

**OIDC keys-file gateway with token passthrough.** Run as shown on 0.163.2 and 0.166.0. The released image (0.158.0) ran it without the batch processor and with a routing connector between the receiver and the exporter. The ConfigMap `sa-jwks` holds the output of `oc get --raw /openid/v1/jwks`.

```yaml
extensions:
  oidc:
    providers:
      - issuer_url: https://kubernetes.default.svc
        audience: https://kubernetes.default.svc
        public_keys_file: /etc/jwks/jwks.json
  headers_setter/passthrough:
    headers:
      - {action: upsert, key: X-Scope-OrgID, value: static-tenant}
      - {action: upsert, key: Authorization, from_context: authorization}
receivers:
  otlp:
    protocols:
      http: {endpoint: "0.0.0.0:4318", auth: {authenticator: oidc}, include_metadata: true}
processors:
  transform/identity:
    error_mode: ignore
    trace_statements:
      - set(resource.attributes["verified.subject"], otelcol.client.auth.attributes["subject"])
      - set(resource.attributes["verified.namespace"], otelcol.client.auth.attributes["claims.kubernetes.io"]["namespace"])
      - set(resource.attributes["verified.sa"], otelcol.client.auth.attributes["claims.kubernetes.io"]["serviceaccount"]["name"])
  batch/keepauthz: {timeout: 1s, metadata_keys: [authorization]}
exporters:
  otlphttp/backend:
    endpoint: http://backend:4318
    auth: {authenticator: headers_setter/passthrough}
service:
  extensions: [oidc, headers_setter/passthrough]
  pipelines:
    traces: {receivers: [otlp], processors: [transform/identity, batch/keepauthz], exporters: [otlphttp/backend]}
```

This config sets `verified.*` with OTTL `set`, which overwrote sender-set values when the claim was present. A token without the Kubernetes claim was not tested; add `delete_key` statements first for that case.

**kube-rbac-proxy sidecar** (0.163.2, 0.166.0). The collector's service account is bound to `system:auth-delegator`. A Service with the serving certificate annotation provides `gw-tls`.

```yaml
apiVersion: opentelemetry.io/v1beta1
kind: OpenTelemetryCollector
metadata: {name: gw}
spec:
  mode: deployment
  ports:
    - {name: https, port: 8443, targetPort: 8443, protocol: TCP}   # also opens the port in the generated NetworkPolicy
  volumes:
    - {name: tls, secret: {secretName: gw-tls}}
    - {name: krp, configMap: {name: krp-config}}
  additionalContainers:
    - name: kube-rbac-proxy
      image: <kube-rbac-proxy image from the release payload>
      args:
        - --secure-listen-address=0.0.0.0:8443
        - --upstream=http://127.0.0.1:4318/
        - --auth-header-fields-enabled=true
        - --tls-cert-file=/etc/tls/private/tls.crt
        - --tls-private-key-file=/etc/tls/private/tls.key
        - --config-file=/etc/krp/config.yaml
      ports: [{containerPort: 8443, name: https}]
      volumeMounts: [{name: tls, mountPath: /etc/tls/private}, {name: krp, mountPath: /etc/krp}]
  config:
    receivers:
      otlp:
        protocols:
          http: {endpoint: "127.0.0.1:4318", include_metadata: true}
    processors:
      resource/identity:
        attributes:
          - {key: verified.user, action: delete}
          - {key: verified.user, action: upsert, from_context: metadata.x-remote-user}
    connectors:
      routing:
        default_pipelines: [traces/unmatched]
        table:
          - condition: otelcol.client.metadata["x-tenant"][0] == "team-a"
            pipelines: [traces/team-a]
    exporters:
      debug/team-a: {}
      debug/unmatched: {}
    service:
      pipelines:
        traces/in: {receivers: [otlp], processors: [resource/identity], exporters: [routing]}
        traces/team-a: {receivers: [routing], exporters: [debug/team-a]}
        traces/unmatched: {receivers: [routing], exporters: [debug/unmatched]}
```

`krp-config` for a destination check from a header:

```yaml
authorization:
  rewrites:
    byHttpHeader:
      name: x-tenant
  resourceAttributes:
    apiGroup: telemetry.ida.test
    resource: traces
    namespace: "{{ .Value }}"
```

The matching Role grants `create` on `traces` in that API group in each tenant namespace. gRPC needs a second sidecar with `--upstream=http://127.0.0.1:4317/` and `--upstream-force-h2c=true`.

**Sender collector** (0.163.2, 0.166.0). It ran with two exporters. `otlphttp` goes to the HTTP port of the kube-rbac-proxy sidecar shown above. `otlp` (gRPC) goes to a gRPC endpoint that the examples above do not show in full: the second, gRPC sidecar of the proxy gateway, or an OIDC gateway whose receiver also has `grpc` on 4317 with the serving certificate.

```yaml
extensions:
  bearertokenauth:
    filename: /var/run/secrets/kubernetes.io/serviceaccount/token
exporters:
  otlphttp/gateway:   # HTTP: the kube-rbac-proxy sidecar
    endpoint: https://<gateway service>:8443
    tls: {ca_file: /var/run/secrets/kubernetes.io/serviceaccount/service-ca.crt}
    auth: {authenticator: bearertokenauth}
  otlp/gateway:       # gRPC: the second sidecar, or an OIDC gateway with a gRPC receiver and TLS
    endpoint: <gateway service>:<gRPC port>
    tls: {ca_file: /var/run/secrets/kubernetes.io/serviceaccount/service-ca.crt}
    auth: {authenticator: bearertokenauth}
```

## References

- Behavioral spec: `.ai/spec/what/identity-aware-ingestion.md`
- Research design: `docs/superpowers/specs/2026-11-12-identity-aware-ingestion-design.md`
- GA promotion rules: `.ai/spec/what/collector.md` (Promotion from TP to GA)
- Contrib donation rules: `opentelemetry-collector-contrib/docs/new-components.md`
- External extension: [github.com/Jamstah/k8ssaauthextension](https://github.com/Jamstah/k8ssaauthextension)
- Upstream multi-tenant discussion: contrib issue 48895
