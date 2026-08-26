---
name: otel-qe-release-tests
description: Execute release testing for Red Hat build of OpenTelemetry. Prepares test repositories, fetches test requirements from Jira, and triggers all required CI jobs for a release. Use when the user asks to run or trigger release testing for RHOSDT.
---

# Run Release Tests

This skill automates the execution of release testing for Red Hat build of OpenTelemetry (RHOSDT). It coordinates preparation, fetches test requirements, and triggers all required CI jobs.

## When to Use This Skill

Use this skill when:
- Running full release testing for a new RHOSDT version
- Automating the execution of all required stage tests

## Prerequisites

1. **OpenShift CI Token**: Get a login token from [OCP CI console](https://console-openshift-console.apps.ci.l2s4.p1.openshiftapps.com/)
2. **Release payload images**: IIB and bundle images.
3. **Test branch**: Product branch in os-observability repos (e.g., `rhosdt-3.10`)

## Release Testing Workflow

### Step 1: Prepare Test Repositories

Prepare the OpenTelemetry operator test suite:

```
/otel-qe-prepare-operator
```

This sets up the `os-observability/opentelemetry-operator` repository with product branch modifications.


Prepare the Konflux integration tests:

```
/otel-qe-prepare-konflux-tests Update integration tests for RHOSDT 3.10
```

### Step 2: Get Test Requirements from Jira

Fetch the QE release tracker to identify required tests. The tracker contains:
- Test matrix with required cluster configurations
- Test suites to execute
- Sign-off checklist

Example tracker: [TRACING-6253: [QE] Verify RHOSDT 3.10 OTEL release](https://redhat.atlassian.net/browse/TRACING-6253)

Use the Jira skill to fetch the tracker:
```
/jira:jira get issue TRACING-6253
```

### Step 3: Execute Stage Tests

Refer to `/otel-qe-test-jobs` for detailed job configurations and parameters.

#### Required Parameters

| Parameter | Description |
|-----------|-------------|
| `MULTISTAGE_PARAM_OVERRIDE_OTEL_INDEX_IMAGE` | FBC fragment or bundle image for OpenTelemetry |
| `MULTISTAGE_PARAM_OVERRIDE_TEMPO_INDEX_IMAGE` | FBC fragment or bundle image for Tempo |
| `MULTISTAGE_PARAM_OVERRIDE_OTEL_TESTS_BRANCH` | Branch to checkout (e.g., `rhosdt-3.10`) |
| `MULTISTAGE_PARAM_OVERRIDE_TEMPO_TESTS_BRANCH` | Branch to checkout (e.g., `rhosdt-3.10`) |

#### Execute Tests

Use the `/otel-qe-test-jobs` skill to run the tests defined in the Jira tracker. The skill contains:
- Job names and configurations for all test types
- Gangway API examples for triggering jobs
- Required parameters for each job type

Example:
```
/otel-qe-test-jobs trigger OTEL stage tests for OCP 4.19 with IIB brew.registry.redhat.io/rh-osbs/iib:1107456 and branch rhosdt-3.10
```

Always output all parameters which were used to trigger the job.

#### Gangway API Rate Limiting

The Gangway API has rate limiting that returns `429 Too Many Requests` when exceeded.

**Rate Limit Behavior:**
- Approximately 5-6 requests in quick succession will trigger rate limiting
- Rate limit resets after approximately 30 seconds

**How to Avoid Rate Limiting:**
1. **Add delays between requests**: Wait 5 seconds between each job trigger
2. **Batch jobs carefully**: When triggering multiple jobs, space them out
3. **Retry with backoff**: If you get a 429, wait 30 seconds before retrying

### Step 4: Monitor Job Status

Check job status in QE Private Deck: https://qe-private-deck-ci.apps.ci.l2s4.p1.openshiftapps.com/?type=periodic

Filter jobs using `job=*opentelemetry*` or `job=*tempo*` URL parameters.

Get job details via API:
```bash
curl -X GET -H "Authorization: Bearer ${TOKEN}" "${GANGWAY_API}/v1/executions/${JOB_ID}"
```

### Step 5: Report Results

After all jobs complete:
1. Collect job results and links
2. Update the Jira QE release trackers with results
3. Document any failures and create follow-up issues
