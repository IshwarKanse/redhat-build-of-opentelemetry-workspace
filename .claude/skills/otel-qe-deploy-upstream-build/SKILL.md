---
name: otel-qe-deploy-upstream-build
description: Build the OpenTelemetry Operator and its related images from the upstream open-telemetry/opentelemetry-operator source, then install the resulting bundle on a cluster and run the e2e test suites. Use when the user asks to build the operator from source/upstream, test an unreleased upstream change, or install a custom-built operator image locally. For installing the Konflux stage/product build instead, use otel-qe-deploy-stage-build.
---

# Build and Install the Upstream Operator

**Prerequisite (Apple Silicon only):** The Makefile `docker build` commands must include `${DOCKER_BUILDX_FLAGS}` so that `--platform=linux/amd64` is passed to the build. Add it to all `docker build` lines in the Makefile (e.g. `docker build --load ${DOCKER_BUILDX_FLAGS} -t ${IMG} .`). Without this, the container image will have the wrong architecture (`Exec format error` at runtime).

Build operator and bundle in two steps. First generate the bundle (no cross-compilation flags — `make bundle` runs host tools), passing `IMG` so the CSV references the correct quay.io image. Then build and push the container images with cross-compilation flags for `linux/amd64`:

```bash
export IMG=quay.io/<namespace>/opentelemetry-operator:latest
export BUNDLE_IMG=quay.io/<namespace>/opentelemetry-operator-bundle:latest

# Step 1: Generate bundle manifests (host-native, no GOOS/GOARCH)
IMG=$IMG BUNDLE_VARIANT=openshift make bundle

# Step 2: Build and push operator and bundle images (cross-compile for linux/amd64)
IMG=$IMG BUNDLE_IMG=$BUNDLE_IMG BUNDLE_VARIANT=openshift \
GOOS=linux GOARCH=amd64 ARCH=amd64 \
DOCKER_BUILDX_FLAGS="--platform=linux/amd64" \
make container container-push bundle-build bundle-push
```

Build related images (set `GOOS=linux GOARCH=amd64 ARCH=amd64` for all):
- Target allocator: `TARGETALLOCATOR_IMG=<img> make targetallocator container-target-allocator container-target-allocator-push`
- OpAMP bridge: `OPERATOROPAMPBRIDGE_IMG=<img> make operator-opamp-bridge container-operator-opamp-bridge container-operator-opamp-bridge-push`
- Auto-instrumentation (java, nodejs, python, dotnet, apache-httpd): Set `INSTRUMENTATION_*_IMG` vars, run `make container-instrumentation-all`, then push each image.

Install: Export `OPERATOROPAMPBRIDGE_IMG`, `TARGETALLOCATOR_IMG`, and all `INSTRUMENTATION_*_IMG` env vars. Create namespace `opentelemetry-operator-system` with cluster-monitoring label. Run `operator-sdk run bundle` from a directory outside the operator repo to avoid `PROJECT` file conflicts:

```bash
oc create namespace opentelemetry-operator-system
oc label namespace opentelemetry-operator-system openshift.io/cluster-monitoring=true
cd /tmp && operator-sdk run bundle $BUNDLE_IMG \
  --namespace opentelemetry-operator-system \
  --timeout 5m \
  --security-context-config=restricted
```

**Manual Steps:**
1. Clone the OpenTelemetry operator repository and cd into it:
   ```bash
   git clone git@github.com:open-telemetry/opentelemetry-operator.git && cd opentelemetry-operator
   ```
2. Clone additional OTEL component tests: `git clone https://github.com/openshift/distributed-tracing-qe.git /tmp/distributed-tracing-qe && mv /tmp/distributed-tracing-qe/tests/e2e-otel ./tests`
3. Enable user workload monitoring: `oc apply -f tests/e2e-openshift/otlp-metrics-traces/01-workload-monitoring.yaml`
4. Create ScrapeConfig CRD: `kubectl create -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/main/example/prometheus-operator-crd/monitoring.coreos.com_scrapeconfigs.yaml`
5. Label worker nodes: `oc get nodes -l node-role.kubernetes.io/worker -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | xargs -I {} oc label nodes {} ingress-ready=true`
6. Replace OpAMP bridge server image: `find . -type f -exec sed -i "s|ghcr.io/open-telemetry/opentelemetry-operator/e2e-test-app-bridge-server:ve2e|${OPAMP_BRIDGE_SERVER}|g" {} \;`
7. Patch the operator CSV to add env vars. After each patch, wait 60s and verify the deployment is Available before proceeding:
   ```bash
   OTEL_CSV_NAME=$(oc get csv -n opentelemetry-operator | grep "opentelemetry-operator" | awk '{print $1}')
   # Use oc patch csv $OTEL_CSV_NAME --type=json to add env vars via:
   # {"op":"add","path":"/spec/install/spec/deployments/0/spec/template/spec/containers/0/env/-","value":{"name":"<ENV>","value":"<VALUE>"}}
   ```
   **Patch A** — target allocator and OpAMP bridge: `RELATED_IMAGE_TARGET_ALLOCATOR=${TARGETALLOCATOR_IMG}`, `RELATED_IMAGE_OPERATOR_OPAMP_BRIDGE=${OPERATOROPAMPBRIDGE_IMG}`
   **Patch B** — metadata filters: `ANNOTATIONS_FILTER=.*filter.out,config.*.gke.io.*`, `LABELS_FILTER=.*filter.out`
   **Patch C** — auto-instrumentation images: `RELATED_IMAGE_AUTO_INSTRUMENTATION_JAVA`, `_NODEJS`, `_PYTHON`, `_DOTNET`, `_APACHE_HTTPD` using the exported `INSTRUMENTATION_*_IMG` vars
8. Determine sidecar selector based on OCP version:
   ```bash
   oc_version_minor=$(oc get clusterversion version -o jsonpath='{.status.desired.version}' 2>/dev/null | cut -d . -f 2 || true)
   selector="sidecar=legacy"
   if [[ -n "$oc_version_minor" ]] && [[ "$oc_version_minor" -ge 16 ]]; then selector="sidecar=native"; fi
   ```
9. Run test suites in order, applying CSV patches between groups:
    - After Patch A: `chainsaw test tests/e2e tests/e2e-autoscale tests/e2e-crd-validations tests/e2e-openshift tests/e2e-instrumentation tests/e2e-pdb tests/e2e-opampbridge tests/e2e-otel tests/e2e-multi-instrumentation tests/e2e-targetallocator-cr tests/e2e-targetallocator`
    - Sidecar/PrometheusCR (with selector): `chainsaw test --selector "$selector" tests/e2e-prometheuscr tests/e2e-sidecar`
    - After Patch B: `chainsaw test tests/e2e-metadata-filters`
    - After Patch C: `chainsaw test tests/e2e-instrumentation tests/e2e-multi-instrumentation`
