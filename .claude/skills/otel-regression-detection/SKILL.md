---
name: otel-regression-detection
description: Detect regressions in upstream OpenTelemetry repos compared to the downstream Red Hat build of OpenTelemetry release. Dynamically discovers components from manifest.yaml and docs. Analyzes changelogs, code diffs, feature gates, GitHub issues, doc staleness, test coverage gaps, and dependency changes. Use when the user asks to check for upstream regressions or breaking changes ahead of a release.
argument-hint: "[--method changelog|code-diff|feature-gates|issues|doc-validation|test-coverage|dependencies] [--release-version 3.10]"
---

# OpenTelemetry Upstream Regression Detection

Detect regressions and breaking changes in upstream OpenTelemetry repositories compared to the currently shipped Red Hat build of OpenTelemetry release.

## When to Use

- Checking for upstream regressions before a new Red Hat build of OpenTelemetry release
- Automated regression scanning triggered by new upstream releases (via CI)
- Investigating whether a specific upstream change affects Red Hat build of OpenTelemetry
- Auditing test coverage gaps or doc staleness for documented components

## How It Works

The workflow has 4 phases:

1. **Discover** — parses `manifest.yaml` from `konflux-opentelemetry/redhat-opentelemetry-collector` to get the exact component list and base version, then globs `openshift-docs` for doc files. Cross-references to find drift. No static component registry needed.

2. **Setup** — validates repos exist, fetches latest upstream, verifies base tags

3. **Analyze** (parallel fan-out):
   - **Changelog Analysis** — parses CHANGELOG.md for breaking changes, deprecations, behavior changes
   - **Code Diff Analysis** — diffs config structs, API types, webhooks for documented components
   - **Feature Gate Tracking** — detects feature gate promotions that change default behavior
   - **GitHub Issue/PR Scanning** — finds bugs, regressions, and reverted PRs via `gh` CLI
   - **Doc Validation** — reads `.adoc` files and cross-references config options against upstream config structs
   - **Test Coverage Matrix** — builds a full per-component coverage report (dedicated/implicit/none for both upstream and QE tests) plus a separate operator feature coverage matrix (target allocator, OpAMP bridge, sidecar injection, autoscaling, etc., discovered from the operator's `tests/e2e-*` suites), highlights gaps, detects upstream test deletions
   - **Dependency Tracking** — flags significant version bumps in go.mod

4. **Synthesize** — deduplicates, classifies severity, generates a self-contained HTML report and JSON summary

## Prerequisites

Repos must be cloned into the workspace directory first:

```bash
make clone-repos
```

Required repos: `konflux-opentelemetry`, `opentelemetry-operator`, `opentelemetry-collector-contrib`, `opentelemetry-collector`, `redhat-opentelemetry-collector` (used to read `manifest.yaml` for a specific release version — see `--release-version` below).
Optional: `openshift-docs` (doc validation), `distributed-tracing-qe` (QE test coverage).

The `gh` CLI must be authenticated for GitHub issue/PR scanning.

## Usage

### Before running locally

The CI job checks weekly for new upstream operator releases and runs automatically when one is detected. Reports are uploaded as GitHub Actions artifacts. Before running locally (which consumes significant tokens), check if a recent report already exists:

1. Go to the [Regression Detection](https://github.com/rhobs/redhat-build-of-opentelemetry-workspace/actions/workflows/regression-detection.yml) workflow in GitHub Actions
2. Download the artifact if the results are sufficient

Run locally only if you need fresher results or want to focus on a specific detection method.

### Basic (analyzes current release in konflux-opentelemetry)

```
/otel-regression-detection
```

### Analyze a specific release version

If `konflux-opentelemetry` has been updated to a newer version but you want to analyze a previously shipped release:

```
/otel-regression-detection --release-version 3.10
```

This uses the `v3.10` tag in `konflux-opentelemetry` to read the exact component list, operator commit, and collector version that shipped with that release.

### Focus on a single detection method (faster, lower token cost)

```
/otel-regression-detection --method changelog
/otel-regression-detection --method code-diff
/otel-regression-detection --method feature-gates
/otel-regression-detection --method issues
/otel-regression-detection --method doc-validation
/otel-regression-detection --method test-coverage
/otel-regression-detection --method dependencies
```

## Execution Steps

1. **Verify repos are cloned**: Check that required repos exist in the workspace directory (cloned via `make clone-repos`). If any are missing, tell the user to run `make clone-repos`.

2. **Run the regression detection workflow**: Invoke the Workflow tool with `.claude/workflows/regression-detection.js`, passing repo paths and method as args. The workflow's Discover phase automatically extracts all build metadata from `konflux-opentelemetry`.

3. **Generate report**: Write to `reports/regression-report-YYYY-MM-DD.html` and `reports/regression-summary-YYYY-MM-DD.json`.

4. **Present summary**: Show counts by severity and top findings.

## Configuration

**No config file or manual updates are needed for new releases.** All repo names are listed in the Prerequisites section above, and all build metadata (component list, versions, release branch) is derived at runtime from `konflux-opentelemetry`'s submodule refs, manifest, and git metadata.

## Running in CI

GitHub Actions invokes this skill headlessly:

```bash
claude -p "/otel-regression-detection --method changelog" \
  --dangerously-skip-permissions \
  --output-format text \
  --allowedTools "Bash,Read,Write,Edit,Workflow,Agent" \
  --max-budget-usd 25
```

`--dangerously-skip-permissions` is required for headless runs — there's no terminal to approve tool-use prompts. This is safe in CI because `--allowedTools` still restricts which tools can run, and the CI runner is an ephemeral, isolated environment.

See `.github/workflows/regression-detection.yml` for the full CI setup (weekly release check, repo cloning, credentials).
