---
name: otel-openshift-ci
description: Use when working with OpenShift CI (Prow, ci-operator, app.ci) - reading the logs, artifacts, JUnit results or run history of a CI job or a pull request check, finding why a Prow job failed, or pulling an image from OpenShift CI, such as a promoted image (ocp/builder:rhel-9-golang-*, registry.ci.openshift.org, quay-proxy.ci.openshift.org), a pipeline image a job built in its ci-op namespace, or an OpenShift release payload and its component images.
---

# OpenShift CI job logs and images

Reading the logs of OpenShift CI jobs and pulling CI images works the same for every repository in OpenShift CI; the references use the OpenTelemetry repositories as examples. Running the OpenTelemetry e2e matrix of a release and posting its results is `/otel-qe-ocp-ci-tests`.

## Log in to app.ci

Everything except the logs of public jobs, the pipeline images and released OpenShift payloads needs an OAuth token of the `app.ci` cluster (a ServiceAccount token does not work):

1. The user opens https://oauth-openshift.apps.ci.l2s4.p1.openshiftapps.com/oauth/token/request, signs in with Red Hat SSO and runs the `oc login` command it shows. The token is theirs: never ask for it or print it.
2. `oc whoami` prints their user. When the current context is another cluster, add `--context <app.ci context>` (`oc config get-contexts -o name | grep api-ci-l2s4`) to every `oc whoami` below. A 401 or 403 later means the token expired: repeat step 1.

Pass the token on stdin, so it stays out of `ps` and the shell history:

```bash
printf 'Authorization: Bearer %s\n' "$(oc whoami -t)" | curl -sf -H @- <url>
oc whoami -t | podman login -u "$(oc whoami)" --password-stdin quay-proxy.ci.openshift.org
```

## Pick the reference

| Need | Read |
|---|---|
| Logs, artifacts, JUnit results or run history of a job or PR check; why a job failed | [references/logs-and-artifacts.md](references/logs-and-artifacts.md) |
| An image CI keeps under a name: a builder image such as `ocp/builder:rhel-9-golang-1.26-openshift-5.0`, an OpenShift release image, an image a postsubmit promoted | [references/images.md](references/images.md), "Promoted images" |
| An image a job built for a PR (`pipeline:<image>`) | [references/images.md](references/images.md), "Pipeline images" |
| An OpenShift release payload or one of its component images (`ocp/release:4.22.0-0.nightly-*`, a CI payload) | [references/images.md](references/images.md), "OpenShift release payloads" |

## Common mistakes

| Mistake | Fix |
|---|---|
| Looking for a job on public Prow or in Sippy when its repository reports to a private deck | The host of the check's Details link on the PR tells which deck (references/logs-and-artifacts.md, "Where a job reports") |
| `registry.ci.openshift.org` answers `name unknown` for a promoted image | The image is only in QCI: pull it through `quay-proxy.ci.openshift.org` |
| A component image of a nightly payload answers `not authorized` with the app.ci token | Nightly components are ART builds in `quay.io/openshift-release-dev/ocp-v4.0-art-dev`: use a quay.io pull secret with access to it, or a CI-built payload |
| Pulling a pipeline image of a job that ended hours ago | Its `ci-op-*` namespace is gone, 1 hour after its last pod: rerun a job of the PR, or copy the image while the namespace exists |
| `podman pull $IMG:latest` in zsh pulls a mangled name | zsh reads `:l`, `:u` and other letters after `$IMG` as modifiers: write `"${IMG}:latest"` |
| The pulled image is arm64 on an Apple Silicon Mac | Add `--platform linux/amd64` to `podman pull` |
