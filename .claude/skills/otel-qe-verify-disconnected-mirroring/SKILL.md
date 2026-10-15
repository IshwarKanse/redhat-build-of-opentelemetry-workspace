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
- `oc`, `yq`, `jq`, and `skopeo` — should already be on the machine (verify with
  `command -v oc yq jq skopeo`).

## What the full disconnected CI job does (for context)

`openshift/distributed-tracing-qe`'s `ocp-4.16-disconnected` job (config:
`release/ci-operator/config/openshift/distributed-tracing-qe/openshift-distributed-tracing-qe-main__ocp-4.16-disconnected.yaml`
in the separate `openshift/release` repo — see "Reference files" below)
does three things via `cucushift-installer-rehearse-gcp-ipi-disconnected`:

1. `distributed-tracing-install-disconnected` — runs `oc-mirror --v1` against the OTEL catalog (the
   ART FBC image) and the Tempo catalog image it is configured with (a separate job; Tempo is installed from `redhat-operators` everywhere else, and this job is not part of the OTEL release flow), mirroring the index, bundle, and every `spec.relatedImages`
   entry, then applies the generated `ImageContentSourcePolicy` + `CatalogSource`.
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
     oc get csv -A -o json | jq -r '.items[] | select(.metadata.name|test("opentelemetry|tempo")) | select(.metadata.labels["olm.copiedFrom"]|not) | .metadata.namespace + " " + .metadata.name'
     oc get csv <csv-name> -n <namespace> -o yaml > /tmp/csv.yaml
     ```
     A plain `oc get csv -A | grep` lists the operator's copy in every namespace when it was installed for all namespaces; the `olm.copiedFrom` filter keeps only the install namespace.
   - **A specific bundle image / release** (validates a build without needing a cluster):
     1. Resolve the bundle image digest.
        - **OTEL** — from the ART FBC catalog for the OCP version of interest (4.16 for the
          disconnected CI job). Get the catalog image with
          `bash .claude/skills/otel-art-reference/get-fbc-images.sh <art-version>` (it is public, no
          credentials needed), extract its `/configs`, and read the newest bundle:
          ```bash
          FBC=quay.io/redhat-user-workloads/ocp-art-tenant/art-fbc:rhosdt-<art-version>__v<ocp>__opentelemetry-rhel9-operator
          oc image extract "$FBC" --filter-by-os=linux/amd64 --path /configs/:/tmp/fbc --confirm
          opm render /tmp/fbc/opentelemetry-product -o json \
            | jq -r 'select(.schema=="olm.bundle") | [.name,.image] | @tsv' | sort -V | tail -1
          ```
          The result is `registry.redhat.io/rhosdt/opentelemetry-operator-bundle@sha256:…`. That
          name only resolves on the stage registry until the release is published: pull the same
          digest from `registry.stage.redhat.io/rhosdt/opentelemetry-operator-bundle@sha256:…`
          (`skopeo login registry.stage.redhat.io` with the team's stage credentials first; on macOS
          add `--override-os linux --override-arch amd64` to `skopeo copy`). The
          catalog does not embed the CSV, so the bundle image has to be pulled.
        - **Tempo** — the released operator from the Red Hat Operators catalog: render the
          production index for the OCP version of interest and read the newest bundle, the same
          way as for OTEL (`opm render` of `/configs/tempo-product` from
          `registry.redhat.io/redhat/redhat-operator-index:v<ocp>`, which needs a
          `registry.redhat.io` login), or take the CSV from a live cluster where it is installed.
     2. Extract the CSV from that bundle image: copy the image to an OCI dir, untar the layer
        blobs, then read `manifests/*.clusterserviceversion.yaml` from the extracted tree:
        ```bash
        skopeo copy --override-os linux --override-arch amd64 \
          docker://<bundle-image>@sha256:<digest> oci:/tmp/bundle:latest
        mkdir -p /tmp/bundle-fs
        for b in /tmp/bundle/blobs/sha256/*; do tar -xzf "$b" -C /tmp/bundle-fs 2>/dev/null || true; done
        cp /tmp/bundle-fs/manifests/*.clusterserviceversion.yaml /tmp/csv.yaml
        ```

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

## Optional deeper verification

- **Staleness check**: confirm each `relatedImages` digest is still pullable. ART bundles name
  `registry.redhat.io/rhosdt/...` images that exist only on `registry.stage.redhat.io/rhosdt`
  until the release is published, so check the stage copy (same digest; log in with
  `skopeo login registry.stage.redhat.io` first). `--raw` is needed on macOS, where the
  multi-arch index has no darwin entry:
  ```bash
  skopeo inspect --raw docker://registry.stage.redhat.io/rhosdt/<name>@sha256:<digest> >/dev/null && echo OK || echo STALE
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
