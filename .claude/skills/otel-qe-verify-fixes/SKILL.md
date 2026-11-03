---
name: otel-qe-verify-fixes
description: Verify the CVE and bug fixes of an OpenTelemetry release on the ART build to release, before that build is released to prod (registry.redhat.io), or on a build already on prod when asked. Use when the user asks to verify CVE or bug fixes for a release, a Jira fix version (e.g. rhosdt-3.11.4) or an ART build of the operator (e.g. 0.158).
---

# Verify CVE and Bug Fixes

Verify that the CVE and bug fixes of a release are actually fixed in the ART build to release, **before** that build is released to prod (`registry.redhat.io`, the `trigger-prod-release` step in `RELEASE.md` of `/otel-art-reference`). Every release that carries fixes needs this check: a fix that turns out to be missing or broken after the prod release needs a new build and a new release. When someone asks, the same steps also check a build that is already on prod (step 2). Only the ART build counts: an upstream build, a pull request build or an old image tagged `rhosdt-3.x` says nothing about what the release contains.

## Dependencies

- **`atlassian` plugin** (Atlassian MCP server, install from the `claude-plugins-official` marketplace) — required for looking up Jira issues and posting verification results/comments back to Jira. If it isn't installed or authenticated, tell the user and pause rather than skipping the Jira steps silently.
- **`get-fbc-images.sh` and `get-fbc-content.sh`** from `/otel-art-reference` — need `curl`, `jq`, `skopeo`, `oras` (`brew install oras`), `python3` with PyYAML, and a login to `registry.stage.redhat.io`, where the images are until the prod release.
- **`glab`** logged in to `gitlab.cee.redhat.com` (VPN) — for the shipment merge request of the release.

## Steps

1. **Ask the user** for the ART version (the operator version, e.g. `0.158`) and the fixes to verify if not already specified. The fixes of a release are the TRACING issues of its Jira fix version, e.g. `project = TRACING AND fixVersion = "rhosdt-3.11.4"`; keep the ones of the OpenTelemetry images (the `rhosdt/tempo-*` trackers belong to Tempo). The issues passed as `jira-bugs` to `release-from-fbc` go into the advisory, so verify any of them that are missing from the fix version too. Also ask whether the release is the next one or already on prod, unless the user said so: Jira can show a fix version as unreleased after it shipped (`rhosdt-3.11.4` did). A release is on prod when its shipment merge request, "Shipment for openshift-opentelemetry-operator <assembly>", is merged (`RELEASE.md` of `/otel-art-reference` shows how to find it).

2. **Pick the build:**
   - **The build to release** (the normal case): the latest ART build, `bash .claude/skills/otel-art-reference/get-fbc-images.sh <version>`, or the build of one operator commit when the user names it, `bash .claude/skills/otel-art-reference/get-fbc-images.sh <version> <commit>`. The floating tag moves with every new build, so from here on use only `image_by_digest`. The release has to ship the build you verify: give the `pullspecs` line to whoever runs the release (`FBC_PULLSPECS` of `release-from-fbc` in `RELEASE.md`). Right before `trigger-prod-release`, the FBC images of the merge request it is given must be these digests (the command is in "Run `trigger-prod-release` pipeline" of `RELEASE.md`). If they differ, the release ships another build: verify that one, with the FBC digests from the merge request, before the prod release.
   - **A build already on prod**, only when the user asks for it (for example to check what a past release contains). A fix that fails here needs a new build and release. Ask for the image tag of the release (e.g. `v0.158.0-3`) if not already given: the Jira fix version does not say which build it is. Take the operator commit from that image, then list the FBCs of that commit:
     ```bash
     skopeo inspect --no-tags --override-os linux --override-arch amd64 docker://registry.redhat.io/rhosdt/opentelemetry-rhel9-operator:<tag> | jq -r '.Labels["io.openshift.build.commit.id"]'
     bash .claude/skills/otel-art-reference/get-fbc-images.sh <version> <commit>
     ```
     ART re-pushes these tags when it rebuilds from the same commit, so check in step 3 that the operator, collector and target allocator digests are the ones of `registry.redhat.io/rhosdt/<image>:<tag>` (`skopeo inspect --no-tags --override-os linux --override-arch amd64 docker://registry.redhat.io/rhosdt/<image>:<tag> | jq -r .Digest` gives the digest of the image index, as in the FBC). If one differs, use the FBC images that the shipment merge request of the release lists instead (the command is in "Run `trigger-prod-release` pipeline" of `RELEASE.md`), and ask the user if there is none.

3. **List the images of the build** from one of its FBCs (all of them carry the same bundle):
   ```bash
   bash .claude/skills/otel-art-reference/get-fbc-content.sh <image_by_digest>
   ```
   `related_images` has the operator, collector and target allocator images by digest, each with the `commit_url` of the commit it was built from. The images are named on `registry.redhat.io`; until the prod release they exist only on `registry.stage.redhat.io`.

4. **For each bug fix**, show that the fix is in the build, then that it works:
   - Look up the Jira issue (via the `atlassian` plugin's `getJiraIssue`, `cloudId: redhat.atlassian.net`, with `view: "evidence"`: the fix is usually only in the `Git Pull Request` field) to understand what was fixed, and find the fix commit from the PR.
   - **In the build:** take the commit from the `commit_url` of the image that has the fixed code, and check that the fix commit is an ancestor of it in that repository (`redhat-opentelemetry-collector` or `open-telemetry-opentelemetry-operator`, from `make clone-repos`):
     ```bash
     git -C <repo> fetch origin
     git -C <repo> merge-base --is-ancestor <fix commit> <image commit>; echo "exit $?"    # 0: included
     ```
     Exit 1 is not proof on its own: a backport to the product branch has a different SHA, so read the changed lines at the image commit. An open PR is in no build. A fix that came with a dependency bump is checked in `go.mod` at the image commit instead (`_build/go.mod` for the collector).
   - **If the fix is not in the build,** stop for this issue: report it as not in this build, with the evidence, and do not install anything for it (step 6).
   - **It works:** install this build with `/otel-qe-deploy-stage-build`, using the `image_by_digest` for the cluster's OCP version as `OTEL_FBC_IMAGE`, and reproduce the scenario from the bug. When no test cluster is available, report the fix as not verified on a cluster instead of passing it on the commit check alone.
   - Update the Jira issue with the result, naming the build (the FBC digest and the image commit) (via `addOrEditJiraIssueComment`/`editJiraIssue`).

5. **For each CVE**, run `/otel-cve-resolver <CVE ID> --fbc <image_by_digest>` so that the images of this build are the ones analyzed. The CVE is addressed when the verdict is `Fixed`, `Not present` or `False positive`; `Affected` means that this build does not fix it (step 6).

6. **Report results**: which fixes were verified on which build (its `pullspecs`), and which are missing, failed or not verified (no cluster counts as not verified). Update the relevant Jira issues. For the build to release, report before the prod release: any fix that is not verified stops `trigger-prod-release` while the release claims it. Tell the user the two ways on, and do neither yourself: wait for a build with the fix and verify that build, or take the issue out of the release (its Jira fix version and the `jira-bugs` of `release-from-fbc`, which then runs again with `force: true`).
