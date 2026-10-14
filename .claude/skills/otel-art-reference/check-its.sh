#!/bin/bash
# Show the Konflux integration test (ITS) results of the FBC images that you are going to release.
#
# Input: the digest-pinned FBC pullspecs, comma-separated (the `pullspecs` value that
# get-fbc-images.sh prints). For every FBC image it finds the Snapshot of that exact digest in the
# tenant and prints, as YAML, the result of the scenarios of its OCP version. The result is kept on
# the Snapshot, so it also works after the PipelineRuns are cleaned up. Scenarios exist only for a
# subset of the OCP versions, and a scenario also starts on the Snapshots of the other OCP versions
# and ends there in seconds; those runs are not listed. The exit code is 1 when an image has no
# Snapshot, or a result is missing, still running or not passed, so that it can gate the release;
# the failing images and tests are then listed on stderr after the YAML.
#
# Usage: check-its.sh '<pullspec>,<pullspec>,...'
# Environment: NAMESPACE - default art-rhosdt-tenant, KONFLUX_UI - base URL of the Konflux UI
#              (default is the one of kflux-ocp-p01). `oc` must be logged in to the Konflux cluster.
set -euo pipefail

PULLSPECS="${1:?Usage: $0 '<pullspec>,<pullspec>,...' (the digest-pinned FBC pullspecs)}"
NAMESPACE="${NAMESPACE:-art-rhosdt-tenant}"
KONFLUX_UI="${KONFLUX_UI:-https://konflux-ui.apps.kflux-ocp-p01.7ayg.p1.openshiftapps.com}"
[[ "$NAMESPACE" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || { echo "ERROR: NAMESPACE is not a valid namespace name" >&2; exit 1; }
[[ "$KONFLUX_UI" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]] || { echo "ERROR: KONFLUX_UI must be an https:// base URL without a path" >&2; exit 1; }

digests='[]'
IFS=',' read -ra specs <<<"$PULLSPECS"
for spec in "${specs[@]}"; do
  [[ "$spec" =~ ^[a-z0-9./_-]+@(sha256:[0-9a-f]{64})$ ]] || { echo "ERROR: not a pullspec pinned by digest: ${spec:0:80}" >&2; exit 1; }
  digests=$(jq -c --arg d "${BASH_REMATCH[1]}" '. + [$d]' <<<"$digests")
done

# The scenarios with an OCP version: the e2e and upgrade scenarios of every FBC application.
scenarios=$(oc get integrationtestscenario -n "$NAMESPACE" -o json |
  jq -c '[.items[] | {name: .metadata.name, app: .spec.application,
    ocp: ((.spec.params // [])[] | select(.name == "ocp_version") | .value)}]')

result=$(oc get snapshot -n "$NAMESPACE" --chunk-size=0 -o json |
  jq -r --argjson digests "$digests" --argjson scenarios "$scenarios" --arg ui "${KONFLUX_UI%/}" --arg ns "$NAMESPACE" '
    # The values come from Snapshot annotations that a tenant maintainer can edit, and the output
    # goes to people and AI agents: print only names made of safe characters, never raw text.
    def safe: tostring | gsub("[^A-Za-z0-9._:-]"; "?");
    def secs: sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601;
    def dur($s; $e): if $e == null or $s == null then "none"
      else (try (($e | secs) - ($s | secs)) catch null) as $d
        | if $d == null then "none" else "\($d / 60 | floor)m\($d % 60)s" end end;
    def entry($ocp; $d; $snap; $tests; $note):
      ["- ocp_version: \(if $ocp == "unknown" or $ocp == "?" then "unknown" else "v" + $ocp end)", "  digest: \($d)", "  snapshot: \($snap)"]
      + (if ($tests | length) == 0 then ["  tests: []"] else
          ["  tests:"] + [$tests[] | "  - scenario: \(.scenario)", "    result: \(.result)",
            "    duration: \(.duration)", "    pipelinerun: \(.run)", "    url: \(.url)"] end)
      + (if $note == "" then [] else ["  note: \($note)"] end);
    .items as $snaps
    | [$digests[] | . as $d
       | ($snaps | map(select(any(.spec.components[]?; (.containerImage // "") | endswith("@" + $d))))
          | sort_by(.metadata.creationTimestamp) | last) as $snap
       | if $snap == null then
           {ok: false, lines: entry("unknown"; $d; "none"; []; "no Snapshot found for this digest")}
         else
           ($snap.metadata.labels["appstudio.openshift.io/application"] // "") as $app
           | ($snap.metadata.annotations["test.appstudio.openshift.io/result-image-url"] // ""
              | capture("\\.ocp(?<v>[0-9]+\\.[0-9]+)$").v? // "?") as $ocp
           | ($snap.metadata.annotations["test.appstudio.openshift.io/status"] // "[]" | fromjson) as $status
           | [$scenarios[] | select(.app == $app and .ocp == $ocp)] as $mine
           | [$mine[] | . as $sc
              | ([$status[] | select(.scenario == $sc.name)] | first) as $r
              | if $r == null then {scenario: ($sc.name | safe), result: "NotRun", duration: "none", run: "none", url: "none"}
                else {scenario: ($sc.name | safe),
                  result: ($r.status | tostring | if test("^[A-Za-z]{1,24}$") then . else "?" end),
                  duration: dur($r.startTime; $r.completionTime), run: ($r.testPipelineRunName | safe),
                  url: "\($ui)/ns/\($ns)/applications/\($app | safe)/pipelineruns/\($r.testPipelineRunName | safe)"} end] as $tests
           | {ok: ($tests | all(.result == "TestPassed")),
              lines: entry(($ocp | safe); $d; ($snap.metadata.name | safe); $tests;
                           if ($mine | length) == 0 then "no test is defined for this OCP version" else "" end)}
         end] as $all
    | "passed: \($all | all(.ok))", "fbc_results:", ($all[].lines[])')

echo "$result"
if ! grep -q '^passed: true$' <<<"$result"; then
  echo "NOT READY - issues found:" >&2
  awk '/^- ocp_version:/ { ocp = $3 }
       /^  digest:/ { digest = $2 }
       /^  - scenario:/ { scenario = $3 }
       /^    result:/ { res = $2 }
       /^    url:/ { if (res != "TestPassed") { print "  " ocp ": " scenario " = " res; if ($2 != "none") print "    " $2 } }
       /^  note: no Snapshot/ { print "  " ocp ": no Snapshot found for " digest }' <<<"$result" >&2
  exit 1
fi
