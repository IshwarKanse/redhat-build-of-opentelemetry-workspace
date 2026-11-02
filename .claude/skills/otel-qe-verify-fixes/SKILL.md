---
name: otel-qe-verify-fixes
description: Verify the CVE and bug fixes of an OpenTelemetry release on the ART build that ships them. Use when the user asks to verify CVE or bug fixes for a release, a Jira fix version (e.g. rhosdt-3.11.4) or an ART build of the operator (e.g. 0.158).
---

# Verify CVE and Bug Fixes

Verify that the CVE and bug fixes of a release are actually fixed in the ART build that ships them. Only the ART build counts: an upstream build, a pull request build or an old image tagged `rhosdt-3.x` says nothing about what the release contains.

## Dependencies

- **`atlassian` plugin** (Atlassian MCP server, install from the `claude-plugins-official` marketplace) — required for looking up Jira issues and posting verification results/comments back to Jira. If it isn't installed or authenticated, tell the user and pause rather than skipping the Jira steps silently.
- **`get-fbc-images.sh` and `get-fbc-content.sh`** from `/otel-art-reference` — need `curl`, `jq`, `skopeo`, `oras` (`brew install oras`), `python3` with PyYAML, and a login to `registry.stage.redhat.io` for the images that are not released yet.

## Steps

1. **Ask the user** for the ART version (the operator version, e.g. `0.158`) and the fixes to verify if not already specified. The fixes of a release are the TRACING issues of its Jira fix version, e.g. `project = TRACING AND fixVersion = "rhosdt-3.11.4"`; keep the ones of the OpenTelemetry images (the `rhosdt/tempo-*` trackers belong to Tempo).

2. **Pick the build:**
   - **The next release:** the latest ART build, `bash .claude/skills/otel-art-reference/get-fbc-images.sh <version>`, or the build of one operator commit when the user names it, `bash .claude/skills/otel-art-reference/get-fbc-images.sh <version> <commit>`. The floating tag moves with every new build, so from here on use only `image_by_digest`. Give the `pullspecs` line to whoever runs the release: the release has to ship these digests (`FBC_PULLSPECS` in `RELEASE.md` of `/otel-art-reference`), or the verification does not apply to it. Once the shipment merge request of the release exists, check that its FBC images are these digests.
   - **A released build:** ask the user for the image tag of the release (e.g. `v0.158.0-3`) if not already given: the Jira fix version does not say which build it is. Take the operator commit from that image, then list the FBCs of that commit:
     ```bash
     skopeo inspect --no-tags --override-os linux --override-arch amd64 docker://registry.redhat.io/rhosdt/opentelemetry-rhel9-operator:<tag> | jq -r '.Labels["io.openshift.build.commit.id"]'
     bash .claude/skills/otel-art-reference/get-fbc-images.sh <version> <commit>
     ```
     ART re-pushes these tags when it rebuilds from the same commit, so check in step 3 that the operator, collector and target allocator digests are the ones of `registry.redhat.io/rhosdt/<image>:<tag>` (`skopeo inspect --no-tags --override-os linux --override-arch amd64 docker://registry.redhat.io/rhosdt/<image>:<tag> | jq -r .Digest` gives the digest of the image index, as in the FBC). If one differs, stop and ask the user for the FBC images of the release (the shipment merge request in `hybrid-platforms/art/ocp-shipment-data` lists them).

3. **List the images of the build** from one of its FBCs (all of them carry the same bundle):
   ```bash
   bash .claude/skills/otel-art-reference/get-fbc-content.sh <image_by_digest>
   ```
   `related_images` has the operator, collector and target allocator images by digest, each with the `commit_url` of the commit it was built from. The images are named on `registry.redhat.io`; until the release they exist only on `registry.stage.redhat.io`.

4. **For each bug fix**, show that the fix is in the build, then that it works:
   - Look up the Jira issue (via the `atlassian` plugin's `getJiraIssue`, `cloudId: redhat.atlassian.net`, with `view: "evidence"`: the fix is usually only in the `Git Pull Request` field) to understand what was fixed, and find the fix commit from the PR.
   - **In the build:** take the commit from the `commit_url` of the image that has the fixed code, and check that the fix commit is an ancestor of it in that repository (`redhat-opentelemetry-collector` or `open-telemetry-opentelemetry-operator`, from `make clone-repos`):
     ```bash
     git -C <repo> fetch origin
     git -C <repo> merge-base --is-ancestor <fix commit> <image commit>; echo "exit $?"    # 0: included
     ```
     Exit 1 is not proof on its own: a backport to the product branch has a different SHA, so read the changed lines at the image commit. An open PR is in no build. A fix that came with a dependency bump is checked in `go.mod` at the image commit instead (`_build/go.mod` for the collector).
   - **If the fix is not in the build,** stop for this issue: report it as not in this build, with the evidence, and do not install anything for it.
   - **It works:** install this build with `/otel-qe-deploy-stage-build`, using the `image_by_digest` for the cluster's OCP version as `OTEL_FBC_IMAGE`, and reproduce the scenario from the bug. When no test cluster is available, report the fix as not verified on a cluster instead of passing it on the commit check alone.
   - Update the Jira issue with the result, naming the build (the FBC digest and the image commit) (via `addOrEditJiraIssueComment`/`editJiraIssue`).

5. **For each CVE**, run `/otel-cve-resolver <CVE ID> --fbc <image_by_digest>` so that the images of this build are the ones analyzed. The CVE is addressed when the verdict is `Fixed`, `Not present` or `False positive`; `Affected` means that this build does not fix it.

6. **Report results**: Summarize which fixes were verified on which build, which need attention, and update the relevant Jira issues.
