---
name: otel-qe-deploy-stage-build
description: Installs the OTEL operator from an ART stage build (the multi-arch FBC catalog image from quay.io/redhat-user-workloads/ocp-art-tenant/art-fbc), the Tempo operator from its Konflux stage build, and their example setups on a cluster. Use when the user asks to deploy, install, or set up the stage/product build of Tempo and OpenTelemetry on a cluster for QE testing. For building and installing the upstream operator from source instead, use otel-qe-deploy-upstream-build.
---

# Deploy the Stage/Product Build

## Step 0: Get a cluster
If not already connected to an OpenShift cluster, use the `/otel-qe-prepare-cluster` skill to provision one.

## Step 1: Give the cluster access to the stage registry

### OTEL (ART)
The ART catalog references `registry.redhat.io/rhosdt/*@sha256:…` images that exist only on `registry.stage.redhat.io/rhosdt` until the release is published. The cluster needs the stage credentials and a mirror from the production name to the stage registry. Both live in the `otel-art-reference` skill:

```bash
bash .claude/skills/otel-art-reference/setup-stage-credentials.sh <stage-registry-auth-token>
oc apply -f .claude/skills/otel-art-reference/idms.yaml
```

The token is the base64 `user:password` from the team's credential store. Never print it or write it to a file in the repo.

Two cases need an `ImageContentSourcePolicy` instead of the `ImageDigestMirrorSet`: OCP 4.12, which has no `imagedigestmirrorsets.config.openshift.io` CRD, and a cluster that already has an `ImageContentSourcePolicy`, because the two kinds must not be mixed on one cluster. (The CI step follows this rule. An OCP 4.22 IBM P cluster that already had an ICSP and unrelated IDMS objects took the new IDMS without problems, so on a QE cluster try the IDMS first and fall back to the ICSP if the MachineConfigPools degrade or pulls fail.) Check with `oc get crd imagedigestmirrorsets.config.openshift.io` and `oc get imagecontentsourcepolicy`. The equivalent is:

```bash
cat <<EOF | oc apply -f -
apiVersion: operator.openshift.io/v1alpha1
kind: ImageContentSourcePolicy
metadata:
  name: otel-art-stage
spec:
  repositoryDigestMirrors:
  - source: registry.redhat.io/rhosdt
    mirrors:
    - registry.stage.redhat.io/rhosdt
EOF
```

Wait until `oc get mcp` shows every pool `UPDATED=True` (about a minute) before Step 2. A catalog created while the nodes are still updating reports `TRANSIENT_FAILURE`, and the first Subscription resolution fails.

If the cluster still has the OTEL mirror set from the old Konflux flow (the one applied from `konflux-opentelemetry`'s `.tekton/images-mirror-set.yaml`), delete it first: its per-image sources point at the legacy Konflux repositories, not at the ART images. Find it with `oc get imagedigestmirrorset` and look for `opentelemetry` sources.

### Tempo stage release (Konflux)
Only needed when a Tempo stage release is under test (see Step 2). Tempo is not built by ART and such a build still comes from Konflux:

```
kubectl apply -f https://raw.githubusercontent.com/os-observability/konflux-tempo/refs/heads/main/.tekton/images-mirror-set.yaml
```

## Step 2: Install operators

Modify the manifests in a temporary copy before applying. Do not modify the original files. All paths below are relative to this skill.

### OTEL operator (every architecture)

The ART FBC is multi-arch (amd64, arm64, ppc64le, s390x), so one path covers amd64, arm64 and IBM P and Z.

1. Get the cluster's OCP version: `oc get clusterversion version -o jsonpath='{.status.desired.version}'`. The FBC is per OCP y-stream (e.g. `4.20`).
2. List the FBC images for the release and pick the entry whose `ocp_version` matches (`v4.20`):
   ```bash
   bash .claude/skills/otel-art-reference/get-fbc-images.sh <version>
   ```
   If there is no entry for the cluster's version, stop and ask the user.
3. Use `image` (the floating tag, which follows the latest ART build) for an ad-hoc install, or `image_by_digest` when reproducing a CI result.
4. Replace `<OTEL_FBC_IMAGE>` in a copy of [`install-operators/otel.yaml`](install-operators/otel.yaml) and apply it:
   ```bash
   sed "s|<OTEL_FBC_IMAGE>|${OTEL_FBC_IMAGE}|" install-operators/otel.yaml | oc apply -f -
   ```

The manifest installs the operator in `opentelemetry-operator-system` with the `openshift.io/cluster-monitoring` label: the e2e suites and the CI jobs expect that namespace, and several tests (`env-config`, `operator-restart`, `operator-metrics`, `smoke-collector`) fail in any other one.

Wait for the `art-catalog-otel` CatalogSource to report `READY` (`oc -n openshift-marketplace get catalogsource art-catalog-otel -o jsonpath='{.status.connectionState.lastObservedState}'`) and for the `opentelemetry-product` CSV to reach `Succeeded`.

If the Subscription reports `BundleUnpackFailed` with `DeadlineExceeded` (for example because it was created before the stage credentials), OLM does not retry: delete the failed unpack Job and ConfigMap in `openshift-marketplace` (named after the bundle digest; `oc -n openshift-marketplace get jobs`), then delete and recreate the Subscription.

A node pull error mentioning `x509` means the cluster does not trust the stage registry certificate: add the Red Hat IT root CA as `additionalTrustedCA` (the CI step `distributed-tracing-install-otel-konflux-catalogsource` does this). It was not needed on an OCP 4.21 AWS cluster.

### Tempo operator

Unless a Tempo stage release is under test, install Tempo from the Red Hat Operators catalog, as the CI stage jobs do. `oc apply -f install-operators/tempo-redhat-operators.yaml`. It is available on amd64, arm64, ppc64le and s390x (tempo-operator v0.22.0-2 installed on an OCP 4.22 IBM P cluster).

For a Tempo stage release, use the Konflux builds below. Get the Tempo images from the release payload `konflux/release-payloads/tempo-stage-<version>.yaml` — see `/otel-qe-prepare-cluster`.

**amd64 — FBC fragment.** Replace `<TEMPO_IIB_IMAGE>` in a copy of [`install-operators/tempo.yaml`](install-operators/tempo.yaml) with the Tempo FBC fragment image and apply it with `oc apply -f`.

**arm64 and IBM P and Z — OLM bundle.** The Tempo FBC fragment works only on amd64 clusters. Use the `containerImage` of the `tempo-bundle-main` component in `tempo-stage-<version>.yaml`:

```bash
kubectl create namespace openshift-tempo-operator
operator-sdk run bundle <TEMPO_BUNDLE_IMAGE> --namespace openshift-tempo-operator
```


### Other operators

Apply the remaining manifests from `install-operators/` in alphabetical order using `oc apply -f`: `coo.yaml` and `user_workload_monitoring.yaml`. On IBM P and Z apply only `coo.yaml`.

## Step 3: Install extra operators

Ask the user if they want to deploy the following extra operators:
- **AMQ Streams** (Kafka) — used as a backend/transport for OpenTelemetry pipelines
- **Loki** — log aggregation backend, used with OpenTelemetry log collection
- **Red Hat OpenShift Logging (cluster-logging)** — creates the `openshift-logging` namespace and is required alongside Loki for the `export-to-cluster-logging-lokistack` sub-test

Apply AMQ Streams's manifest from the `install-operators-extra/` folder (relative to this skill) directly with `oc apply -f` — it uses the version-agnostic `stable` channel.

**Loki and Red Hat OpenShift Logging pin a version-specific channel** (e.g. `stable-6.5`, `stable-6.6`) that tracks the OCP y-stream. Their manifests (`loki.yaml`, `cluster-logging.yaml`) use a `CHANNEL_PLACEHOLDER` instead of a hardcoded channel — look up the right channel for the connected cluster and substitute it into a temporary copy before applying (do not modify the original files).

`loki-operator` exists as a package in more than one catalog (e.g. `redhat-operators` and `community-operators`, the latter defaulting to the `alpha` channel) — `oc get packagemanifest <name>` without filtering can be ambiguous, so filter explicitly on `catalogSource: redhat-operators`:

```bash
LOKI_CHANNEL=$(oc get packagemanifest -n openshift-marketplace -o json | \
  jq -r '[.items[] | select(.metadata.name=="loki-operator" and .status.catalogSource=="redhat-operators")][0].status.defaultChannel')
LOGGING_CHANNEL=$(oc get packagemanifest -n openshift-marketplace -o json | \
  jq -r '[.items[] | select(.metadata.name=="cluster-logging" and .status.catalogSource=="redhat-operators")][0].status.defaultChannel')
if [ -z "$LOKI_CHANNEL" ] || [ "$LOKI_CHANNEL" = "null" ] || [ -z "$LOGGING_CHANNEL" ] || [ "$LOGGING_CHANNEL" = "null" ]; then
  echo "ERROR: could not resolve defaultChannel for loki-operator ('$LOKI_CHANNEL') or cluster-logging ('$LOGGING_CHANNEL') — check the redhat-operators catalog is present" >&2
  exit 1
fi
sed "s/CHANNEL_PLACEHOLDER/$LOKI_CHANNEL/" install-operators-extra/loki.yaml | oc apply -f -
sed "s/CHANNEL_PLACEHOLDER/$LOGGING_CHANNEL/" install-operators-extra/cluster-logging.yaml | oc apply -f -
```

Run both `LOKI_CHANNEL`/`LOGGING_CHANNEL` lookups and the `sed | oc apply` in the same shell invocation as each other — the variables don't persist across separate command invocations. Wait for the operator(s) to be ready before proceeding.

## Step 4: Deploy example instance

Ask the user if they want to deploy the example instance. If yes, apply all manifests from the `example-instance/` folder (relative to this skill) in alphabetical order using `oc apply -f`.
