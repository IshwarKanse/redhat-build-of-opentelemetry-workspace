#!/bin/bash
set -euo pipefail

VERSION="${1:?Usage: $0 <rhosdt-version> (e.g. 3.11)}"
REPO="quay.io/redhat-user-workloads/ocp-art-tenant/art-fbc"
API="https://quay.io/api/v1/repository/redhat-user-workloads/ocp-art-tenant/art-fbc/tag/"

# Quay pages the tag list. Request active tags only: expired entries from earlier builds keep the
# same name as the live tag, so reading them could pick a stale digest for a floating tag.
list_tags() {
  local page=1 resp
  while :; do
    resp=$(curl -sf "${API}?onlyActiveTags=true&filter_tag_name=like:rhosdt-${VERSION}&limit=100&page=${page}")
    jq -c '.tags[]' <<<"$resp"
    [[ "$(jq -r '.has_additional' <<<"$resp")" == "true" ]] || break
    page=$((page + 1))
  done
}

echo "rhosdt_version: '${VERSION}'"
echo "fbc_images:"

list_tags \
  | jq -r --arg v "$VERSION" '
      select((.name | startswith("rhosdt-" + $v + "__v"))
             and (.name | test("^rhosdt-[0-9.]+__v[0-9.]+__opentelemetry-rhel9-operator$")))
      | [.name, .manifest_digest, .last_modified] | @tsv' \
  | sort -u -t'	' -k1,1 \
  | sort -t_ -k3 -V \
  | while IFS=$'\t' read -r tag digest last_modified; do
      ocp="${tag#*__}" && ocp="${ocp%%__*}"
      echo "- ocp_version: ${ocp}"
      echo "  tag: ${tag}"
      echo "  digest: ${digest}"
      echo "  created: ${last_modified}"
      echo "  image: ${REPO}:${tag}"
      echo "  image_by_digest: ${REPO}@${digest}"
    done
