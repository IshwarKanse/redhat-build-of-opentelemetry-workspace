---
name: otel-qe-test-ibm
description: Runs OpenTelemetry operator e2e tests on IBM P (ppc64le) and IBM Z (s390x) clusters using chainsaw. Use when the user asks to run operator tests on IBM P or IBM Z.
---

# Test OpenTelemetry on IBM P and IBM Z

## Prerequisites

An IBM P or IBM Z cluster must already be provisioned and connected. Request one by contacting the IBM contacts listed in the `rhosdt-team` skill. Use `/otel-qe-prepare-cluster` to verify connectivity. Skip requesting/provisioning if a cluster is already logged in.

### Clean up leftover installs from a prior test run

If the cluster was used for testing before, check for leftover operators before installing anything new — a stale install can silently break the new one:

```bash
oc get csv -A | grep -E "kiali-operator|servicemeshoperator3|tempo-operator"
```

If found, delete the example CRs first (so operator finalizers clean up managed resources), then the Subscription/CSV/InstallPlan for each, then the dedicated namespaces they left behind (typically `istio-system`, `istio-cni`, `ztunnel`, `tracing-system`, `openshift-tempo-operator`). Confirm scope with the user before deleting — this touches cluster-wide state.

**Also check for conflicting image mirror objects.** A leftover `ImageDigestMirrorSet`/`ImageTagMirrorSet` from an unrelated prior test run (e.g. Istio/Sail e2e, Gateway API Inference Extension conformance) can duplicate a mirror source across objects with different policies. When that happens, the Machine Config Operator silently refuses to render **any** registry mirror config to nodes — including the Tempo/OTEL `ImageDigestMirrorSet`s installed below — which shows up later as `ImagePullBackOff`/`manifest unknown` on the freshly installed operator pods. Check for it early:

```bash
oc logs -n openshift-machine-config-operator deployment/machine-config-controller --tail=50 | grep -i "conflicting mirrorSourcePolicy"
```

If found, identify the old/unrelated `ImageDigestMirrorSet`/`ImageTagMirrorSet` objects sharing a source and delete them (confirm with the user first). The MCO then rolls a new MachineConfig to every node — this reboots the whole cluster (masters first, then workers) and takes 15-30+ minutes. Poll `oc get mcp` until both `master` and `worker` pools show `UPDATED=True` before continuing.

### Install the operators

Use `/otel-qe-deploy-stage-build` to install the operators. Select Variant B (OLM bundle) for IBM P/Z clusters, and install the extra operators (AMQ Streams, Loki, Red Hat OpenShift Logging) when prompted — they are required by `tests/e2e-openshift` sub-tests (`kafka`, `otlp-metrics-traces`, `multi-cluster`, `export-to-cluster-logging-lokistack`). Loki alone is not enough for `export-to-cluster-logging-lokistack`: the test also needs the `openshift-logging` namespace, which comes from installing the Red Hat OpenShift Logging (cluster-logging) operator. Skip deploying the example instance — the chainsaw suites create their own resources per test case.

### Prepare the operator repo

Ensure the `opentelemetry-operator` repository is up-to-date and on the product branch (e.g., `rhosdt-3.11`). The user must provide the release version. Check whether a clone already exists and is already prepared (on the product branch, with `tests/e2e-otel/` populated, and the target-allocator `nodeAffinity` removed) before re-running `/otel-qe-prepare-operator-tests` — it may already be done in a different local clone.

## Run Tests

Both IBM P (ppc64le) and IBM Z (s390x) run the same reduced test set focused on core collector functionality. Auto-instrumentation, target allocator, OpAMP bridge, and component-specific images are not built for either architecture.

Set `ARTIFACT_DIR` before running (e.g. `mkdir -p /tmp/ibm-artifacts && export ARTIFACT_DIR=/tmp/ibm-artifacts`) if it isn't already set by the CI environment.

The sidecar suite's `--selector` isn't a fixed value — it depends on the cluster's Kubernetes version (mirrors the `CHAINSAW_SELECTOR` logic in the operator repo's `Makefile`): `sidecar=native` if the server Kubernetes version is >= 1.29, otherwise `sidecar=legacy`:

```bash
KUBE_VERSION=$(oc version -o json | jq -r '.serverVersion.gitVersion' | grep -oE '[0-9]+\.[0-9]+' | head -1)
if [ "$(printf '%s\n' "$KUBE_VERSION" "1.29" | sort -V | head -n1)" = "1.29" ]; then
  SELECTOR="sidecar=native"
else
  SELECTOR="sidecar=legacy"
fi
```

Run each command sequentially, do not run them in parallel. Save the output of each test run to a temporary file (using `tee`) for later analysis.

```bash
chainsaw test \
  --report-name "junit_otel_e2e" \
  --report-path "$ARTIFACT_DIR" \
  --test-dir \
  tests/e2e \
  tests/e2e-autoscale \
  tests/e2e-crd-validations \
  tests/e2e-openshift

chainsaw test \
  --report-name "junit_otel_e2e_sidecar" \
  --report-path "$ARTIFACT_DIR" \
  --selector "$SELECTOR" \
  --test-dir \
  tests/e2e-sidecar
```

## Known Expected Failures on IBM P/Z

These fail on every run on these architectures and are not regressions — don't spend time debugging them further, just confirm they still fail for the expected reason:

- `smoke-collector-obi` and `smoke-collector-obi-unprivileged` — the `otc-container` CrashLoopBackOffs. The `obi` receiver is eBPF-based and not supported on ppc64le/s390x.
- `must-gather` — fails with `exec format error` on the Node.js auto-instrumentation init container. Auto-instrumentation images are only built for amd64/arm64 (see the architecture note above).

`autoscale` has been observed to fail intermittently with `no metrics returned from resource metrics API` (HPA/metrics-server timing on the cluster, not a collector bug) — rerun it in isolation before filing a bug.

For any other failure, check whether it's a genuine product bug, a test bug, or an environment/test-setup gap (e.g. a required operator or namespace missing) before filing — see `export-to-cluster-logging-lokistack` above for an example of the latter.

## Reporting Results

After completing the tests, print a summary of the results, calling out which failures (if any) match the known-expected list above vs. new/unexplained ones.
