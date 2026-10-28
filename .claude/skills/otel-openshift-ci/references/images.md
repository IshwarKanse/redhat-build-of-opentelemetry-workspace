# Pulling OpenShift CI images

OpenShift CI has three kinds of images, pulled in different ways:

| Kind | Example | Pull from | Login |
|---|---|---|---|
| Promoted: tags of app.ci imagestreams, stored in QCI | `ocp/builder:rhel-9-golang-1.26-openshift-5.0`, `ci/redhat-opentelemetry-collector:redhat-otel-collector` | `quay-proxy.ci.openshift.org/openshift/ci:<namespace>_<name>_<tag>` | app.ci token |
| Pipeline: built by a job in its own namespace | `pipeline:opentelemetry-operator` of a PR | `registry.<build-cluster>.ci.openshift.org/ci-op-<id>/pipeline:<image>` | none, while the namespace exists |
| OpenShift release payload and its component images | `ocp/release:4.22.0-0.nightly-2026-10-28-171417` | depends on the payload | see "OpenShift release payloads" |

On an Apple Silicon Mac, `podman pull` takes the arm64 image of a multi-arch tag; add `--platform linux/amd64` for the amd64 one. To look without pulling, `skopeo inspect --raw docker://<image>` lists the architectures of a manifest list.

## Promoted images

Images CI keeps under a stable name: the Go builder images that jobs use as their build root (`ocp/builder:rhel-9-golang-*`), the images of an OpenShift release (`ocp/<version>:<component>`), and the images a postsubmit promoted. ART's builds of layered products such as the Red Hat build of OpenTelemetry are not in CI: an "ART image" of such a product in CI is one that CI built from the repository's ART Dockerfiles. (OpenShift itself differs: its nightly payloads are ART builds, see "OpenShift release payloads".) The collector's `rhosdt-<version>` postsubmit builds `Dockerfile.art` of the branch and promotes it as `ci/redhat-opentelemetry-collector:redhat-otel-collector`. The operator's `art-build` jobs build `Dockerfile.art` and `Dockerfile.ta.art` of the PR as pipeline images (see "Pipeline images").

Promoted images are stored in QCI, `quay.io/openshift/ci`, which takes its own robot credentials and refuses anonymous reads; `quay-proxy.ci.openshift.org` serves the same repository to anyone with an app.ci token.

1. Get an app.ci token: open https://oauth-openshift.apps.ci.l2s4.p1.openshiftapps.com/oauth/token/request, sign in with Red Hat SSO and run the `oc login` command it shows (SKILL.md, "Log in to app.ci", has the details). Then log in to quay-proxy with it:
   ```bash
   oc whoami -t | podman login -u "$(oc whoami)" --password-stdin quay-proxy.ci.openshift.org
   ```
2. Write `<namespace>/<name>:<tag>` as the QCI tag `<namespace>_<name>_<tag>` and pull it (add `--platform linux/amd64` on an Apple Silicon Mac for the amd64 image). The Go builder image of the OpenShift 5.0 branch, `ocp/builder:rhel-9-golang-1.26-openshift-5.0`:
   ```bash
   podman pull quay-proxy.ci.openshift.org/openshift/ci:ocp_builder_rhel-9-golang-1.26-openshift-5.0
   ```
   Dots stay as they are: `ocp/4.22:cli` is `openshift/ci:ocp_4.22_cli`.

`registry.ci.openshift.org/<namespace>/<name>:<tag>` serves the same image (log in to it the same way) as long as the imagestream exists on app.ci, which `oc -n <namespace> get istag <name>:<tag>` shows. Some promoted images are only in QCI: `registry.ci.openshift.org/ci/redhat-opentelemetry-collector:redhat-otel-collector` answers `name unknown`, while `quay-proxy.ci.openshift.org/openshift/ci:ci_redhat-opentelemetry-collector_redhat-otel-collector` works. Prefer quay-proxy.

### Finding the name of an image

- **The inputs of a job.** The ci-operator log of a run (the top-level `build-log.txt`, see [logs-and-artifacts.md](logs-and-artifacts.md)) prints one line per base and builder image, e.g. `Tagging ocp/builder:rhel-9-golang-1.26-openshift-5.0 into pipeline:root`, or, for a `FROM` image of a Dockerfile, `Detected base image, will tag into pipeline:ocp_builder_rhel-9-golang-1.26-openshift-5.0` (the alias is the QCI tag of the image). The same names are under `build_root` and `base_images` of the ci-operator config.
- **What a repository promotes.** The `promotion.to` stanza of its ci-operator config, `ci-operator/config/<org>/<repo>/<org>-<repo>-<branch>[__<variant>].yaml` in `openshift/release`, applies to every `to: <image>` of its `images` list:
  - `namespace: N` and `tag: T` give `N/<image>:T`. The collector config of `rhosdt-0.158` promotes `ci/redhat-opentelemetry-collector:redhat-otel-collector`, pulled as `quay-proxy.ci.openshift.org/openshift/ci:ci_redhat-opentelemetry-collector_redhat-otel-collector`.
  - `namespace: N` and `name: S` give `N/S:<image>`, as the OpenShift release images `ocp/4.22:cli`.

  The postsubmit `branch-ci-<org>-<repo>-<branch>-images` promotes on every push to the branch; until it has run once, the tag does not exist.

## Pipeline images

Every image a job builds is a tag of the `pipeline` imagestream in the job's namespace (`ci-op-<id>`) on a build-farm cluster: `src`, `bin` and `root`, plus one tag per image of the config (`opentelemetry-operator`, `opentelemetry-bundle`, `obs-tests-runner`, ...). The jobs of one PR commit and config variant share that namespace, so it holds the images of all of them.

1. Find the namespace, the build cluster and the digests in the ci-operator log of a run (the top-level `build-log.txt`, see [logs-and-artifacts.md](logs-and-artifacts.md)):
   ```
   Using namespace https://console-openshift-console.apps.build06.ci.devcluster.openshift.com/k8s/cluster/projects/ci-op-c4x8zn64
   Image ci-op-c4x8zn64/pipeline:opentelemetry-operator created  digest=sha256:229619bb...
   ```
   The build cluster (`build06`) is also `spec.cluster` of the run's `prowjob.json`. Its registry is `registry.<cluster>.ci.openshift.org` (seen for `build06` and `build11`); when a step of the job prints a full pull spec, as the OpenTelemetry operator's e2e steps do (below), use that host.
2. Pull by tag, or by the digest of the log line:
   ```bash
   podman pull registry.build06.ci.openshift.org/ci-op-c4x8zn64/pipeline:opentelemetry-operator
   ```
   The e2e steps of the OpenTelemetry operator also print the exact pull spec of the images under test: `Operator image under test: registry.build06.ci.openshift.org/ci-op-c4x8zn64/pipeline@sha256:...`.

No login is needed once a job of the namespace has run the `ipi-install-rbac` step, which the cluster install and cluster claim workflows run before their tests (seen in the OpenTelemetry operator and kueue-operator e2e jobs). It grants `system:image-puller` on the namespace to `system:unauthenticated`, so that the test cluster can pull the images; from then on every pipeline image of the namespace is readable, those of the `images` job included. A namespace whose jobs never ran it (only unit or image jobs) is not readable that way. A pull that fails once with a manifest error right after an image was created can work on the second try.

The namespace exists while a job of the PR commit runs. It is deleted when no pod has run in it for 1 hour, or 72 hours after its creation, whichever comes first (the ci-operator defaults, `--delete-when-idle` and `--delete-after`; the OTel jobs keep them). After that the pull fails. To get the images again, rerun a job of the PR (`/test <job>`); to keep one, copy it with all its architectures to your own repository while the namespace exists (`skopeo copy --all docker://registry.build06.ci.openshift.org/ci-op-c4x8zn64/pipeline:opentelemetry-operator docker://quay.io/<user>/<repo>:<tag>`).

## OpenShift release payloads

A release payload is the image that lists every component image of one OpenShift version. The release controller gives the newest payload of a stream: `curl -s https://amd64.ocp.releases.ci.openshift.org/api/v1/releasestream/4.22.0-0.nightly/latest` returns its `pullSpec` (`arm64.ocp.releases.ci.openshift.org` for arm64). The ci-operator log of a job names the payload it used: `Resolved release latest to registry.ci.openshift.org/ocp/release:4.22.0-0.nightly-2026-10-27-151330`.

| Payload | Example | Access |
|---|---|---|
| CI build (`4.22.0-0.ci` stream), built by CI | `quay-proxy.ci.openshift.org/openshift/ci:rc_payload__4.22.0-0.ci-2026-10-28-210839` | the payload and its components through quay-proxy with the app.ci token |
| Nightly (`4.22.0-0.nightly` stream), built by ART | `registry.ci.openshift.org/ocp/release:4.22.0-0.nightly-2026-10-28-171417` | the payload with the app.ci token; its components are in `quay.io/openshift-release-dev/ocp-v4.0-art-dev`, which refuses the app.ci token and needs a quay.io pull secret with access to that repository |
| Released version | `quay.io/openshift-release-dev/ocp-release:4.22.20-x86_64` | the payload without a login |

`oc adm release info <payload>` reads a payload: `--image-for=<component>` prints the pull spec of one component (e.g. `cli`), `--pullspecs` lists them all. It takes its registry logins from `-a <file>`; write one without Podman with `oc registry login --registry=registry.ci.openshift.org --to=<file>` (run it again with `--registry=quay-proxy.ci.openshift.org` for a CI payload).
