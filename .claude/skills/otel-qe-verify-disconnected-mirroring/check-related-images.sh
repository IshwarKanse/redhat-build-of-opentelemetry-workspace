#!/usr/bin/env bash
# Validate that a ClusterServiceVersion (CSV) declares every image it uses in
# spec.relatedImages, pinned by digest. This is the exact invariant oc-mirror /
# OLM disconnected support relies on: oc-mirror only mirrors images listed in
# spec.relatedImages, it does not introspect Deployment env vars or CR
# defaults. If an operator (or webhook) container image, or an image-valued
# env var such as RELATED_IMAGE_COLLECTOR, isn't also present verbatim in
# relatedImages, that image will silently fail to pull once mirrored/ICSP'd
# into a disconnected cluster.
#
# Usage: check-related-images.sh <path-to-csv.yaml>
#
# Exit code: 0 if all checks pass, 1 if any hard failure is found, 2 on usage
# errors (missing tools, bad input file).
#
# Known limitation: only digest-pinned env var values (…@sha256:<64 hex>) are
# recognized as image references, to avoid false positives on unrelated
# path-like env values (e.g. "namespace/configmap:v2"). A RELATED_IMAGE_* env
# var that holds a tag instead of a digest will not be flagged here — that's
# itself already a disconnected-support bug, just not one this script detects.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <path-to-csv.yaml>" >&2
  exit 2
fi

CSV="$1"
if [[ ! -f "$CSV" ]]; then
  echo "FAIL: CSV file not found: $CSV" >&2
  exit 2
fi

for tool in yq jq; do
  command -v "$tool" >/dev/null 2>&1 || { echo "FAIL: '$tool' is required but not found in PATH" >&2; exit 2; }
done

# Convert once to JSON; everything past this point uses jq, not yq's own
# (jq-like but not jq-compatible) expression language, since yq's evaluator
# rejects jq object-construction/variable-binding syntax like `{a: $x}`.
csv_json=$(yq -o=json '.' "$CSV")

kind=$(jq -r '.kind // "unknown"' <<<"$csv_json")
if [[ "$kind" != "ClusterServiceVersion" ]]; then
  echo "FAIL: $CSV does not look like a ClusterServiceVersion (kind=${kind})" >&2
  exit 2
fi

fail=0

csv_name=$(jq -r '.metadata.name // "unknown"' <<<"$csv_json")
echo "== Validating relatedImages for CSV: ${csv_name} =="
echo "   source: ${CSV}"
echo

# --- 1. spec.relatedImages must exist and be non-empty ---------------------
related_json=$(jq '.spec.relatedImages // []' <<<"$csv_json")
related_count=$(jq 'length' <<<"$related_json")

if [[ "$related_count" -eq 0 ]]; then
  echo "FAIL: spec.relatedImages is empty or missing"
  fail=1
else
  echo "spec.relatedImages: ${related_count} entries"
fi

# --- 2. Every relatedImages entry must have an image, pinned by digest -----
unset_image=$(jq -r '.[] | select(.image == null) | (.name // "<unnamed>")' <<<"$related_json")
if [[ -n "$unset_image" ]]; then
  echo "FAIL: relatedImages entries with no image set:"
  while IFS= read -r line; do [[ -n "$line" ]] && echo "  - $line"; done <<<"$unset_image"
  fail=1
fi

untagged=$(jq -r '.[] | select(.image != null and (.image | test("@sha256:") | not)) | "\(.name // "<unnamed>")=\(.image)"' <<<"$related_json")
if [[ -n "$untagged" ]]; then
  echo "FAIL: relatedImages entries not pinned by digest (@sha256:...):"
  while IFS= read -r line; do echo "  - $line"; done <<<"$untagged"
  fail=1
fi

if [[ -z "$unset_image" && -z "$untagged" && "$related_count" -gt 0 ]]; then
  echo "PASS: all relatedImages entries are digest-pinned"
fi

related_images_set=$(jq -r '.[] | select(.image != null) | .image' <<<"$related_json" | sort -u)

# --- 3. Every image used by the operator must be declared in relatedImages -
# Covers both containers[] and initContainers[] in every deployment.
deployment_count=$(jq '.spec.install.spec.deployments // [] | length' <<<"$csv_json")
if [[ "$deployment_count" -eq 0 ]]; then
  echo "FAIL: spec.install.spec.deployments is empty or missing — cannot verify container images"
  fail=1
else
  container_records=$(jq '
    [.spec.install.spec.deployments[] | .name as $d |
     .spec.template.spec | (.containers[]?, .initContainers[]?) |
     {deployment: $d, container: .name, image: .image}]
  ' <<<"$csv_json")

  no_image=$(jq -r '.[] | select(.image == null) | "\(.deployment)/\(.container)"' <<<"$container_records")
  if [[ -n "$no_image" ]]; then
    echo "FAIL: containers with no image set:"
    while IFS= read -r line; do [[ -n "$line" ]] && echo "  - $line"; done <<<"$no_image"
    fail=1
  fi

  container_images=$(jq -r '.[] | select(.image != null) | .image' <<<"$container_records" | sort -u)

  # Only digest-pinned env var values are treated as image references, to
  # avoid false positives on unrelated path-shaped strings (see header note).
  env_records=$(jq '
    [.spec.install.spec.deployments[] | .name as $d |
     .spec.template.spec | (.containers[]?, .initContainers[]?) | .name as $c |
     (.env[]? // empty) | {deployment: $d, container: $c, name: .name, value: .value}]
  ' <<<"$csv_json")
  env_images=$(jq -r '.[] | select(.value != null and (.value | test("@sha256:[a-f0-9]{64}$"))) | .value' <<<"$env_records" | sort -u)

  used_images=$(printf '%s\n%s\n' "$container_images" "$env_images" | sed '/^$/d' | sort -u)

  missing=""
  while IFS= read -r img; do
    [[ -z "$img" ]] && continue
    if ! grep -qxF "$img" <<<"$related_images_set"; then
      missing+="${img}"$'\n'
    fi
  done <<<"$used_images"

  if [[ -n "$missing" ]]; then
    echo "FAIL: images used by the operator but missing from spec.relatedImages:"
    while IFS= read -r line; do [[ -n "$line" ]] && echo "  - $line"; done <<<"$missing"
    fail=1
  elif [[ -z "$no_image" ]]; then
    echo "PASS: every container/initContainer image and digest-pinned env var is declared in relatedImages"
  fi
fi

# --- 4. Disconnected annotation (advisory, non-fatal) -----------------------
disconnected_annotation=$(jq -r '.metadata.annotations["features.operators.openshift.io/disconnected"] // "missing"' <<<"$csv_json")
if [[ "$disconnected_annotation" != "true" ]]; then
  echo "WARN: metadata.annotations[\"features.operators.openshift.io/disconnected\"] is '${disconnected_annotation}', expected 'true'"
else
  echo "PASS: disconnected annotation set to true"
fi

echo
if [[ "$fail" -eq 0 ]]; then
  echo "RESULT: PASS - CSV looks safe for oc-mirror/ICSP disconnected mirroring"
else
  echo "RESULT: FAIL - see failures above"
fi

exit "$fail"
