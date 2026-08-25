export const meta = {
  name: 'regression-detection',
  description: 'Detect upstream regressions in OpenTelemetry repos vs downstream Red Hat build of OpenTelemetry release',
  phases: [
    { title: 'Discover', detail: 'Parse manifest.yaml and glob docs to build component list' },
    { title: 'Setup', detail: 'Validate repos, tags, and fetch latest upstream' },
    { title: 'Analyze', detail: 'Fan out changelog, code diff, feature gate, issue, test, and dependency agents' },
    { title: 'Synthesize', detail: 'Merge, deduplicate, classify, and generate report' },
  ],
}

const DISCOVERY_SCHEMA = {
  type: 'object',
  properties: {
    collector_version: { type: 'string' },
    operator_base_commit: { type: 'string' },
    operator_base_version: { type: 'string' },
    release_branch: { type: 'string' },
    components: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['receiver', 'processor', 'exporter', 'connector', 'extension'] },
          gomod: { type: 'string' },
          source_dir: { type: 'string' },
          repo: { type: 'string', enum: ['collector_core', 'collector_contrib'] },
          version: { type: 'string' },
          has_doc: { type: 'boolean' },
          doc_file: { type: 'string' },
        },
        required: ['type', 'gomod', 'source_dir', 'repo', 'version', 'has_doc'],
      },
    },
    documented_but_missing: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          doc_file: { type: 'string' },
        },
        required: ['type', 'doc_file'],
      },
    },
  },
  required: ['collector_version', 'operator_base_commit', 'operator_base_version', 'release_branch', 'components', 'documented_but_missing'],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
          category: { type: 'string', enum: ['BREAKING_CHANGE', 'DEPRECATION', 'BEHAVIOR_CHANGE', 'NEW_FEATURE', 'BUG_FIX', 'FEATURE_GATE', 'DEPENDENCY', 'TEST_COVERAGE', 'REMOVED_API', 'DOC_STALE', 'DOC_MISSING', 'COMPONENT_DRIFT'] },
          component: { type: 'string' },
          component_type: { type: 'string', enum: ['receiver', 'processor', 'exporter', 'connector', 'extension', 'operator', 'core', 'auto_instrumentation'] },
          title: { type: 'string' },
          description: { type: 'string' },
          upstream_pr: { type: 'string' },
          affected_config_fields: { type: 'array', items: { type: 'string' } },
          has_test_coverage: { type: 'boolean' },
          recommended_action: { type: 'string' },
        },
        required: ['severity', 'category', 'component', 'title', 'description', 'recommended_action'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['findings', 'summary'],
}

const COVERAGE_SCHEMA = {
  type: 'object',
  properties: {
    coverage_matrix: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          component: { type: 'string' },
          component_type: { type: 'string', enum: ['receiver', 'processor', 'exporter', 'connector', 'extension'] },
          has_doc: { type: 'boolean' },
          upstream_test: { type: 'string', enum: ['dedicated', 'implicit', 'none'] },
          upstream_test_path: { type: 'string' },
          qe_test: { type: 'string', enum: ['dedicated', 'implicit', 'none'] },
          qe_test_path: { type: 'string' },
        },
        required: ['component', 'component_type', 'has_doc', 'upstream_test', 'qe_test'],
      },
    },
    summary: {
      type: 'object',
      properties: {
        total_components: { type: 'number' },
        with_upstream_test: { type: 'number' },
        with_qe_test: { type: 'number' },
        with_any_test: { type: 'number' },
        with_no_test: { type: 'number' },
        documented_with_no_test: { type: 'number' },
      },
      required: ['total_components', 'with_upstream_test', 'with_qe_test', 'with_any_test', 'with_no_test'],
    },
    test_change_findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
          category: { type: 'string' },
          component: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          recommended_action: { type: 'string' },
        },
        required: ['severity', 'category', 'component', 'title', 'description', 'recommended_action'],
      },
    },
  },
  required: ['coverage_matrix', 'summary', 'test_change_findings'],
}

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    report_markdown: { type: 'string' },
    summary_counts: {
      type: 'object',
      properties: {
        critical: { type: 'number' },
        high: { type: 'number' },
        medium: { type: 'number' },
        low: { type: 'number' },
        total: { type: 'number' },
      },
      required: ['critical', 'high', 'medium', 'low', 'total'],
    },
  },
  required: ['report_markdown', 'summary_counts'],
}

const konfluxPath = args.konflux_path
const operatorPath = args.operator_path
const contribPath = args.contrib_path
const corePath = args.core_path
const qePath = args.qe_path || ''
const docsPath = args.docs_path || ''
const method = args.method || 'all'
const releaseVersion = args.release_version || ''
const rhCollectorPath = args.rh_collector_path || ''

// ── Phase 1: Discover ──
// Everything is derived from konflux-opentelemetry:
//   Tags (v3.10, v3.9) pin the exact state of each release
//   git ls-tree <tag> <submodule> → pinned submodule commits
//   git show <commit>:manifest.yaml (in redhat-opentelemetry-collector) → component list
//   git show <tag>:bundle-patch/patch_csv.yaml → downstream version
phase('Discover')

const useTag = releaseVersion ? `v${releaseVersion}` : ''

const discovery = await agent(`You are discovering the downstream build definition and component list from the konflux-opentelemetry repo.

TASK: Extract all build metadata from ${konfluxPath} and cross-reference with docs.
${useTag ? `
IMPORTANT: The user requested analysis for release version ${releaseVersion}.
Use the tag "${useTag}" in konflux-opentelemetry to read the pinned state of that release.
First run: git -C ${konfluxPath} fetch origin tag ${useTag}
` : `
Use the current working tree of ${konfluxPath} (latest checkout).
`}
STEP 1: GET BUILD METADATA FROM KONFLUX REPO
Run these commands in ${konfluxPath}:

a) Release branch:
   ${useTag ? `git show ${useTag}:.gitmodules | grep branch` : 'grep "branch" .gitmodules'}
   Extract the branch name (e.g., "rhosdt-3.10").

b) Pinned submodule commits:
   ${useTag
     ? `git ls-tree ${useTag} redhat-opentelemetry-collector — extract the commit hash (3rd field)
   git ls-tree ${useTag} opentelemetry-operator — extract the commit hash (3rd field)`
     : `git submodule status
   Extract the commit hash for each (the hex string at the start, ignoring the leading +).`}
   The opentelemetry-operator commit is the downstream operator base.

c) Downstream version:
   ${useTag ? `git show ${useTag}:bundle-patch/patch_csv.yaml | grep "version:" | head -1` : 'grep "version:" bundle-patch/patch_csv.yaml | head -1'}
   Extract the version (e.g., "0.152.0-3"). The part before the dash is the upstream operator version.

STEP 2: PARSE MANIFEST
${useTag
  ? `Get the redhat-opentelemetry-collector submodule commit from step 1b.
Then read the manifest from that commit in the redhat-opentelemetry-collector repo:
  git -C ${rhCollectorPath || contribPath + '/../redhat-opentelemetry-collector'} show <collector_commit>:manifest.yaml
If the redhat-opentelemetry-collector repo is not available at that path, try: ${konfluxPath}/redhat-opentelemetry-collector
  git -C ${konfluxPath}/redhat-opentelemetry-collector show <collector_commit>:manifest.yaml`
  : `Read the file: ${konfluxPath}/redhat-opentelemetry-collector/manifest.yaml`}
This file has sections: receivers, exporters, processors, connectors, extensions.
Each entry has a "gomod" field like:
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/receiver/jaegerreceiver v0.152.0
  - gomod: go.opentelemetry.io/collector/receiver/otlpreceiver v0.152.1

For each entry, extract:
  - type: the section it's under (receiver, exporter, processor, connector, extension)
  - gomod: the full Go module path
  - source_dir: the path after "collector-contrib/" or "collector/" (e.g., "receiver/jaegerreceiver")
  - repo: "collector_contrib" if the module starts with "github.com/open-telemetry/opentelemetry-collector-contrib/", or "collector_core" if it starts with "go.opentelemetry.io/collector/"
  - version: the version string

Also extract dist.version from the top of the file — this is the downstream base collector version.

STEP 3: GLOB DOCS
${docsPath ? `List all doc module files in: ${docsPath}/otel-collector/modules/
Run: ls ${docsPath}/otel-collector/modules/otel-receivers-*.adoc ${docsPath}/otel-collector/modules/otel-processors-*.adoc ${docsPath}/otel-collector/modules/otel-exporters-*.adoc ${docsPath}/otel-collector/modules/otel-connectors-*.adoc ${docsPath}/otel-collector/modules/otel-extensions-*.adoc 2>/dev/null

Exclude files ending in "-overview.adoc" — those are category overviews, not component docs.` : 'Docs repo not available — skip doc globbing.'}

STEP 4: CROSS-REFERENCE
For each component from the manifest, check if a matching doc file exists. The matching is fuzzy:
  - receiver/jaegerreceiver → otel-receivers-jaeger-receiver.adoc
  - processor/batchprocessor → otel-processors-batch-processor.adoc
  - extension/storage/filestorage → otel-extensions-filestorage-extension.adoc
Set has_doc=true if a match exists. Record the doc_file name.

For doc files that don't match any manifest component, add to documented_but_missing.

STEP 5: Return the complete discovery result.`, {
  label: 'discover-components',
  phase: 'Discover',
  schema: DISCOVERY_SCHEMA,
})

if (
  !discovery ||
  !discovery.collector_version ||
  !discovery.operator_base_commit ||
  !discovery.operator_base_version ||
  !discovery.components ||
  discovery.components.length === 0
) {
  log('ERROR: Discovery phase failed — could not extract build metadata from konflux-opentelemetry. Aborting.')
  return { report_markdown: '# Regression Detection — Failed\n\nDiscovery phase failed. Check that konflux-opentelemetry is cloned with --recurse-submodules and contains manifest.yaml.', summary_counts: { critical: 0, high: 0, medium: 0, low: 0, total: 0 } }
}

const collectorBaseVersion = discovery.collector_version
const contribBase = 'v' + collectorBaseVersion
const coreBase = 'v' + collectorBaseVersion
const operatorBase = discovery.operator_base_commit
const operatorVersion = discovery.operator_base_version
const releaseBranch = discovery.release_branch
const components = discovery.components
const docDrift = discovery.documented_but_missing || []

log(`Discovered ${components.length} components. Collector: v${collectorBaseVersion}, Operator: ${operatorBase} (v${operatorVersion}), Branch: ${releaseBranch}. ${docDrift.length} doc-only.`)

// ── Phase 2: Setup ──
phase('Setup')
await agent(`You are setting up regression detection. Do the following:

1. Verify these repos exist and are git repositories:
   - Operator: ${operatorPath}
   - Collector-contrib: ${contribPath}
   - Collector-core: ${corePath}
   ${docsPath ? `- Docs: ${docsPath}` : ''}
   ${qePath ? `- QE tests: ${qePath}` : ''}

2. Run "git fetch origin main" in each upstream repo to get latest state.

3. Verify these base refs exist:
   - In operator repo: ${operatorBase} (this may be a commit hash, not a tag)
   - In collector-contrib repo: ${contribBase}
   - In collector-core repo: ${coreBase}
   Use "git rev-parse --verify <ref>" to check. For tags, also try "git tag -l <tag>".

4. Get the current HEAD commit hash for origin/main in each repo using "git rev-parse origin/main".

5. Return a summary of repos, tags, and HEAD commits.

Do NOT modify working trees or checkout branches.`, {
  label: 'setup',
  phase: 'Setup',
})

log(`Setup complete. Analyzing ${operatorBase} / ${contribBase} → upstream HEAD.`)

// Build the list of source dirs for code-diff and doc-validation agents
const contribComponents = components.filter(c => c.repo === 'collector_contrib')
const documentedComponents = components.filter(c => c.has_doc)
const componentSourceDirs = contribComponents.map(c => c.source_dir).join(', ')
const componentIds = components.map(c => {
  const parts = c.source_dir.split('/')
  return parts[parts.length - 1]
}).join(', ')

// ── Phase 3: Analyze ──
phase('Analyze')

const analysisMethods = []

if (method === 'all' || method === 'changelog') {
  analysisMethods.push({
    key: 'changelog',
    label: 'changelog-analysis',
    prompt: `You are analyzing changelogs for regressions in upstream OpenTelemetry repos.

TASK: Parse CHANGELOG.md files between the downstream base tags and upstream HEAD (origin/main). Identify breaking changes, deprecations, behavior changes, and significant bug fixes.

REPOS AND TAGS:
- Operator: ${operatorPath} — compare ${operatorBase}..origin/main
- Collector-contrib: ${contribPath} — compare ${contribBase}..origin/main
- Collector-core: ${corePath} — compare ${coreBase}..origin/main

INSTRUCTIONS:
1. For each repo, read CHANGELOG.md and identify entries between the base version and the current unreleased/latest.
2. Focus on: "Breaking changes" (CRITICAL), "Deprecation" (HIGH), "Enhancements" changing defaults (HIGH), "Bug fixes" with side effects (MEDIUM).
3. Check pending entries in .chloggen/*.yaml for early warnings.
4. Filter to only components in the downstream build. Component source directories:
   ${componentIds}

For each finding: severity, category, component, title, description, upstream PR link, recommended action.`,
  })
}

if (method === 'all' || method === 'code-diff') {
  analysisMethods.push({
    key: 'code-diff',
    label: 'code-diff-analysis',
    prompt: `You are analyzing code diffs for regressions in upstream OpenTelemetry repos.

TASK: Analyze git diffs between downstream base tags and upstream HEAD for breaking changes.

REPOS AND TAGS:
- Operator: ${operatorPath} — diff ${operatorBase}..origin/main
- Collector-contrib: ${contribPath} — diff ${contribBase}..origin/main
- Collector-core: ${corePath} — diff ${coreBase}..origin/main

INSTRUCTIONS:

1. OPERATOR API CHANGES: Run "git diff ${operatorBase}..origin/main -- apis/" in the operator repo.
   Look for removed/renamed CRD fields, changed validation markers, changed defaults.

2. COMPONENT CONFIG CHANGES: For each of these downstream component directories, diff config.go and factory.go in collector-contrib:
   ${componentSourceDirs}
   Run: git diff ${contribBase}..origin/main -- <dir>/config.go <dir>/factory.go
   Detect: added required fields, removed fields, renamed fields, changed defaults.

3. WEBHOOK CHANGES: Run "git diff ${operatorBase}..origin/main -- internal/webhook/" in the operator repo.

Classify: CRITICAL (removal/breaking), HIGH (behavior change), MEDIUM (renamed with alias), LOW (additive).`,
  })
}

if (method === 'all' || method === 'feature-gates') {
  analysisMethods.push({
    key: 'feature-gates',
    label: 'feature-gate-tracking',
    prompt: `You are tracking feature gate changes in upstream OpenTelemetry repos.

TASK: Detect feature gate promotions between downstream base and upstream HEAD.

REPOS AND TAGS:
- Operator: ${operatorPath} — compare ${operatorBase}..origin/main
- Collector-contrib: ${contribPath} — compare ${contribBase}..origin/main
- Collector-core: ${corePath} — compare ${coreBase}..origin/main

INSTRUCTIONS:
1. Search for feature gate registration changes in the diffs:
   git diff <base>..origin/main -- "*.go" | grep -A5 -B5 "featuregate\\|MustRegister"

2. For each gate change: identify gate ID, old/new stability (Alpha→Beta→Stable→Removed), affected component.
   Alpha→Beta: HIGH (default changes). Beta→Stable: CRITICAL. Removed: CRITICAL.

3. Filter to components in the downstream build:
   ${componentIds}

Return: gate ID, old level, new level, component, severity, recommended action.`,
  })
}

if (method === 'all' || method === 'issues') {
  analysisMethods.push({
    key: 'issues',
    label: 'github-issue-scanning',
    prompt: `You are scanning GitHub issues and PRs for regressions in upstream OpenTelemetry repos.

TASK: Search for bugs, regressions, and reverted PRs since the downstream base version.

INSTRUCTIONS:
1. Bug issues (use gh CLI):
   gh issue list --repo open-telemetry/opentelemetry-operator --label bug --state all --limit 30 --json number,title,state,createdAt,labels,url
   gh issue list --repo open-telemetry/opentelemetry-collector-contrib --label bug --state all --limit 30 --json number,title,state,createdAt,labels,url

2. Revert PRs:
   gh pr list --repo open-telemetry/opentelemetry-operator --state merged --search "revert in:title" --limit 20 --json number,title,mergedAt,url
   gh pr list --repo open-telemetry/opentelemetry-collector-contrib --state merged --search "revert in:title" --limit 20 --json number,title,mergedAt,url

3. Breaking change PRs:
   gh pr list --repo open-telemetry/opentelemetry-operator --state merged --label "breaking" --limit 20 --json number,title,mergedAt,url

Filter to components in the downstream build. If gh CLI unavailable, return empty findings with a note.`,
  })
}

if ((method === 'all' || method === 'doc-validation') && docsPath) {
  const docComponents = documentedComponents
    .filter(c => c.doc_file)
    .map(c => `- ${docsPath}/otel-collector/modules/${c.doc_file} → ${c.repo === 'collector_contrib' ? contribPath : corePath}/${c.source_dir}/config.go`)
    .join('\n')

  analysisMethods.push({
    key: 'doc-validation',
    label: 'doc-config-validation',
    prompt: `You are validating Red Hat build of OpenTelemetry documentation against current upstream code.

TASK: Check documented config options still exist upstream, and find new options not yet documented.

DOC-TO-SOURCE MAPPINGS (auto-discovered from manifest.yaml and doc globs):
${docComponents}

INSTRUCTIONS:
1. For the 6 most critical documented components (pick GA components with the most config surface):
   a. Read the .adoc file — extract config parameter names from YAML examples and parameter tables
   b. Read the corresponding config.go — extract struct fields via mapstructure tags
   c. Flag: documented fields removed upstream (DOC_STALE, HIGH), new required fields not in docs (DOC_MISSING, HIGH), new optional fields (DOC_MISSING, LOW)

2. Check component name drift: grep the docs for deprecated names (filelog vs file_log, kubeletstats vs kubelet_stats, loadbalancing vs load_balancing).

${docDrift.length > 0 ? `3. These doc files exist but NO matching component was found in the manifest (possible removed component):
${docDrift.map(d => `   - ${d.doc_file} (${d.type})`).join('\n')}
   Flag each as COMPONENT_DRIFT, MEDIUM severity.` : ''}

Return findings with category, component, field name, recommended action.`,
  })
}

// Test coverage runs as a separate agent with its own schema (not part of analysisMethods)
// so we can pass the full matrix to the report generator.

if (method === 'all' || method === 'dependencies') {
  analysisMethods.push({
    key: 'dependencies',
    label: 'dependency-tracking',
    prompt: `You are tracking dependency changes in upstream OpenTelemetry repos.

TASK: Find significant dependency version bumps between downstream base and upstream HEAD.

REPOS AND TAGS:
- Operator: ${operatorPath} — diff ${operatorBase}..origin/main
- Collector-core: ${corePath} — diff ${coreBase}..origin/main

INSTRUCTIONS:
1. Operator go.mod diff: git diff ${operatorBase}..origin/main -- go.mod
   Focus on: k8s.io/*, controller-runtime, collector/*, cert-manager, Go version.

2. Operator versions.txt diff: git diff ${operatorBase}..origin/main -- versions.txt

3. Collector-core go.mod diff: git diff ${coreBase}..origin/main -- go.mod

Severity: HIGH (major bumps, Go version), MEDIUM (minor in critical deps), LOW (patch).`,
  })
}

// Build the component list for the coverage agent
const componentList = components.map(c =>
  `${c.type}/${c.source_dir} (doc: ${c.has_doc})`
).join('\n')

// Build coverage agent prompt (runs separately from analysis agents to avoid positional splitting)
const coveragePrompt = (method === 'all' || method === 'test-coverage') ? {
  label: 'test-coverage-matrix',
  prompt: `You are building a complete test coverage matrix for all Red Hat build of OpenTelemetry components.

TASK: For EVERY component in the downstream build, determine its test coverage status across both upstream and QE test repos. Produce a full matrix — not just gaps.

REPOS:
- Upstream operator tests: ${operatorPath}/tests/
${qePath ? `- QE tests: ${qePath}/tests/` : '(QE test repo not available — set qe_test to "none" for all components)'}

ALL COMPONENTS IN BUILD (${components.length} total, auto-discovered from manifest.yaml):
${componentList}

INSTRUCTIONS:

1. FOR EACH COMPONENT, determine test coverage:

   a. Check for a DEDICATED upstream test directory:
      ls -d ${operatorPath}/tests/e2e*/<component_short_name>/ 2>/dev/null
      ls -d ${operatorPath}/tests/e2e*/<component_dir_name>/ 2>/dev/null
      If found: upstream_test = "dedicated", upstream_test_path = the path found.

   b. If no dedicated test, check for IMPLICIT coverage (component name in any YAML):
      grep -rl "<component_short_name>" ${operatorPath}/tests/ 2>/dev/null | head -3
      If found: upstream_test = "implicit", upstream_test_path = first match.

   c. If neither: upstream_test = "none".

   d. Repeat for QE tests:
      ${qePath ? `ls -d ${qePath}/tests/e2e-otel/<component_short_name>/ 2>/dev/null
      grep -rl "<component_short_name>" ${qePath}/tests/ 2>/dev/null | head -3` : 'Skip — QE repo not available.'}

   The component_short_name is the last part of source_dir (e.g., "jaegerreceiver" from "receiver/jaegerreceiver").

2. DETECT UPSTREAM TEST CHANGES since the downstream base:
   Run: git diff ${operatorBase}..origin/main --stat -- tests/
   in the operator repo.
   - Deleted test files: MEDIUM severity finding
   - New test files for documented components: informational

3. Return:
   - coverage_matrix: one entry per component with all fields
   - summary: counts of total, with_upstream_test, with_qe_test, with_any_test, with_no_test, documented_with_no_test
   - test_change_findings: any test deletion/modification findings`,
} : null

// Run analysis agents and coverage agent separately to avoid positional result splitting
const analysisResults = analysisMethods.length > 0
  ? await parallel(analysisMethods.map(m => () =>
      agent(m.prompt, { label: m.label, phase: 'Analyze', schema: FINDINGS_SCHEMA })
    ))
  : []

const coverageResult = coveragePrompt
  ? await agent(coveragePrompt.prompt, { label: coveragePrompt.label, phase: 'Analyze', schema: COVERAGE_SCHEMA })
  : null

log(`Analysis complete. ${analysisMethods.length} regression methods + ${coverageResult ? '1 coverage matrix' : 'no coverage'} returned.`)

// ── Phase 4: Synthesize ──
phase('Synthesize')

// Merge regression findings from analysis methods
const allFindings = analysisResults
  .map((r, i) => ({ result: r, method: analysisMethods[i] }))
  .filter(entry => entry.result)
  .flatMap(entry => (entry.result.findings || []).map(f => ({
    ...f,
    detection_method: entry.method.key,
  })))

// Merge test change findings from coverage agent
if (coverageResult && coverageResult.test_change_findings) {
  coverageResult.test_change_findings.forEach(f => {
    allFindings.push({ ...f, detection_method: 'test-coverage' })
  })
}

const findingsSummary = allFindings.map(f =>
  `[${f.severity}] [${f.category}] ${f.component}: ${f.title} (via: ${f.detection_method})`
).join('\n')

// Build the coverage matrix table for the report
const coverageMatrix = coverageResult ? coverageResult.coverage_matrix : []
const coverageSummary = coverageResult ? coverageResult.summary : null
const coverageTable = coverageMatrix.map(c =>
  `| ${c.component} | ${c.component_type} | ${c.has_doc ? 'Yes' : 'No'} | ${c.upstream_test} | ${c.qe_test} |`
).join('\n')

const report = await agent(`You are generating the final regression detection report.

TASK: Synthesize findings and test coverage into a comprehensive markdown report and JSON summary.

DOWNSTREAM BASE: operator ${operatorBase} (v${operatorVersion}), collector ${contribBase}
COMPONENTS IN BUILD: ${components.length} (discovered from manifest.yaml)
DOCUMENTED COMPONENTS: ${documentedComponents.length}
${docDrift.length > 0 ? `DOCS WITHOUT MATCHING BUILD COMPONENT: ${docDrift.length}` : ''}

ALL FINDINGS (${allFindings.length} total):
${findingsSummary || '(no findings)'}

DETAILED FINDINGS:
${JSON.stringify(allFindings, null, 2)}

${coverageSummary ? `TEST COVERAGE SUMMARY:
- Total components: ${coverageSummary.total_components}
- With upstream test: ${coverageSummary.with_upstream_test}
- With QE test: ${coverageSummary.with_qe_test}
- With any test: ${coverageSummary.with_any_test}
- With NO test: ${coverageSummary.with_no_test}
- Documented but no test: ${coverageSummary.documented_with_no_test || 'N/A'}` : '(no coverage data)'}

TEST COVERAGE MATRIX:
| Component | Type | Documented | Upstream Test | QE Test |
|-----------|------|------------|---------------|---------|
${coverageTable || '(no data)'}

INSTRUCTIONS:
1. Deduplicate findings (same issue from multiple methods → keep highest severity, note all methods).
2. Sort by severity: CRITICAL → HIGH → MEDIUM → LOW.
3. Generate markdown report with ALL of these sections:

# Regression Detection Report — <today's date>

## Summary
- Downstream base: operator ${operatorBase} (v${operatorVersion}), collector ${contribBase}
- Release branch: ${releaseBranch}
- Components in build: ${components.length} | Documented: ${documentedComponents.length}
- Findings: N (Critical: X, High: Y, Medium: Z, Low: W)
- Test coverage: X/${coverageSummary ? coverageSummary.total_components : '?'} components have at least one test

## Critical Findings
<table or list of critical findings with details>

## High Priority
<table or list>

## Medium Priority
<table or list>

## Low Priority
<table or list>

## Test Coverage Report
Include the FULL coverage matrix table showing every component, whether it's documented, and its upstream/QE test status. Highlight components with zero coverage. Group by component type (receivers, processors, exporters, connectors, extensions).

### Coverage Summary
Include the summary stats (total, covered, uncovered, documented-but-untested).

### Components with No Test Coverage
List specifically which components have no test at all, with their doc status.

## Documentation Drift
<any doc-only components or stale doc findings>

## Recommendations
<actionable items: tests to write, docs to update, configs to validate>

4. Return report_markdown and summary_counts.`, {
  label: 'report-generator',
  phase: 'Synthesize',
  schema: REPORT_SCHEMA,
})

return report
