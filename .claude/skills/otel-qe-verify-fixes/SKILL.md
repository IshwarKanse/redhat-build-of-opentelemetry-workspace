---
name: otel-qe-verify-fixes
description: Verify CVE and bug fixes listed in an OpenTelemetry release payload. Reads release notes from release-payloads/*.yaml, looks up each referenced Jira issue and CVE, and verifies the fixes. Use when the user asks to verify CVE or bug fixes for a release payload.
---

# Verify CVE and Bug Fixes

Verify that CVE and bug fixes listed in a release payload are actually fixed.

## Steps

1. **Ask the user** which OTEL version to verify (e.g. OTEL 3.10.0) if not already specified.

2. **Read the release payload** from `distributed-tracing/konflux/release-payloads/`. The file naming convention is:
   - OTEL: `otel-prod-{version}.yaml` (e.g. `otel-prod-3.10.0.yaml`)

3. **Extract the release notes** from `spec.data.releaseNotes`. Collect:
   - Bug fixes listed in the `description` field (each references a TRACING-* Jira issue)
   - CVEs listed under `spec.data.releaseNotes.cves`
   - Fixed issues listed under `spec.data.releaseNotes.issues.fixed`

4. **For each bug fix**:
   - Look up the Jira issue to understand what was fixed
   - Check the linked PR/commit to confirm the fix is included
   - Verify the fix on the cluster when a test cluster is available (e.g. by deploying the operator and testing the specific scenario described in the bug)
   - Update the Jira issue with verification results

5. **For each CVE**:
   - Use the `/otel-cve-resolver` skill to look up the CVE details
   - Confirm the CVE is addressed in the release (e.g. dependency updated, patch applied)
   - Verify the fix if applicable

6. **Report results**: Summarize which fixes were verified, which need attention, and update the relevant Jira issues.
