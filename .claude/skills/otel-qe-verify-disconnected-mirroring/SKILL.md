---
name: otel-qe-verify-disconnected-mirroring
description: Validate that an OTEL/Tempo operator CSV declares every image it needs in spec.relatedImages, pinned by digest, so disconnected/air-gapped mirroring (oc-mirror + ImageContentSourcePolicy) will work. Use when the user asks to verify disconnected/air-gapped mirroring readiness, check relatedImages completeness, or wants a fast pre-check before running the full distributed-tracing-qe disconnected CI job or whenever the bundle CSV changes.
---

# Verify Disconnected Mirroring Readiness

Disconnected/air-gapped clusters can only pull images that were mirrored ahead of time.
`oc-mirror` (and OLM more generally) does not introspect Deployment env vars or the images a CR
might default to — it mirrors exactly what's listed in a CSV's `spec.relatedImages`, pinned by
digest. Red Hat's OTel/Tempo operators rely on `RELATED_IMAGE_*` env vars (e.g.
`RELATED_IMAGE_COLLECTOR`, `RELATED_IMAGE_TARGET_ALLOCATOR`) matching `relatedImages` entries
exactly, so the operator resolves the mirrored digest instead of a hardcoded upstream tag.

This skill checks that invariant directly against a CSV — no disconnected cluster or mirror
registry required — in seconds.

## Dependencies

- **`otel-qe-deploy-stage-build`** skill — typical predecessor when validating a live cluster: it installs
  the OTEL/Tempo operators, producing the installed CSVs this skill then checks. Not required if
  you're validating a bundle image directly (no cluster involved).
- **`atlassian` plugin** (Atlassian MCP server, install from the `claude-plugins-official`
  marketplace) — required for posting the summary comment to the Jira disconnected-test tracker
  in step 4. If it isn't installed or authenticated, tell the user and still print the summary,
  just skip the Jira comment rather than failing silently.
- `oc`, `yq`, `jq`, and `skopeo` — should already be on the machine (verify with
  `command -v oc yq jq skopeo`).

## What the full disconnected CI job does (for context)

`openshift/distributed-tracing-qe`'s `ocp-4.16-disconnected` job (config:
`release/ci-operator/config/openshift/distributed-tracing-qe/openshift-distributed-tracing-qe-main__ocp-4.16-disconnected.yaml`
in the separate `openshift/release` repo — see "Reference files" below)
does three things via `cucushift-installer-rehearse-gcp-ipi-disconnected`:

1. `distributed-tracing-install-disconnected` — runs `oc-mirror --v1` against the OTEL/Tempo IIB
   images, mirroring the index, bundle, and every `spec.relatedImages` entry, then applies the
   generated `ImageContentSourcePolicy` + `CatalogSource`.
2. `install-operators` — installs the operators from the mirrored catalog sources.
3. `distributed-tracing-tests-disconnected` — runs chainsaw e2e tests to confirm collector pods
   actually come up.

That job is the authoritative end-to-end gate (real oc-mirror/ICSP mechanics, real CR pull
behavior), but it's expensive and only runs periodically (`cron: 0 0 30 2 *`). This skill is a
lightweight substitute for the specific, common-case failure that job exists to catch: an image
the operator needs that isn't declared in `spec.relatedImages`. It does **not** replace the full
job — see "What this does not cover" below.

## Steps

1. **Pick a source for the CSV.** Ask the user if it isn't already clear from context:
   - **Live cluster** (fastest — use this right after `otel-qe-deploy-stage-build` or any manual install).
     Discover the namespace and CSV name together first (avoids guessing a namespace):
     ```bash
     oc get csv -A | grep -i -E 'opentelemetry|tempo'
     oc get csv <csv-name> -n <namespace> -o yaml > /tmp/csv.yaml
     ```
   - **A specific bundle image / release** (validates a build without needing a cluster):
     1. Resolve the bundle image digest from the **stage** release-payload snapshot:
        `konflux/release-payloads/otel-stage-<version>.yaml` (or `tempo-stage-<version>.yaml`),
        under `spec.components[] | select(.name == "otel-bundle-main").containerImage` (or
        `tempo-bundle-main`). The `*-prod-*.yaml` files are Release *requests* and don't carry a
        `spec.components` snapshot until they're actually released — use the stage file.
     2. Extract the CSV from that bundle image using the same skopeo-copy + untar approach as
        `konflux-opentelemetry/scripts/validate-bundle-sdk.sh` (a separate repo — see "Reference
        files" below; look at its `skopeo copy` / blob-extraction steps): copy the image to an OCI dir, untar the
        gzip blobs, then read `manifests/*.clusterserviceversion.yaml` from the extracted tree.
        That script itself execs straight into `operator-sdk bundle validate` and doesn't leave a
        reusable CSV file behind, so extract the CSV yourself using its approach rather than
        invoking the script for this step — the script is still useful as-is for the separate
        official-validator check in "Optional deeper verification" below.

2. **Run the digest/relatedImages check**:
   ```bash
   bash .claude/skills/otel-qe-verify-disconnected-mirroring/check-related-images.sh /tmp/csv.yaml
   ```
   This fails if:
   - `spec.relatedImages` is empty.
   - Any `relatedImages` entry isn't pinned by digest (`@sha256:...`).
   - Any container `image` or image-shaped env var value (e.g. `RELATED_IMAGE_COLLECTOR`) in the
     CSV's deployments isn't declared verbatim in `spec.relatedImages`.
   It warns (non-fatal) if the `features.operators.openshift.io/disconnected: "true"` annotation
   is missing.

3. **Report** a clear pass/fail summary to the user, including the CSV name/version validated
   and the source (live cluster vs. bundle image).

## Recording the result in Jira

After reporting the summary, ask the user for the Jira tracker for the disconnected test (a
`TRACING-XXXX` issue). If they give one, post the pass/fail summary as a comment on that issue via
the `atlassian` plugin's `addCommentToJiraIssue` (`cloudId: redhat.atlassian.net`). Skip this
(after telling the user) if they have no tracker to hand or the `atlassian` plugin isn't
available — it's a record-keeping nice-to-have, not a condition for the check itself passing or
failing.

## Optional deeper verification

- **Bundle image only** (not a live-cluster CSV): also run the existing official validator for
  extra confidence — this is the same gate Konflux CI runs before a bundle can be released, so
  this skill and the release pipeline will never disagree:
  ```bash
  BUNDLE_IMAGE=<bundle-image>@sha256:<digest> \
    bash konflux-opentelemetry/scripts/validate-bundle-sdk.sh
  ```
  (Requires a `microdnf`-based environment per that script, or adapt to `skopeo`/`operator-sdk`
  being available locally — see the script for what it installs.)

- **Staleness check**: confirm each `relatedImages` digest is still pullable (Konflux
  `quay.io/redhat-pending/...` staging refs can expire before a real mirror run):
  ```bash
  skopeo inspect docker://<image>@sha256:<digest> >/dev/null && echo OK || echo STALE
  ```

## What this does not cover

- Whether `oc-mirror` + generated `ImageContentSourcePolicy`/`CatalogSource` actually succeed
  against a real mirror registry (auth, connectivity, ICSP propagation to nodes, CatalogSource
  reaching `READY`).
- Whether the test-only `additionalImages` (minio, telemetrygen, tempo test-utils — see the
  `ImageSetConfiguration` in `distributed-tracing-install-disconnected-commands.sh`) are mirrored;
  those matter for the QE test suite, not the product operator itself.
- Runtime behavior beyond "image pulls" (e.g. whether the collector functions once running).

For those, run the full `distributed-tracing-tests-disconnected` disconnected CI job.

## Reference files

These all live in **separate repos** cloned alongside this workspace (see the top-level
`README.md`), not in this repo — so they're plain paths below, not links:

- CI job (in `openshift/release`): `ci-operator/config/openshift/distributed-tracing-qe/openshift-distributed-tracing-qe-main__ocp-4.16-disconnected.yaml`
- Install step (in `openshift/release`): `ci-operator/step-registry/distributed-tracing/install/disconnected/distributed-tracing-install-disconnected-commands.sh`
- Test step (in `openshift/release`): `ci-operator/step-registry/distributed-tracing/tests/disconnected/distributed-tracing-tests-disconnected-commands.sh`
- Konflux bundle validator (in `os-observability/konflux-opentelemetry`): `scripts/validate-bundle-sdk.sh`
- CSV patch template, where `RELATED_IMAGE_*` env vars come from (in `os-observability/konflux-opentelemetry`): `bundle-patch/patch_csv.yaml`
