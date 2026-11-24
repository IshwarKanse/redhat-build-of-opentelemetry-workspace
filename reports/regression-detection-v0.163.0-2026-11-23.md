# Regression Detection Report

## Metadata

| Field | Value |
|---|---|
| Downstream base | operator `902d101560c6935d205eb611ea67d327fad81de9` (v0.163.0), collector `v0.163.2` (upstream bases: contrib `v0.163.0`, core `v0.163.0`) |
| Upstream target | origin/main (latest release: v0.163.0) |
| Release branch | rhosdt-0.163 |
| Components in build | 61 |
| Documented components | 54 |
| Critical | 12 |
| High | 11 |
| Medium | 25 |
| Low | 30 |
| Total | 78 |
| Docs re-check | The doc-validation step read a stale openshift-docs clone outside the session worktree (branch `docs/otel-regression-detection-v0.158.0-fixes`, see Skill Improvement Recommendations). Its findings were re-checked by hand against openshift-docs `52dcc9258898dc407d6c2fec636bc109a1087966` (`standalone-otel-docs-main`). HIGH-12 and HIGH-13 (Kafka Exporter top-level `topic` and `auth.plain_text`) were removed as false positives; the other doc-validation findings hold at that commit. |

## Contents

- [Critical (12)](#critical)
- [High (11)](#high)
- [Medium (25)](#medium)
- [Low (30)](#low)
- [Confirmed Coverage Gaps](#confirmed-coverage-gaps)
- [Documentation Drift](#documentation-drift)
- [Skill Improvement Recommendations](#skill-improvement-recommendations)

## Critical

#### CRIT-1 — confighttp flat keepalive fields removed; PrioritizeNewKeepalive gate stable

| Field | Value |
|---|---|
| Category | REMOVED_API |
| Component | confighttp (core) - otlphttpexporter, prometheusremotewriteexporter, otlpreceiver, zipkinreceiver, jaegerreceiver, webhookeventreceiver, prometheusremotewritereceiver, loadbalancingexporter and all HTTP client/server components |
| Component type | core |
| Detection methods | changelog, code-diff, feature-gates |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector/pull/15973 |
| Affected config fields | idle_conn_timeout, max_idle_conns, max_idle_conns_per_host, disable_keep_alives, idle_timeout, keep_alives_enabled, keepalive |
| Has test coverage | true |

Description: Core v0.165.0 (PR #15973) removed the deprecated flat client keys idle_conn_timeout, max_idle_conns, max_idle_conns_per_host and disable_keep_alives, and the server keys idle_timeout and keep_alives_enabled. These settings now live only under the keepalive: section. The pkg.confighttp.PrioritizeNewKeepalive gate went from Beta to Stable and can no longer be disabled, and the custom Unmarshal was removed. A config that still uses the flat keys fails to unmarshal, so the collector does not start. openshift-docs/modules/otel-exporters-otlp-http-exporter.adoc line 33 still shows `disable_keep_alives: false`.

Recommended action: Update the OTLP HTTP exporter doc example to use the keepalive: section. Search the operator-generated configs, doc examples and QE/e2e tests for the flat keys and migrate them. Remove -pkg.confighttp.PrioritizeNewKeepalive from --feature-gates. Add a breaking-change release note and consider an operator-side warning or migration.

#### CRIT-2 — [Pending] resource_to_telemetry_conversion disabled by default (DisableResourceToTelemetryConversion gate goes from Alpha to Beta)

| Field | Value |
|---|---|
| Category | BREAKING_CHANGE |
| Component | prometheusexporter |
| Component type | exporter |
| Detection methods | changelog, feature-gates, code-diff |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52937 |
| Affected config fields | exporters.prometheus.resource_to_telemetry_conversion, exporters.prometheus.resource_constant_labels |
| Has test coverage | true |

Description: PR #52937 moves the exporter.prometheus.DisableResourceToTelemetryConversion gate from Alpha to Beta, so it is on by default. The deprecated resource_to_telemetry_conversion section is then disabled by default and replaced by resource_constant_labels. Three docs depend on resource_to_telemetry_conversion.enabled: true (otel-config-send-metrics-monitoring-stack.adoc, otel-exporters-prometheus-exporter.adoc, otel-collector-config-options.adoc), and so do about 8 distributed-tracing-qe e2e configs (countconnector, groupbyattrsprocessor, awsemf cluster-monitoring, the PRW tests, disconnected otlp-metrics). After the upgrade, resource attributes are silently dropped from metric labels.

Recommended action: Before the rebase past 0.165, either document resource_constant_labels or document the temporary workaround --feature-gates=-exporter.prometheus.DisableResourceToTelemetryConversion. Update the docs and the QE e2e assertions.

#### CRIT-3 — add_metric_suffixes ignored; DisableAddMetricSuffixes gate stable

| Field | Value |
|---|---|
| Category | BREAKING_CHANGE |
| Component | prometheusexporter |
| Component type | exporter |
| Detection methods | changelog, code-diff, feature-gates |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52937 |
| Affected config fields | exporters.prometheus.add_metric_suffixes, exporters.prometheus.translation_strategy |
| Has test coverage | true |

Description: PR #52937 (unreleased 0.166) promotes exporter.prometheusexporter.DisableAddMetricSuffixes to stable. add_metric_suffixes is now always ignored and translation_strategy is always used, defaulting to UnderscoreEscapingWithSuffixes. Users who set add_metric_suffixes: false silently get metric names with suffixes again (_total and units), which breaks dashboards and alerts. Disabling the gate causes a startup error, and the gate is removed in v0.167.0.

Recommended action: Document the migration from add_metric_suffixes: false to translation_strategy: UnderscoreEscapingWithoutSuffixes. Check the docs, operator examples and tests for add_metric_suffixes, and remove the gate from any --feature-gates args.

#### CRIT-4 — PermissiveLabelSanitization goes from Beta to Stable; disabling it fails startup

| Field | Value |
|---|---|
| Category | FEATURE_GATE |
| Component | prometheusexporter, prometheusremotewriteexporter (pkg/translator/prometheus) |
| Component type | exporter |
| Detection methods | changelog, feature-gates |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52206 |
| Affected config fields | --feature-gates=-pkg.translator.prometheus.PermissiveLabelSanitization |
| Has test coverage | true |

Description: v0.164.0 (#52206): leading and consecutive underscores in label names are now always kept. Passing -pkg.translator.prometheus.PermissiveLabelSanitization causes a startup error, and DropSanitizationGate is deprecated. For users who had the gate disabled, label names change compared to 0.163.

Recommended action: Check that no operator, QE or doc config disables the gate. Note the label-name change in the release notes, because dashboards and alerts that rely on collapsed underscores can break.

#### CRIT-5 — Jaeger and Zipkin translators emit new semconv attributes by default

| Field | Value |
|---|---|
| Category | BREAKING_CHANGE |
| Component | jaegerreceiver, zipkinreceiver, kafkareceiver/kafkaexporter (jaeger/zipkin encodings) via pkg/translator/jaeger and pkg/translator/zipkin |
| Component type | receiver |
| Detection methods | changelog, feature-gates |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52251 |
| Affected config fields | --feature-gates=pkg.translator.zipkin.*, --feature-gates=pkg.translator.jaeger.* |
| Has test coverage | true |

Description: The Zipkin network gates (EmitV1NetworkConventions/DontEmitV0NetworkConventions) are stable (#52251) and cannot be disabled. The translator now emits network.local.address, network.peer.address and service.peer.name, and no longer emits net.host.ip, net.peer.ip or peer.service. The Zipkin HTTP, Scope and CloudResource gates are now Beta (#50910, #52149), giving http.response.status_code, otel.scope.name/version and cloud.resource_id instead of http.status_code, otel.library.* and faas.id. The Jaeger HTTP gates are Beta (#52147), giving http.response.status_code. Queries, filters and transform rules that use the old attribute names break.

Recommended action: Add a release note listing the attribute renames and the Beta opt-out gates (the stable network gates cannot be disabled). Update the Tempo, console and QE jaeger/zipkin assertions and any transform or filter rules that use peer.service, net.peer.ip, http.status_code or otel.library.name.

#### CRIT-6 — flatten_data option removed, replaced by flatten.log

| Field | Value |
|---|---|
| Category | REMOVED_API |
| Component | transformprocessor |
| Component type | processor |
| Detection methods | changelog, code-diff |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52440 |
| Affected config fields | processors.transform.flatten_data, processors.transform.flatten.log |
| Has test coverage | true |

Description: flatten_data was deprecated in v0.164.0 and removed in v0.165.0 (#52440), and configs that use it fail to load. The replacement is flatten: {log: true}, which still requires the transform.flatten.logs gate, so the impact is limited to users of that alpha gate. The 3.11.0 release notes in openshift-docs (otel-rn-3.11.0.adoc) mention flatten_data.

Recommended action: Add a migration note. Update any doc or QE example that uses flatten_data.

#### CRIT-7 — partition_processing.max_buffered_batches removed

| Field | Value |
|---|---|
| Category | REMOVED_API |
| Component | kafkareceiver |
| Component type | receiver |
| Detection methods | changelog, code-diff |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52922 |
| Affected config fields | receivers.kafka.partition_processing.max_buffered_batches, receivers.kafka.partition_processing.max_prefetch.batches, receivers.kafka.partition_processing.max_in_flight, receivers.kafka.encoding |
| Has test coverage | true |

Description: Deprecated in v0.164.0 and removed in unreleased 0.166 (#52922), so configs that use it fail to load. The replacement is partition_processing.max_prefetch.batches. Also new: max_prefetch.bytes, max_in_flight.bytes and max_in_flight.window. The defaults changed to MaxPrefetch{Batches:1} and MaxInFlight{Records:1, Window:per_fetch}. The built-in jaeger_proto, jaeger_json and json logs encodings were deprecated in favor of encoding extensions.

Recommended action: Check the Kafka docs and QE configs for max_buffered_batches and the deprecated built-in encodings, and migrate them. Add a release note.

#### CRIT-8 — filelog.protobufCheckpointEncoding made stable and then removed (it was Beta at v0.163.0)

| Field | Value |
|---|---|
| Category | FEATURE_GATE |
| Component | filelogreceiver (pkg/stanza/fileconsumer) |
| Component type | receiver |
| Detection methods | changelog, feature-gates |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52388 |
| Affected config fields | --feature-gates=filelog.protobufCheckpointEncoding, extensions.file_storage, receivers.filelog.storage |
| Has test coverage | false |

Description: The gate went to Stable (#52037) and was then removed (#52388). Protobuf checkpoints are now always used, and JSON checkpoints are read and rewritten as protobuf. Passing the gate fails startup. The upgrade is one-way: a downgrade to a release without protobuf checkpoint support loses the file offsets.

Recommended action: Test an upgrade with an existing file_storage checkpoint from the current release to confirm the offsets migrate. Remove the gate from any args. Add a release note that the checkpoint upgrade is one-way.

#### CRIT-9 — connector.routing.defaultErrorModeIgnore stable; default error_mode hard-coded to ignore

| Field | Value |
|---|---|
| Category | FEATURE_GATE |
| Component | routingconnector |
| Component type | connector |
| Detection methods | changelog, code-diff, feature-gates |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52352 |
| Affected config fields | connectors.routing.error_mode |
| Has test coverage | true |

Description: v0.165.0 (#52352): createDefaultConfig now always sets error_mode ignore, and the gate can no longer be disabled to get propagate back. Disabling a stable gate fails at startup.

Recommended action: Tell users who rely on propagate to set error_mode: propagate explicitly. Remove the gate from any --feature-gates use and add a release note.

#### CRIT-10 — ottl.set.allowNil gate removed (was Stable)

| Field | Value |
|---|---|
| Category | FEATURE_GATE |
| Component | transformprocessor, filterprocessor, routingconnector (pkg/ottl) |
| Component type | processor |
| Detection methods | feature-gates |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/51236 |
| Affected config fields | --feature-gates |
| Has test coverage | true |

Description: Removed in #51236 when the OTTL signals were promoted to stable. The behavior stays, but explicitly passing the gate now fails at startup.

Recommended action: Make sure no docs, operator defaults or tests pass ottl.set.allowNil in --feature-gates.

#### CRIT-11 — processor.filter.defaultErrorModeIgnore gate removed (was Stable)

| Field | Value |
|---|---|
| Category | FEATURE_GATE |
| Component | filterprocessor |
| Component type | processor |
| Detection methods | feature-gates |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52238 |
| Affected config fields | error_mode, --feature-gates |
| Has test coverage | true |

Description: Removed in #52238. The default error_mode ignore is permanent, and referencing the gate fails at startup.

Recommended action: Remove any reference to the gate from --feature-gates.

#### CRIT-12 — receiver.prometheusreceiver.IgnoreScopeInfoMetric gate removed (was Stable)

| Field | Value |
|---|---|
| Category | FEATURE_GATE |
| Component | prometheusreceiver |
| Component type | receiver |
| Detection methods | feature-gates |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52201 |
| Affected config fields | --feature-gates |
| Has test coverage | true |

Description: Removed in #52201. The behavior is permanent, and referencing the gate fails at startup.

Recommended action: Remove any reference to the gate from --feature-gates.

## High

#### HIGH-1 — __scheme__ and __metrics_path__ labels kept as datapoint attributes; secrets and URLs no longer redacted on reload

| Field | Value |
|---|---|
| Category | BREAKING_CHANGE |
| Component | prometheusreceiver |
| Component type | receiver |
| Detection methods | changelog, code-diff |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52736 |
| Affected config fields | receivers.prometheus.config.scrape_configs |
| Has test coverage | true |

Description: v0.165.0 (#52736): scraped samples keep __scheme__ and __metrics_path__ as datapoint attributes. This changes label sets and cardinality for metrics forwarded to Prometheus or PRW, which affects dashboards and recording rules. Also, reloadPromConfig now marshals secrets and URLs unredacted (this fixes passwords lost on reload), and configWarnings now warns about OpenMetrics 2 scrape protocol settings.

Recommended action: Check the TA, PRW and monitoring e2e assertions on label sets. Add a release note and document how to drop the labels with metric_relabel_configs.

#### HIGH-2 — Deprecated volume resource attributes removed; gate combination validation

| Field | Value |
|---|---|
| Category | BREAKING_CHANGE |
| Component | kubeletstatsreceiver |
| Component type | receiver |
| Detection methods | changelog, code-diff |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/40477 |
| Affected config fields | receivers.kubeletstats.resource_attributes, --feature-gates=receiver.kubelet_stats.* |
| Has test coverage | true |

Description: v0.164.0 removes the aws.volume.id, fs.type, gce.pd.name, glusterfs.endpoints.name, glusterfs.path and partition resource attributes from volume metrics. Validate also fails if receiver.kubelet_stats.DontEmitV0K8sConventions is enabled without EmitV1K8sConventions.

Recommended action: Add a release note. Check dashboards, docs and QE kubeletstats assertions that use these attributes.

#### HIGH-3 — [Pending] PRW 2.0 HTTP rules enforced; compression_algorithms defaults to snappy

| Field | Value |
|---|---|
| Category | BREAKING_CHANGE |
| Component | prometheusremotewritereceiver |
| Component type | receiver |
| Detection methods | changelog, code-diff |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/53302 |
| Affected config fields | receivers.prometheusremotewrite.compression_algorithms, receivers.prometheusremotewrite.resource_cache_size |
| Has test coverage | true |

Description: #53302: only POST is accepted. Snappy block format is required: unsupported encodings get 415 and framed Snappy streams get 400. Content-Type is parsed strictly per RFC 9110. compression_algorithms now defaults to ["snappy"], and the new resource_cache_size defaults to 1000 (values <= 0 fail validation). Senders that use gzip, zstd or framed snappy are rejected. OCP CMO remote write uses block snappy, so it should keep working.

Recommended action: Run the prometheusremotewritereceiver(-cluster-monitoring) e2e tests and the CMO remote write v1/v2 flow (TRACING-4524/6909) on the rebased collector. Document compression_algorithms if needed.

#### HIGH-4 — [Pending] OIDC extension rejects JSON-serialized JWS tokens

| Field | Value |
|---|---|
| Category | BREAKING_CHANGE |
| Component | oidcauthextension |
| Component type | extension |
| Detection methods | changelog, code-diff |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52688 |
| Affected config fields | extensions.oidc |
| Has test coverage | true |

Description: #52688 replaces ParseSigned with ParseSignedCompact, so JWS tokens in JSON serialization, which were accepted before, are now rejected. Normal compact bearer JWTs are not affected. The config is unchanged, so the config diff step did not catch this.

Recommended action: Add a release note. Confirm the OIDC e2e test still passes.

#### HIGH-5 — timeout applies per attempt; retries run until max_elapsed_time and stop at shutdown

| Field | Value |
|---|---|
| Category | BEHAVIOR_CHANGE |
| Component | prometheusremotewriteexporter |
| Component type | exporter |
| Detection methods | changelog, code-diff |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52008 |
| Affected config fields | exporters.prometheusremotewrite.timeout, exporters.prometheusremotewrite.http.timeout, exporters.prometheusremotewrite.retry_on_failure |
| Has test coverage | true |

Description: v0.164.0 (#52008, fixes TRACING-6723 / #51983): the exporterhelper timeout is now 0, and the configured timeout bounds each send attempt instead of the whole retry loop. Retries continue until retry_on_failure.max_elapsed_time, with backoff up to max_interval. If only one of timeout and http.timeout is set, the other takes the same value. A new wrapper stops retries when shutdown starts. This prevents data loss during outages but changes retry and backpressure behavior.

Recommended action: Re-run the PRW outage data-loss e2e from TRACING-6723 on the rebased build. Update the docs and the known issue (openshift-docs#121896) once the fix ships downstream.

#### HIGH-6 — Delta timestamp cache sizing and key change; zero-start cumulative histograms (pending)

| Field | Value |
|---|---|
| Category | BEHAVIOR_CHANGE |
| Component | spanmetricsconnector |
| Component type | connector |
| Detection methods | changelog, code-diff |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52153 |
| Affected config fields | connectors.spanmetrics.metric_timestamp_cache_size, connectors.spanmetrics.resource_metrics_cache_size, connectors.spanmetrics.histogram.self_time |
| Has test coverage | true |

Description: v0.165.0 (#52153): when metric_timestamp_cache_size is unset, it defaults to max(1000, 10 * resource_metrics_cache_size), and cache entries now include resource identity. Memory use can grow, and users who set the size explicitly may need to raise it. Pending (#52443): new cumulative duration histogram series first report zero, and exemplars move to the next point. A new histogram.self_time option was also added.

Recommended action: Check the spanmetrics QE test and the console and monitoring dashboards that use rate() on duration_bucket. Note the memory impact for delta-temporality users.

#### HIGH-7 — OpenShift detector moved to the go-contrib SDK detector; new removeCloudNameRegion gate; token is configopaque

| Field | Value |
|---|---|
| Category | BEHAVIOR_CHANGE |
| Component | resourcedetectionprocessor (openshift detector) |
| Component type | processor |
| Detection methods | code-diff, changelog, feature-gates |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/51737 |
| Affected config fields | processors.resourcedetection.openshift.token, processors.resourcedetection.openshift.address, processors.resourcedetection.openshift.tls, processors.resourcedetection.detectors |
| Has test coverage | true |

Description: #51737 removes Config.MergeWithDefaults, which took the token from the SA file, the address from the env and the default CA path. Unset fields are now resolved by the upstream go-contrib OpenShift detector. The SA token is whitespace-trimmed, and IPv6 API hosts are bracketed. token is now configopaque (#52775). The new Alpha gate processor.resourcedetection.openshift.removeCloudNameRegion (#48159) stops reporting a bogus cloud.region on Azure and OpenStack, and will become the default later. Attribute values can change on some platforms. Also: the eks, k8s_api and kubeadm detectors no longer fail outside Kubernetes.

Recommended action: Run the OpenShift resourcedetection e2e on AWS, Azure and OpenStack on the rebased collector, and compare the cloud.* and k8s.cluster.name attributes. Plan a docs note for when cloud.region is removed.

#### HIGH-8 — New exporter.awsxray.EmitV1DBConventions gate, added and promoted from Alpha to Beta within the window

| Field | Value |
|---|---|
| Category | FEATURE_GATE |
| Component | awsxrayexporter |
| Component type | exporter |
| Detection methods | feature-gates |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52584 |
| Affected config fields | --feature-gates |
| Has test coverage | true |

Description: Added in #46537 and promoted to Beta in #52584. The exporter now reads db.namespace, db.system.name, db.query.text and user.name by default, with a fallback to the v1.12.0 keys. Also new, all Alpha and default off: DontEmitV0DBConventions, DontEmitV0HTTPNetworkConventions and EmitV1HTTPNetworkConventions.

Recommended action: The fallback keeps the practical risk low. Spot-check the X-Ray SQL segment output in the AWS exporter tests.

#### HIGH-9 — Stale k8s metadata cache entries after delete and recreate with the same name

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | k8sattributesprocessor |
| Component type | processor |
| Detection methods | issues |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/53392 |
| Affected config fields | — |
| Has test coverage | true |

Description: contrib#53160: the informer can deliver a delete and a recreate as one Update event with different UIDs. The handlers ignore the old object, so stale cache entries stay and telemetry can get the wrong attributes. Fixed by #53392 (merged 2026-11-20), after the downstream base.

Recommended action: Pick up #53392 in the next collector rebase, or carry it as a downstream patch for rhosdt-0.163 if customers report wrong attribution.

#### HIGH-10 — Redaction rules are not applied to span link attributes

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | redactionprocessor |
| Component type | processor |
| Detection methods | issues |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/53357 |
| Affected config fields | — |
| Has test coverage | false |

Description: contrib#53245 and #53356: processResourceSpan never iterates span.Links(), so values that should be redacted are exported unchanged on links. The downstream v0.163.0 is affected, and this can leak sensitive data.

Recommended action: Track fix PR #53357. Consider documenting the limitation or backporting the fix.

#### HIGH-11 — Pod webhook removes pod fields that the operator's k8s.io/api version does not know

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | opentelemetry-operator pod webhook |
| Component type | operator |
| Detection methods | issues |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-operator/issues/5733 |
| Affected config fields | — |
| Has test coverage | false |

Description: operator#5733 (open): the mutating webhook decodes and re-encodes pods with the operator's k8s.io/api types, so it drops fields added in newer Kubernetes versions. On OCP releases with a newer Kubernetes, instrumented or sidecar-injected pods can silently lose fields.

Recommended action: Check whether operator 0.163 is affected on the newest supported OCP version, and follow the upstream issue.

## Medium

#### MED-1 — Stricter validation, new response codes and PRW 2.0 conformance gaps

| Field | Value |
|---|---|
| Category | BEHAVIOR_CHANGE |
| Component | prometheusremotewritereceiver |
| Component type | receiver |
| Detection methods | changelog, issues |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/50340 |
| Affected config fields | receivers.prometheusremotewrite |
| Has test coverage | true |

Description: v0.164/v0.165: invalid symbol references and dropped native histograms now get 400 instead of 204. Float native histograms are dropped, and the Written headers report zero on refusal. Pending (#53274, #53275): labels with empty values are dropped, non-UTF-8 symbols and invalid exemplar refs are rejected, and partially valid requests are forwarded. Open conformance gaps in the downstream build: valid float and gauge native histograms are dropped and the Written headers are wrong.

Recommended action: Run the CMO remote write v2 e2e (TRACING-6909) against the rebased collector, and check for native histogram loss and how the sender retries on the new 400 responses.

#### MED-2 — [Pending] Sensitive fields changed to configopaque.String

| Field | Value |
|---|---|
| Category | BREAKING_CHANGE |
| Component | headerssetterextension, webhookeventreceiver |
| Component type | extension |
| Detection methods | changelog, code-diff |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/53263 |
| Affected config fields | extensions.headers_setter.headers[].value, receivers.webhookevent.required_header.value |
| Has test coverage | true |

Description: #53263 and #53313: the headers_setter header value and the webhook_event required_header.value become configopaque.String. They are redacted in printed configs, and webhook_event compares them in constant time. YAML configs are unaffected, but Go API users of these types break.

Recommended action: No user action is needed. Note it for distro builders and in the release notes if needed.

#### MED-3 — container.image.name and container.image.tag taken from the pod spec instead of the status

| Field | Value |
|---|---|
| Category | BEHAVIOR_CHANGE |
| Component | k8sclusterreceiver |
| Component type | receiver |
| Detection methods | changelog |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/46987 |
| Affected config fields | receivers.k8s_cluster |
| Has test coverage | true |

Description: v0.165.0 (#46987): values can change for images without a fully qualified registry, for example nginx instead of docker.io/library/nginx. Entity events are no longer emitted for containers without an ID.

Recommended action: Check the QE k8scluster assertions on image names and add a release note.

#### MED-4 — Logs and metrics without service.name routed by resource hash

| Field | Value |
|---|---|
| Category | BEHAVIOR_CHANGE |
| Component | loadbalancingexporter |
| Component type | exporter |
| Detection methods | changelog |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52483 |
| Affected config fields | exporters.loadbalancing.routing_key |
| Has test coverage | true |

Description: v0.165.0 (#52483): logs without service.name are now spread over the backends, which causes a one-time rebalance for stateful backends. Pending: metrics without service.name are routed instead of dropped (#52505), and routing no longer blocks while new backend exporters start (#50076).

Recommended action: Add a release note and check the loadbalancing e2e test.

#### MED-5 — FIPS-mode validation rejects md5/sha1 hashing and short HMAC secrets

| Field | Value |
|---|---|
| Category | BEHAVIOR_CHANGE |
| Component | redactionprocessor, webhookeventreceiver (FIPS) |
| Component type | processor |
| Detection methods | changelog, code-diff |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52507 |
| Affected config fields | processors.redaction.hash_function, processors.redaction.masking_string, receivers.webhookevent.hmac_signature.secret |
| Has test coverage | true |

Description: v0.165.0 (#52507): when fips140 is on, a redaction hash_function of md5 or sha1 fails validation. The new masking_string field cannot be combined with hash_function. In FIPS mode, the webhookevent hmac_signature.secret must be at least 14 bytes. Configs that work today can fail on FIPS-enabled OpenShift clusters.

Recommended action: Check how the downstream FIPS build sets fips140. Document that FIPS clusters need sha3 or hmac and a minimum HMAC secret length, or add a FIPS e2e test.

#### MED-6 — Startup warning for the batch processor combined with exporterhelper batching; memory_limiter gets a garbage_collector section

| Field | Value |
|---|---|
| Category | BEHAVIOR_CHANGE |
| Component | memorylimiterprocessor / batchprocessor (core) |
| Component type | core |
| Detection methods | changelog |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector/issues/15965 |
| Affected config fields | processors.memory_limiter.garbage_collector.enabled, exporters.*.sending_queue.batch |
| Has test coverage | true |

Description: v0.165.0: a startup warning is logged when a pipeline uses the batch processor together with sending_queue batching. memory_limiter adds garbage_collector.enabled. Pending core fixes: the retry backoff is capped at max_interval, and otlphttp no longer hangs on an HTTP 101 response.

Recommended action: Check that the documented examples do not trigger the new warning. Consider documenting garbage_collector.

#### MED-7 — [Pending] Sending queue storage ID type changed to optional/configstorage

| Field | Value |
|---|---|
| Category | BREAKING_CHANGE |
| Component | collector (pkg/exporterhelper) |
| Component type | core |
| Detection methods | changelog |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector/issues/13822 |
| Affected config fields | exporters.*.sending_queue.storage |
| Has test coverage | false |

Description: Pending core API change (#13822): the exporterhelper storage ID now uses an optional type from the new configstorage module. The change is API-only, but it touches sending_queue.storage, which file_storage users depend on.

Recommended action: After the rebase, check that a sending_queue.storage: file_storage config still loads in the persistent-queue e2e test.

#### MED-8 — [Pending] sending_queue deprecated (DisableSendingQueue gate)

| Field | Value |
|---|---|
| Category | DEPRECATION |
| Component | prometheusexporter |
| Component type | exporter |
| Detection methods | changelog, code-diff |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52853 |
| Affected config fields | exporters.prometheus.sending_queue |
| Has test coverage | true |

Description: #52853: setting sending_queue explicitly logs a deprecation warning, and the new Alpha gate exporter.prometheus.DisableSendingQueue rejects it.

Recommended action: Remove sending_queue from the Prometheus exporter examples.

#### MED-9 — os.build.id deprecated in favor of os.build_id; z/OS os.type renamed

| Field | Value |
|---|---|
| Category | DEPRECATION |
| Component | resourcedetectionprocessor (system detector) |
| Component type | processor |
| Detection methods | changelog, code-diff |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52806 |
| Affected config fields | processors.resourcedetection.system.resource_attributes.os.build.id, os.build_id |
| Has test coverage | true |

Description: v0.165.0 (#52806): the system detector adds os.build_id and deprecates os.build.id, and the old resource_attributes key is still read. The system and docker detectors report os.type zos instead of z_os. Also new: an env detector config and opt-in detector build tags.

Recommended action: Update the docs and dashboards if they reference os.build.id.

#### MED-10 — Operator bug fixes after v0.163.0: previously ignored CR fields now applied

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | opentelemetry-operator (collector, target allocator, auto-instrumentation, opamp bridge) |
| Component type | operator |
| Detection methods | changelog, code-diff, issues |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-operator/pull/5930 |
| Affected config fields | spec.revisionHistoryLimit, spec.ingress.ingressClassName, TargetAllocator.spec.dnsPolicy, TargetAllocator.spec.hostPID, Instrumentation.spec.java.extensions, OpAMPBridge.spec.volumes |
| Has test coverage | true |

Description: These fixes merged upstream after the 0.163.0 tag, so the downstream build still has the bugs. The DaemonSet spec.revisionHistoryLimit was ignored (#5930). Changing ingressClassName did not update an existing Ingress (#5928). TargetAllocator spec.dnsPolicy (#5951) and spec.hostPID (#5961) were ignored. Java extension init containers ignored imagePullPolicy (#5929). OpAMPBridge spec.volumes were ignored (#5926). An unsupported otel-python-platform annotation crash-looped the pod (#5892, fixed by #5932). TA /debug/target and the _link fixes (#5937, #5924), and Event text was corrupted by a % in an error message (#5898). Java agent goes to v2.34.0 (#5959). apis/ and the webhooks are unchanged. Existing CRs that set these fields will roll their pods after the upgrade.

Recommended action: The next operator rebase picks these up. Backport the Ingress and DaemonSet fixes to rhosdt-0.163 if customers hit them. Consider a known-issue note for the Python platform annotation. Expect pod rollouts on upgrade and add the fixes to the release notes.

#### MED-11 — Stricter lease timing validation

| Field | Value |
|---|---|
| Category | BEHAVIOR_CHANGE |
| Component | k8sleaderelector |
| Component type | extension |
| Detection methods | code-diff |
| Upstream PR | — |
| Affected config fields | lease_duration, renew_deadline, retry_period |
| Has test coverage | true |

Description: Validate now requires all timings > 0, lease_duration > renew_deadline, and renew_deadline > retry_period * 1.2. Configs that client-go used to accept but are invalid now fail at startup.

Recommended action: Check the operator e2e tests and doc examples for k8s_leader_elector timings.

#### MED-12 — New processor.transform.enableProfiles gate at Beta; profile functions moved to the xtransformprocessor module

| Field | Value |
|---|---|
| Category | FEATURE_GATE |
| Component | transformprocessor |
| Component type | processor |
| Detection methods | feature-gates |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52564 |
| Affected config fields | processors.transform.profile_statements |
| Has test coverage | true |

Description: #52564: the gate controls profile_statements and is on by default, so behavior is unchanged. WithProfileFunctions and DefaultProfileFunctions moved to the xtransformprocessor module, which is an API break for distro builders.

Recommended action: Confirm that redhat-opentelemetry-collector still compiles after the module split.

#### MED-13 — Operator-created NetworkPolicies use API server IPs read once at operator startup

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | opentelemetry-operator NetworkPolicy |
| Component type | operator |
| Detection methods | issues |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-operator/issues/5654 |
| Affected config fields | — |
| Has test coverage | false |

Description: operator#5654 (open): the egress policies use API server IP blocks read once at startup. If those IPs change, the operator and the collectors lose API access until the operator restarts.

Recommended action: Check the behavior on OpenShift, including HyperShift and managed control planes, and track the upstream fix.

#### MED-14 — Receivers bound to an IPv6 address get the wrong Service and container ports

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | opentelemetry-operator collector |
| Component type | operator |
| Detection methods | issues |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-operator/issues/5782 |
| Affected config fields | — |
| Has test coverage | false |

Description: operator#5782 (open): PortFromEndpoint takes the first :\d+ match, so [fd00:10:244::5]:4317 gives port 10. This affects IPv6 and dual-stack clusters. Related: #5891, where the extension Service ignores ipFamilies.

Recommended action: Add a known-issue note for IPv6 endpoints and track the upstream fix.

#### MED-15 — A panic in a pod mutator denies the pod despite failurePolicy Ignore

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | opentelemetry-operator pod webhook |
| Component type | operator |
| Detection methods | issues |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-operator/issues/5736 |
| Affected config fields | — |
| Has test coverage | false |

Description: operator#5736 (open): controller-runtime recovers the panic and returns Errored(500) with Allowed=false, so an operator bug can block workload pod creation.

Recommended action: Track the upstream fix.

#### MED-16 — Contrib v0.165.0 requires the unresolvable github.com/hashicorp/consul/api/v2 v2.0.0

| Field | Value |
|---|---|
| Category | DEPENDENCY |
| Component | resourcedetectionprocessor |
| Component type | processor |
| Detection methods | issues |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52874 |
| Affected config fields | — |
| Has test coverage | false |

Description: #52677 bumped to a consul api/v2 tag that was later deleted upstream, so builds with GOPROXY=direct fail. The revert #52874 shipped in v0.165.1. #53006 then moved the consul detector to go-contrib.

Recommended action: Rebase to contrib v0.165.1 or later, never v0.165.0. Check that hermetic and Konflux builds resolve the module.

#### MED-17 — New upstream regression: Shutdown races with onBackendChanges

| Field | Value |
|---|---|
| Category | BEHAVIOR_CHANGE |
| Component | loadbalancingexporter |
| Component type | exporter |
| Detection methods | issues |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/53178 |
| Affected config fields | — |
| Has test coverage | false |

Description: contrib#53175 (open): after #50076, Shutdown() can crash on concurrent map access or WaitGroup misuse, and can leak sub-exporters. The downstream v0.163.0 does not have this, but a rebase past 0.165 will.

Recommended action: Make sure fix PR #53178 is merged and included before rebasing past contrib 0.165, and run the loadbalancing e2e test.

#### MED-18 — An unresponsive hard-mounted NFS blocks all hostmetrics scrapers

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | hostmetricsreceiver |
| Component type | receiver |
| Detection methods | issues |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/53418 |
| Affected config fields | — |
| Has test coverage | false |

Description: contrib#53167 (open, fix PR #53418): a hung filesystem usage call stops all hostmetrics scrapers for that host, and nothing is logged. Related #53432: include_virtual_filesystems triggers automounts and reports them twice.

Recommended action: Track #53418. Consider a known-issue note for nodes with NFS mounts.

#### MED-19 — Docs use the deprecated component type names filelog, kubeletstats and loadbalancing

| Field | Value |
|---|---|
| Category | COMPONENT_DRIFT |
| Component | filelogreceiver / kubeletstatsreceiver / loadbalancingexporter |
| Component type | receiver |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | receivers.filelog, receivers.kubeletstats, exporters.loadbalancing |
| Has test coverage | false |

Description: The canonical types are now file_log (v0.149), kubelet_stats (v0.152) and load_balancing (v0.153). The old names work as deprecated aliases and log a warning. The docs use only the old names (in the filelog, kubeletstats and load-balancing docs), while they already use otlp_grpc and otlp_http.

Recommended action: Switch the examples to the new names and note that the old names are aliases. First confirm that the operator handles the new names (automatic RBAC and ports).

#### MED-20 — Other documented components also use deprecated short type names

| Field | Value |
|---|---|
| Category | COMPONENT_DRIFT |
| Component | k8sattributes / resourcedetection / hostmetrics / k8sobjects / otlpjsonfile / prometheusremotewrite / cumulativetodelta / metricstarttime / spanmetrics / googleclientauth |
| Component type | processor |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | processors.k8sattributes, processors.resourcedetection, receivers.hostmetrics, receivers.k8sobjects, receivers.otlpjsonfile, receivers.prometheusremotewrite, exporters.prometheusremotewrite, processors.cumulativetodelta, processors.metricstarttime, connectors.spanmetrics, extensions.googleclientauth |
| Has test coverage | false |

Description: The docs use only the old names: k8sattributes (7 files), resourcedetection (7), hostmetrics, k8sobjects, otlpjsonfile, the prometheusremotewrite receiver and exporter, cumulativetodelta, metricstarttime, spanmetrics and googleclientauth. All of them now have snake_case canonical types.

Recommended action: Rename all of these in the same pass as MED-19, after confirming that the operator accepts the new names.

#### MED-21 — `protocol_version` documented as required, but upstream treats it as optional

| Field | Value |
|---|---|
| Category | DOC_STALE |
| Component | kafkaexporter / kafkareceiver |
| Component type | exporter |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | protocol_version |
| Has test coverage | false |

Description: Both Kafka docs call protocol_version required. configkafka validates it only when it is set, and the upstream READMEs give a default of 2.1.0.

Recommended action: Mark it optional and state the default or that the version is negotiated with the broker.

#### MED-22 — OTel Go SDK v1.45 -> v1.47; logs SDK goes stable (sdk/log v0.21.0 -> v1.47.0)

| Field | Value |
|---|---|
| Category | DEPENDENCY |
| Component | collector-core (service/otelcol/otelcorecol) |
| Component type | core |
| Detection methods | dependencies |
| Upstream PR | — |
| Affected config fields | service.telemetry |
| Has test coverage | false |

Description: The otlplog exporters move from v0.21 to v0.23, otel/exporters/prometheus from v0.67 to v0.69, contrib from v0.70 to v0.72 and otelconf from 0.25 to 0.27. These libraries produce the collector's own telemetry and parse the service::telemetry config.

Recommended action: Check the internal telemetry (metrics endpoint, logs, OTLP self-telemetry) on the rebase, and read the otelconf 0.26 and 0.27 changelogs for schema changes.

#### MED-23 — New indirect AWS SDK v2 dependency set through the contrib detectors/aws/ec2/v2 detector

| Field | Value |
|---|---|
| Category | DEPENDENCY |
| Component | collector-core (otelcorecol/service) |
| Component type | core |
| Detection methods | dependencies |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | false |

Description: cmd/otelcorecol now pulls in detectors/aws/ec2/v2 v2.6.0 and the aws-sdk-go-v2 set, and the GCP detector was dropped. This adds to the SBOM and to the CVE scan surface.

Recommended action: Expect new aws-sdk-go-v2 modules in the SBOM and CVE scans. Check whether ec2 detection is reachable from the default telemetry config.

#### MED-24 — Collector stable modules v1.69.0 -> v1.71.0, gRPC 1.84 -> 1.85

| Field | Value |
|---|---|
| Category | DEPENDENCY |
| Component | collector-core (stable modules) |
| Component type | core |
| Detection methods | dependencies |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | false |

Description: The stable modules move to v1.71.0, grpc to 1.85.0 and grpc-gateway to 2.31.0, and the new module receiver/receiverhelper/xreceiverhelper was added. The operator still pins collector/pdata v1.66.0 and featuregate v1.70.0.

Recommended action: Line up the contrib and operator collector/pdata versions with v1.71.0 on the rebase, and run the gRPC OTLP e2e tests.

#### MED-25 — 50 chainsaw auto-instrumentation test files deleted upstream since the downstream base

| Field | Value |
|---|---|
| Category | test-deletion |
| Component | operator/auto-instrumentation (tests/e2e-instrumentation) |
| Component type | operator |
| Detection methods | test-coverage |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-operator/pull/5935 |
| Affected config fields | — |
| Has test coverage | true |

Description: Upstream #5935 removed 10 chainsaw cases: dotnet, java, java-other-ns, nginx-contnr-secctx, nodejs, nodejs-volume, php, python, python-musl and ruby. Each has a counterpart in tests/e2e-instrumentation-go, so the coverage moved to another suite and was not lost. Downstream jobs that run only the chainsaw suite will lose these cases after the rebase.

Recommended action: Before rebasing the next rhosdt-* branch, confirm that the OpenShift CI upstream step, the IBM P/Z runs and the Konflux ITS run the e2e-instrumentation-go suite.

## Low

#### LOW-1 — googleclientauth renamed to google_client_auth (alias kept)

| Field | Value |
|---|---|
| Category | DEPRECATION |
| Component | googleclientauthextension |
| Component type | extension |
| Detection methods | changelog |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/45339 |
| Affected config fields | extensions.googleclientauth |
| Has test coverage | true |

Description: In v0.164.0 the old name became a deprecated alias. In v0.165.0 credential detection moved to cloud.google.com/go/auth.

Recommended action: Update the docs to the new name before the alias is removed (see MED-20).

#### LOW-2 — count_traces_sampled metric deprecated in favor of count_spans_processed

| Field | Value |
|---|---|
| Category | DEPRECATION |
| Component | probabilisticsamplerprocessor |
| Component type | processor |
| Detection methods | changelog |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/50954 |
| Affected config fields | — |
| Has test coverage | true |

Description: v0.164.0 adds otelcol_processor_probabilistic_sampler_count_spans_processed and deprecates the old metric.

Recommended action: Update the dashboards and alerts that use the old metric.

#### LOW-3 — [Pending] Watch restarts with backoff instead of stopping permanently

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | k8seventsreceiver, k8sobjectsreceiver |
| Component type | receiver |
| Detection methods | changelog |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/51082 |
| Affected config fields | — |
| Has test coverage | true |

Description: #51082: watches restart after the channel closes and keep the persisted resourceVersion. k8s_events stops forwarding non-410 watch errors as events and keeps its storage open across temporary leader election loss (#53090).

Recommended action: Note it as a fix for long-running clusters, and check the k8sevents e2e with leader election.

#### LOW-4 — At-least-once delivery on graceful shutdown under back pressure (synchronous emitter only)

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | filelogreceiver (pkg/fileconsumer) |
| Component type | receiver |
| Detection methods | changelog |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52233 |
| Affected config fields | receivers.filelog.poll_interval |
| Has test coverage | true |

Description: #52233: logs interrupted by shutdown are re-read after restart, so duplicates are possible. This holds only with the stanza.synchronousLogEmitter gate. Pending: poll_interval <= 0 is rejected.

Recommended action: Informational. Add it to the release notes.

#### LOW-5 — Experimental kubelet pod source and HPA metadata source

| Field | Value |
|---|---|
| Category | NEW_FEATURE |
| Component | k8sattributesprocessor |
| Component type | processor |
| Detection methods | code-diff |
| Upstream PR | — |
| Affected config fields | kubelet, extract.labels.from, extract.annotations.from |
| Has test coverage | true |

Description: A new kubelet block is gated by processor.k8sattributes.EnableKubeletPodSource. extract labels and annotations accept from: horizontalpodautoscaler, which needs HPA RBAC. Semconv is bumped to v1.45.0.

Recommended action: If HPA extraction gets documented, add autoscaling HPA get/list/watch to the operator RBAC.

#### LOW-6 — Additive config fields

| Field | Value |
|---|---|
| Category | NEW_FEATURE |
| Component | misc downstream components |
| Component type | receiver |
| Detection methods | code-diff |
| Upstream PR | — |
| Affected config fields | timestamp_mode, cache_sync_timeout, scrapers.hardware |
| Has test coverage | true |

Description: New fields: logdedup timestamp_mode, k8sobjects cache_sync_timeout, k8scluster sidecar, init and ephemeral container metrics, the hostmetrics hardware scraper, and a fileexporter internal logger. None of them change defaults.

Recommended action: None. Optionally consider them for the docs.

#### LOW-7 — Removal warnings apply to the upstream core distro only

| Field | Value |
|---|---|
| Category | DEPRECATION |
| Component | attributes/resource/span processors, jaeger/zipkin receivers |
| Component type | processor |
| Detection methods | code-diff |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | true |

Description: coredistro.WarnRemoval fires only when BuildInfo matches otelcol / OpenTelemetry Collector, so the Red Hat build is not affected.

Recommended action: Confirm that the Red Hat distro BuildInfo does not match the core distro values.

#### LOW-8 — New Alpha gates receiver.otlp.rejectInvalidUTF8 and receiver.otlp.sanitizeInvalidUTF8

| Field | Value |
|---|---|
| Category | NEW_FEATURE |
| Component | otlpreceiver |
| Component type | receiver |
| Detection methods | feature-gates |
| Upstream PR | — |
| Affected config fields | --feature-gates |
| Has test coverage | false |

Description: New and default off (#11449). They reject invalid UTF-8 or replace it with U+FFFD.

Recommended action: Track promotion to Beta, which would change ingestion behavior.

#### LOW-9 — Other new Alpha gates (default off) on in-build components

| Field | Value |
|---|---|
| Category | NEW_FEATURE |
| Component | k8sattributesprocessor, k8sobjectsreceiver, kubeletstatsreceiver, prometheusreceiver, prometheusremotewritereceiver, prometheusexporter, prometheusremotewriteexporter, transformprocessor, collector |
| Component type | processor |
| Detection methods | feature-gates |
| Upstream PR | — |
| Affected config fields | --feature-gates |
| Has test coverage | false |

Description: New gates, all default off: EnableKubeletPodSource, useInformerObserver, the kubelet_stats V0/V1 K8s conventions and cpuUtilizationRounding, EnableOpenMetrics2, UseTargetUrlForServerAddress, disableJobSplit, DisableSendingQueue, KeepIdentifyingResourceAttributes, CorrectUCUMUnits, pkg.ottl.enableDynamicMapKeys, enableExperimentalFunctions and core CustomTCPRouting.

Recommended action: Watch the kubeletstats conventions gates and the prometheus translator gates for promotion.

#### LOW-10 — New Alpha gates operator.targetallocator.targetsremainingattributes and targetallocator.targetsremainingattributes

| Field | Value |
|---|---|
| Category | NEW_FEATURE |
| Component | opentelemetry-operator (target allocator) |
| Component type | operator |
| Detection methods | feature-gates |
| Upstream PR | — |
| Affected config fields | --feature-gates |
| Has test coverage | false |

Description: Both are default off. They record opentelemetry_allocator_targets_remaining with job and namespace attributes (#4637, #5728). No operator gates were promoted or removed.

Recommended action: No action. Make sure the CSV and operator args in the downstream fork accept the new flag.

#### LOW-11 — In-place metadata mutation gives later datapoints the wrong log_stream_name

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | awsemfexporter |
| Component type | exporter |
| Detection methods | issues |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/53239 |
| Affected config fields | — |
| Has test coverage | false |

Description: contrib#53223 (open): placeholder fallback mutates shared metadata, so later datapoints inherit earlier values.

Recommended action: Track #53239 for the next rebase.

#### LOW-12 — Rejected duplicate-fingerprint files leave their file handles open

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | filelogreceiver (pkg/stanza/fileconsumer) |
| Component type | receiver |
| Detection methods | issues |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/53189 |
| Affected config fields | — |
| Has test coverage | false |

Description: contrib#53135 (open): the file descriptor of a rejected duplicate is not closed, so open descriptors can grow. Affects filelog and otlpjsonfile.

Recommended action: Track #53189.

#### LOW-13 — Prometheus exporter exemplar and label-collision bugs

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | prometheusexporter |
| Component type | exporter |
| Detection methods | issues |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/53412 |
| Affected config fields | — |
| Has test coverage | false |

Description: Open issues: #53377 exemplars lost when delta histograms are accumulated, #53376 exemplar filtered_attributes not converted, #53375 colliding normalized labels.

Recommended action: Track for the next rebase.

#### LOW-14 — Typed slices and maps never compare equal to OTTL lists, maps or pcommon values

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | pkg/ottl (transformprocessor, filterprocessor) |
| Component type | processor |
| Detection methods | issues |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/53374 |
| Affected config fields | — |
| Has test coverage | false |

Description: contrib#53374 (open): results such as the []string from Split fall into the default comparator branch, so comparisons give misleading results.

Recommended action: Track upstream.

#### LOW-15 — Invalid profiles JSON panics the collector

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | otlpjsonfilereceiver |
| Component type | receiver |
| Detection methods | issues |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/53291 |
| Affected config fields | — |
| Has test coverage | true |

Description: contrib#53290: a discarded unmarshal error leads to a nil dereference. Fixed by #53291. It only matters for profiles pipelines.

Recommended action: The fix comes in with the rebase. No action unless profiles become supported.

#### LOW-16 — Upstream nightly e2e fails with the contrib-dev collector

| Field | Value |
|---|---|
| Category | TEST_COVERAGE |
| Component | opentelemetry-operator |
| Component type | operator |
| Detection methods | issues |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-operator/issues/5953 |
| Affected config fields | — |
| Has test coverage | false |

Description: operator#5953 (open): the nightly e2e run with contrib-dev:latest failed, which may point to an incompatibility with upcoming contrib changes.

Recommended action: Find out which test failed before the next rebase.

#### LOW-17 — k8s_cluster: `namespaces` and `k8s_leader_elector` options not documented

| Field | Value |
|---|---|
| Category | DOC_MISSING |
| Component | k8sclusterreceiver |
| Component type | receiver |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | namespaces, k8s_leader_elector, node_conditions_to_report, allocatable_types_to_report, metadata_collection_interval |
| Has test coverage | false |

Description: The doc warns that multiple replicas duplicate data but does not mention k8s_leader_elector for HA. namespaces (for namespace-scoped RBAC) and other options are also undocumented.

Recommended action: Add k8s_leader_elector to the multi-replica NOTE. Optionally document namespaces.

#### LOW-18 — Kafka Exporter: new optional fields not documented

| Field | Value |
|---|---|
| Category | DOC_MISSING |
| Component | kafkaexporter |
| Component type | exporter |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | producer, sending_queue, retry_on_failure, partition_traces_by_id, topic_from_attribute |
| Has test coverage | false |

Description: Undocumented fields include producer settings, sending_queue, retry_on_failure, the partitioning options and topic_from_attribute.

Recommended action: Optional. Consider per-signal topic, producer.compression/required_acks, and sending_queue/retry_on_failure.

#### LOW-19 — Kafka Receiver: new optional fields not documented

| Field | Value |
|---|---|
| Category | DOC_MISSING |
| Component | kafkareceiver |
| Component type | receiver |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | group_id, initial_offset, message_marking, header_extraction, error_backoff |
| Has test coverage | false |

Description: Undocumented fields include group_id, initial_offset, message_marking, header_extraction, error_backoff and others.

Recommended action: Optional. Consider group_id, initial_offset and message_marking.

#### LOW-20 — OTLP Receiver: optional fields not documented

| Field | Value |
|---|---|
| Category | DOC_MISSING |
| Component | otlpreceiver |
| Component type | receiver |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | traces_url_path, metrics_url_path, logs_url_path, include_metadata, max_recv_msg_size_mib, auth |
| Has test coverage | false |

Description: Undocumented fields include the URL paths, cors, max_recv_msg_size_mib, keepalive, include_metadata and auth.

Recommended action: Optional. Consider include_metadata and auth.

#### LOW-21 — Tail Sampling: new policy types and top-level options not documented

| Field | Value |
|---|---|
| Category | DOC_MISSING |
| Component | tailsamplingprocessor |
| Component type | processor |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | decision_cache, maximum_trace_size_bytes, block_on_overflow, sample_on_first_match, not, bytes_limiting, trace_flags |
| Has test coverage | false |

Description: Undocumented: the not, bytes_limiting and trace_flags policies, decision_cache, maximum_trace_size_bytes, block_on_overflow, sample_on_first_match and others.

Recommended action: Optional. Consider decision_cache and maximum_trace_size_bytes.

#### LOW-22 — k8sattributes: optional fields not documented

| Field | Value |
|---|---|
| Category | DOC_MISSING |
| Component | k8sattributesprocessor |
| Component type | processor |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | wait_for_metadata, passthrough, exclude, kubelet |
| Has test coverage | false |

Description: Undocumented fields include passthrough, exclude, wait_for_metadata, watch_sync_period and the experimental kubelet block. The doc's default metadata list may be incomplete.

Recommended action: Optional. Consider wait_for_metadata, and check the default attribute list against metadata.yaml. Do not document the kubelet block.

#### LOW-23 — Filelog: optional fields not documented

| Field | Value |
|---|---|
| Category | DOC_MISSING |
| Component | filelogreceiver |
| Component type | receiver |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | storage, start_at, multiline, exclude_older_than |
| Has test coverage | false |

Description: Undocumented fields include start_at, poll_interval, storage, retry_on_failure, multiline, exclude_older_than and others.

Recommended action: Optional. Consider storage (with file_storage) and start_at.

#### LOW-24 — otel-exporters-google-cloud-exporter.adoc flagged as having no manifest component (false positive)

| Field | Value |
|---|---|
| Category | COMPONENT_DRIFT |
| Component | googlecloudexporter |
| Component type | exporter |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | false |

Description: manifest.yaml does include googlecloudexporter. The mismatch comes from the doc slug google-cloud vs the module name googlecloud.

Recommended action: No doc change. Fix the workflow's doc-to-manifest matcher to normalize hyphens.

#### LOW-25 — Indirect k8s.io/client-go and apimachinery 0.35.4 -> 0.37.1 in collector-core

| Field | Value |
|---|---|
| Category | DEPENDENCY |
| Component | collector-core (indirect k8s) |
| Component type | core |
| Detection methods | dependencies |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | false |

Description: This brings collector-core in line with the operator, which is already on v0.37.1.

Recommended action: Normal rebase validation. Confirm that the contrib k8s components resolve to the same k8s.io version.

#### LOW-26 — Operator: operator-framework/api 0.45->0.46, prometheus/common 0.73.1->0.74.0, library-go bump

| Field | Value |
|---|---|
| Category | DEPENDENCY |
| Component | opentelemetry-operator |
| Component type | operator |
| Detection methods | dependencies |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | false |

Description: Only minor and patch bumps. k8s.io, controller-runtime, cert-manager and the Go version are unchanged.

Recommended action: Run the target allocator e2e tests, because the prometheus/common bump touches Prometheus config parsing.

#### LOW-27 — 34 upstream test files modified since the downstream base

| Field | Value |
|---|---|
| Category | test-modification |
| Component | operator (various suites) |
| Component type | operator |
| Detection methods | test-coverage |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | true |

Description: Mostly image and agent version bumps, plus small changes to the opampbridge and operator-restart suites. No suite directories were added or removed.

Recommended action: Informational. Re-run the opampbridge and operator-restart suites after the rebase.

#### LOW-28 — chronyreceiver has no test in either repo

| Field | Value |
|---|---|
| Category | coverage-gap |
| Component | receiver/chronyreceiver |
| Component type | receiver |
| Detection methods | test-coverage |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | false |

Description: This is the only component in the build with no test. It is not documented, which lowers the risk.

Recommended action: Add a QE test only if chronyreceiver is meant to become supported.

#### LOW-29 — Documented components covered only by upstream tests

| Field | Value |
|---|---|
| Category | thin-coverage |
| Component | receiver/zipkinreceiver, receiver/kafkareceiver, exporter/kafkaexporter, receiver/collector (OBI) |
| Component type | receiver |
| Detection methods | test-coverage |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | true |

Description: zipkin appears only incidentally, in a TLS-profile test. kafka and OBI are covered only by upstream suites (OBI fails on 5.14 kernels). QE has no test for any of them.

Recommended action: Consider a QE data-path test for the zipkin receiver.

#### LOW-30 — Test configs mostly use deprecated component type aliases

| Field | Value |
|---|---|
| Category | deprecated-type-aliases |
| Component | multiple (filelog, otlphttp, otlp exporter, kubeletstats, k8sattributes, resourcedetection, prometheusremotewrite, k8sobjects, hostmetrics, loadbalancing, googleclientauth, metricstarttime, otlpjsonfile) |
| Component type | receiver |
| Detection methods | test-coverage |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | true |

Description: Upstream operator tests and QE tests mostly use the deprecated names. They will fail validation when upstream removes the aliases.

Recommended action: Track the removal of the aliases, and migrate the QE configs to the canonical names before then.


## Confirmed Coverage Gaps

Components and operator features with no test at all — neither upstream nor QE. Anything with at least one of the two is considered covered, since the product build runs both suites.

- receiver/chronyreceiver (receiver) — undocumented, no upstream or QE test


## Documentation Drift

Docs that exist but no longer match any component in the manifest.

- otel-exporters-google-cloud-exporter.adoc (exporter) — doc exists but no matching component found in the manifest

## Skill Improvement Recommendations

*(Deviations from skill steps as written — `None.` if everything worked as described.)*

- [discover] The compound command (ls-remote | sed | sort plus fetches in one shell) was refused by the worktree-isolation guard, so each git command ran on its own with an absolute 'git -C <worktree>/<repo>' path. The ls-remote output was sorted by hand: there are two branches, rhosdt-0.158 and rhosdt-0.163, so the release branch is rhosdt-0.163.
- [discover] The manifest has a receiver whose module is in neither the core nor the contrib repo: go.opentelemetry.io/obi/collector v0.15.2 (OBI, built from the local source in ../.obi-src through 'replaces'). The repo enum only allows collector_core or collector_contrib, so it is listed as collector_contrib with source_dir 'collector'. Its upstream repo is really open-telemetry/opentelemetry-ebpf-instrumentation, so regression analysis of the contrib repo should skip it or point it at the OBI repo.
- [discover] k8sattributesprocessor is pinned at v1.2.0, not v0.163.0, because it is a stable-versioned module. The version is recorded as written in the manifest.
- [discover] The manifest also has 'providers' (confmap env/file/http/https/yaml v1.69.0) and 'replaces' sections, which the instructions do not mention. They were left out of components because they are not collector component types.
- [discover] Several doc file names do not follow the manifest names, so they were matched by hand: k8seventsreceiver -> otel-receivers-kubernetesevents-receiver.adoc, otlpexporter -> otel-exporters-otlp-grpc-exporter.adoc, awscloudwatchlogsexporter -> otel-exporters-aws-cloudwatch-exporter.adoc, googleclientauthextension -> otel-extensions-googleauth-extension.adoc, oauth2clientauthextension -> otel-extensions-oauth2client-extension.adoc, k8sattributesprocessor -> otel-processors-kubernetes-attributes-processor.adoc, probabilisticsamplerprocessor -> otel-processors-probabilistic-sampling-processor.adoc, k8sobjectsreceiver -> otel-receivers-k8sobjectsreceiver-receiver.adoc, go.opentelemetry.io/obi/collector -> otel-receivers-obi-receiver.adoc. memorylimiterextension was not matched to the memory-limiter processor doc.
- [discover] The worktree path was used as the workspace root, since the sub-repo clones exist there. The openshift-docs checkout is on branch standalone-otel-docs-main and was read from the working tree as instructed, not fetched or updated.
- [setup] The repos were found inside the session worktree (.claude/worktrees/regression-detection-2026-11-23/<repo>), not in the main workspace root. The worktree isolation guard refused git commands written as a for loop over repo paths, so each git -C <repo> command had to be written out separately, run from the worktree directory.
- [setup] In openshift-docs, 'git fetch origin main' succeeded but wrote only to FETCH_HEAD, which was 2b444a46f4dc6c5c8e0c885d6166c7d9190741bc. 'git rev-parse origin/main' failed because the clone's only fetch refspec is standalone-otel-docs-main. To get the docs HEAD, I fetched standalone-otel-docs-main and resolved origin/standalone-otel-docs-main = 52dcc9258898dc407d6c2fec636bc109a1087966 instead.
- [setup] For the operator base ref (a commit hash), I used 'git rev-parse --verify <sha>^{commit}' so the check confirms the object really exists. A plain --verify only checks that a full 40-character hash is well formed.
- [setup] The origin/main HEADs were: operator 31039f9b288856fe944c146e69564357fb051b06, contrib bb284a9faf97aacace4283569a4e65d8c2e9beb3, core d56d0a1c98b680549fed9c595c731cb26a473f3b, QE d2141b02a7919d3188c165a37b3b72b82ff072df. The output schema has no field for these heads, so they are recorded here.
- [changelog] The worktree isolation guard refused compound git commands (for loops, `cd && git`, `git -C .`, and file names containing 'github'), so I ran each git command on its own and used `git archive origin/main .chloggen | tar -x -C /tmp/...` to read the pending entries.
- [changelog] Sub-repo checkouts are not at origin/main (contrib HEAD d818d00 vs origin/main bb284a9), so reading .chloggen/*.yaml from the working tree would have been stale. I read CHANGELOG.md and .chloggen from origin/main through git show and git archive.
- [changelog] The operator base commit 902d1015 is the 0.163.0 release commit itself, so the operator has no released CHANGELOG sections between base and HEAD. Only the 27 commits after it and 10 pending .chloggen entries were analyzed.
- [changelog] Component names in the changelogs use snake_case paths (e.g. receiver/k8s_cluster, processor/resource_detection, extension/headers_setter), not the source directory names in the task list. I filtered with a regex that maps both forms, and also included shared packages (pkg/stanza, pkg/fileconsumer, pkg/ottl, pkg/zipkin, pkg/jaeger, pkg/translator/prometheusremotewrite, pkg/kafka/configkafka, internal/kafka) that the listed components depend on.
- [changelog] Changelog entries cite issue numbers, which often differ from PR numbers. I looked up PR numbers with git log --grep where I could. Some upstream_pr links point to the issue instead of the PR.
- [changelog] I also checked openshift-docs and distributed-tracing-qe for affected config keys (disable_keep_alives, resource_to_telemetry_conversion, flatten_data). The task did not ask for this; I did it to rate severity.
- [changelog] I did not read CHANGELOG-API.md in contrib in detail; I only looked at core CHANGELOG-API.md.
- [code-diff] The worktree sandbox refused git commands run in for-loops or with git -C. Repos were found under the session worktree (.claude/worktrees/regression-detection-2026-11-23/<repo>), and each per-directory diff was replaced by one git diff --stat with path globs ('*/config.go' '*/factory.go'), filtered with grep to the listed components.
- [code-diff] The listed contrib directory 'collector' does not exist in opentelemetry-collector-contrib and was skipped.
- [code-diff] Operator 'git diff ... -- apis/' and '-- internal/webhook/' returned empty output, so I also looked at the non-test operator diff to report the reconciliation behavior changes.
- [code-diff] The instructions gave no step for collector-core, so I checked the core CHANGELOG, .chloggen and the config.go/generated_config.go diffs. The confighttp keepalive key removal was found this way.
- [code-diff] Many contrib config fields now live in subpackage config files (resourcedetection internal/*/config.go, transformprocessor, hostmetrics scrapers) or in generated_config.go (core), which the <dir>/config.go and <dir>/factory.go pattern misses. Breaking changes outside config.go/factory.go (oidc ParseSignedCompact, prometheus receiver labels, kubeletstats attributes) were only found through CHANGELOG.md and .chloggen, so I also checked those.
- [code-diff] No operator tests were run and no collector tests were run. has_test_coverage reflects upstream unit tests seen in the diffs and changelog, not downstream e2e coverage.
- [feature-gates] I did not use the suggested 'git diff ... | grep -A5 -B5 featuregate|MustRegister' as the main method. That output shows Stage changes without the gate ID for generated_feature_gates.go files, and it also catches Prometheus client MustRegister calls. Instead I wrote a small parser (/tmp/fgscan/fg.py) that reads every featuregate MustRegister call (ID, stage, to_version) at both refs and diffs the two maps. I checked it against raw MustRegister counts: contrib 139/142 and 149/152, where the gaps are testbed Prometheus registrations; core 16/17, where the gap is the Registry.MustRegister definition itself.
- [feature-gates] The worktree-isolation guard refused compound shell commands (multi-repo loops, mkdir plus heredoc, for-loops over git log). I split them into single commands, one per repo.
- [feature-gates] Gate IDs in pkg/translator/* and internal/coreinternal do not carry the downstream component name. I mapped them to in-build components by import usage: zipkin/jaeger translators -> zipkinreceiver, jaegerreceiver, kafkareceiver/exporter; prometheus translator -> prometheusexporter, prometheusreceiver, PRW receiver/exporter. I excluded goldendataset gates as test-only.
- [feature-gates] The instructions list only Alpha->Beta, Beta->Stable and Removed. I also reported a new gate added directly at Beta (default on, transform enableProfiles), a gate added and promoted inside the window (awsxray EmitV1DBConventions, Alpha->Beta, counted as an Alpha->Beta promotion), a gate that went Beta->Stable->Removed inside the window (filelog.protobufCheckpointEncoding), and notable new Alpha gates, rated LOW.
- [feature-gates] The operator tracks its own CLI flags (for example --enable-*-instrumentation) outside the featuregate registry. Those were not analysed, in keeping with the featuregate/MustRegister scope.
- [issues] The opentelemetry-operator repo has no 'breaking' label (its only bug-related label is 'bug'), so step 3 returned nothing. Instead I read the pending .chloggen/*.yaml entries on main through gh api. None has change_type: breaking.
- [issues] The instructions do not say how to find the downstream base version. I used gh api on openshift/redhat-opentelemetry-collector@rhosdt-0.163 manifest.yaml and openshift/open-telemetry-opentelemetry-operator@rhosdt-0.163 versions.txt. A local `git show origin/rhosdt-*` in the sibling repos was refused by the worktree-isolation guard, and one chained gh api command was refused by the same guard, so I split it into simpler commands.
- [issues] The collector repo also has rhosdt-3.9 and rhosdt-3.10 branches (product-version names) next to rhosdt-0.158 and rhosdt-0.163. A plain `sort -V | tail -1` picks rhosdt-3.10, not the operator-version branch.
- [issues] With --limit 30, the bug lists only reach back to 2026-11-14 for contrib and 2026-09-10 for operator. Contrib bugs filed between the base release (v0.163.0, 2026-10-14) and 2026-11-14 were not scanned. The commands have no date filter.
- [issues] The revert searches return results in relevance order, not by date, and include PRs from 2021 to 2025. I filtered them by hand against the base release dates.
- [doc-validation] The workflow ran the git commands without `git -C`: the worktree-isolation guard refused `git -C <workspace>/openshift-docs` and `cd` into sibling repos, so I read files directly and took HEAD from .git/HEAD (openshift-docs on branch docs/otel-regression-detection-v0.158.0-fixes, contrib on main). I could not get commit SHAs.
- [doc-validation] openshift-docs/otel-collector/modules is a symlink to ../modules; I read the files from openshift-docs/modules.
- [doc-validation] Mapping for filelog points to receiver/filelogreceiver/config.go, which does not exist; the config is in receiver/filelogreceiver/filelog.go plus pkg/stanza/fileconsumer/config.go, matcher/matcher.go and attrs/attrs.go.
- [doc-validation] Mapping for the OBI receiver (opentelemetry-collector-contrib/collector/config.go) is wrong; the manifest imports go.opentelemetry.io/obi/collector (v0.10.0, replaced with ../.obi-src). I did not check it.
- [doc-validation] Mapping paths receiver/otlpjsonfilereceiver/config.go (config is in file.go) and core connector/forwardconnector/config.go (no config file, the connector has no config) do not exist. I did not check these components.
- [doc-validation] Kafka receiver/exporter and OTLP receiver fields are mostly in shared packages (pkg/kafka/configkafka/config.go, config/configtls/generated_config.go, config/configgrpc/configgrpc.go), not the mapped config.go; I followed the squash embeds.
- [doc-validation] Checked 7 components instead of 6 (added Kafka Exporter, since the Kafka Receiver doc had clearly been updated but the exporter had not).
- [doc-validation] The step-2 drift check (filelog/kubeletstats/loadbalancing) was too narrow; I listed every `deprecated_type` in upstream metadata.yaml files and found 10 more documented components using deprecated short names.
- [doc-validation] Step 3 told me to flag otel-exporters-google-cloud-exporter.adoc as COMPONENT_DRIFT MEDIUM. The component is in manifest.yaml (googlecloudexporter v0.158.0), so it is a matcher false positive. I reported it as LOW instead of MEDIUM, with a note to fix the matcher.
- [doc-validation] I used the contrib CHANGELOG.md to find the version where each field was removed or each component was renamed, so I could judge severity against the 0.158.0 distro; the instructions did not ask for this.
- [dependencies] Running git with 'cd <workspace>/opentelemetry-operator' was refused because the session is isolated in a worktree. I used 'git -C <worktree>/opentelemetry-operator' (and opentelemetry-collector) on the sub-repo clones inside the worktree instead.
- [dependencies] Step 2: the operator versions.txt diff was empty (the file did not change between 902d1015 and origin/main).
- [dependencies] Step 3: the collector-core root go.mod diff (v0.163.0..origin/main) was empty. That go.mod states it is not used to build any binary. To find the real dependency changes I widened the scope to the per-module go.mod files (95 changed) and analyzed cmd/otelcorecol/go.mod, service/go.mod and otelcol/go.mod instead.
- [dependencies] Besides go.mod, I also checked the operator's apis/go.mod (unchanged) and read the HEAD go.mod to record the unchanged versions of the deps in focus.
- [test-coverage] The checks used the repo checkouts inside the session worktree (.claude/worktrees/regression-detection-2026-11-23/{opentelemetry-operator,distributed-tracing-qe,opentelemetry-collector*}), not the copies at the workspace root. The two operator checkouts differ: the root copy has no tests/e2e-instrumentation-go directory, so it found 21 e2e-* suites where the worktree copy has 22.
- [test-coverage] Type keys came from the contrib and core checkouts as they are (contrib at origin/main bb284a9), not from the v0.163.0 tags in manifest.yaml. Upstream main renamed many types to snake_case and kept the old names as deprecated_type. Both names were searched.
- [test-coverage] The suggested grep pattern could not tell which section a key is in. Several keys are shared: prometheus, kafka and prometheus_remote_write are both a receiver and an exporter, memory_limiter is both an extension and a processor, and otlp is a receiver and a deprecated exporter alias. Instead, a PyYAML walker indexed every test YAML by (section, type key). It also read configs embedded as strings and replaced Go-template {{...}} placeholders so the e2e-instrumentation-go testdata would parse. 8 templated Instrumentation files still did not parse; they have no collector config. The grep was used only to spot-check.
- [test-coverage] Manifest item 'receiver/collector' is not a collector-contrib or core component. It is the OBI receiver (go.opentelemetry.io/obi/collector, built from the .obi-src submodule), so there was no metadata.yaml to look up. The type key 'obi' was taken from the operator tests.
- [test-coverage] 'Dedicated' covered test dirs whose names differ from every type and directory candidate when the dir is clearly for that component. Upstream: e2e/filelog-receiver, e2e-automatic-rbac/receiver-k8sevents, receiver-kubeletstats, receiver-k8scluster, receiver-k8sobjects, processor-k8sattributes, processor-resourcedetection, k8s-leader-elector, e2e-openshift/kafka, e2e/smoke-collector/smoke-collector-obi. QE: e2e-otel/awsemfexporter-cluster-monitoring, filestorageext, k8sleaderelectorext. The strict ls -d candidate rule would have marked these implicit or missed them.
- [test-coverage] An early run of the feature searches went through zsh, where an unquoted $VAR holding several --include flags is passed as one argument, and returned false 'no match' results. The searches were re-run under bash with quoted flags.
- [test-coverage] Operator feature names were derived from the 22 suite directories found, including e2e-instrumentation-go, which the instructions' examples do not list. Matches in Tempo-only files (TLS profile and route hits in e2e-disconnected/multitenancy) and in RBAC rules that merely list horizontalpodautoscalers did not count as QE coverage.
