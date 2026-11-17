---
name: otel-openshift-ci
description: Use when working with OpenShift CI (Prow, ci-operator, app.ci) - reading the logs, artifacts, JUnit results or run history of a CI job or a pull request check, finding why a Prow job failed, or pulling an image from OpenShift CI, such as a promoted image (ocp/builder:rhel-9-golang-*, registry.ci.openshift.org, quay-proxy.ci.openshift.org), a pipeline image a job built in its ci-op namespace, or an OpenShift release payload and its component images.
---

# OpenShift CI job logs and images

Reading the logs of OpenShift CI jobs and pulling CI images works the same for every repository in OpenShift CI; the references use the OpenTelemetry repositories as examples. Running the OpenTelemetry e2e matrix of a release and posting its results is `/otel-qe-ocp-ci-tests`.

## Log in to app.ci

The private QE deck and the CI registries (everything except the logs of public jobs, the pipeline images and released OpenShift payloads) need an OAuth token of the `app.ci` cluster (a ServiceAccount token does not work):

1. The user opens https://oauth-openshift.apps.ci.l2s4.p1.openshiftapps.com/oauth/token/request, signs in with Red Hat SSO and runs the `oc login` command it shows. The token is theirs: never ask for it or print it.
2. `oc whoami` prints their user. When the current context is another cluster, add `--context <app.ci context>` (`oc config get-contexts -o name | grep api-ci-l2s4`) to every `oc whoami` below. A 401 or 403 later means the token expired: repeat step 1.

For pulling images, pass the token on stdin, so it stays out of `ps` and the shell history:

```bash
oc whoami -t | podman login -u "$(oc whoami)" --password-stdin quay-proxy.ci.openshift.org
```

## The openshift-ci MCP server

This skill depends on the openshift-ci MCP server ([openshift-eng/openshift-ci-mcp](https://github.com/openshift-eng/openshift-ci-mcp)), v0.6.0 or newer. Read job history, runs, step logs and artifacts with its tools: `get_prow_job_history`, `get_prow_job_run`, `get_prow_artifacts` and `get_prow_artifact_content`. They work the same for public runs and for the private QE deck; [references/logs-and-artifacts.md](references/logs-and-artifacts.md) maps each need to a tool call.

Read CI job data (runs, logs, artifacts, history) only through these tools. **If they are not available, stop and ask the user to install the server** with the steps below, and continue once it is installed; do not install or register it for them, and do not read the data another way.

The user installs it once, either with Go 1.25.9 or newer (an older Go downloads that toolchain unless `GOTOOLCHAIN=local`):
```bash
claude mcp add --scope user openshift-ci -- go run github.com/openshift-eng/openshift-ci-mcp/cmd/openshift-ci-mcp@v0.6.0
```
or with the release binary of [v0.6.0](https://github.com/openshift-eng/openshift-ci-mcp/releases/tag/v0.6.0) for their platform (`darwin` or `linux`, `amd64` or `arm64`; the example is for Apple Silicon):
```bash
gh release download v0.6.0 --repo openshift-eng/openshift-ci-mcp --pattern 'openshift-ci-mcp-darwin-arm64' --dir ~/.local/bin
chmod +x ~/.local/bin/openshift-ci-mcp-darwin-arm64
claude mcp add --scope user openshift-ci -- ~/.local/bin/openshift-ci-mcp-darwin-arm64
```
In Codex, they register the same command as an MCP server named `openshift-ci` in the Codex configuration. The server then appears in new sessions. With the Go route the first start compiles it (about 20 seconds, longer when Go downloads its toolchain) and can time out; the next session starts it from the build cache.

**Private deck:** the server reads `OPENSHIFT_CI_TOKEN` when it starts. The user logs in to app.ci (above) and exports the token in the shell they start Claude Code or Codex from: `export OPENSHIFT_CI_TOKEN="$(oc whoami -t)"`. A 401 from a tool that names `OPENSHIFT_CI_TOKEN` means the token is missing or expired: they refresh the variable and restart the session (or the server). Public runs need no token.

What the server cannot read: runs on `deck-internal-ci` (`origin-ci-private`), which this skill does not cover; the run-level files of a job while it runs (`get_prow_job_run` reports `state: running`, and each step's own directory appears as that step ends, references/logs-and-artifacts.md); and a whole file over 1 MiB, such as `ci-operator-step-graph.json` (use `failed_steps` of `get_prow_job_run`; `tail_lines` and `grep` work on larger files).

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
