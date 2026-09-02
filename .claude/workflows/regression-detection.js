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
    operator_feature_matrix: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          feature: { type: 'string' },
          description: { type: 'string' },
          upstream_test: { type: 'string', enum: ['dedicated', 'none'] },
          qe_test: { type: 'string', enum: ['dedicated', 'implicit', 'none'] },
          qe_test_path: { type: 'string' },
        },
        required: ['feature', 'upstream_test', 'qe_test'],
      },
    },
    feature_summary: {
      type: 'object',
      properties: {
        total_features: { type: 'number' },
        with_qe_test: { type: 'number' },
        with_no_test: { type: 'number' },
      },
      required: ['total_features', 'with_qe_test', 'with_no_test'],
    },
  },
  required: ['coverage_matrix', 'summary', 'test_change_findings', 'operator_feature_matrix', 'feature_summary'],
}

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    report_html: { type: 'string' },
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
  required: ['report_html', 'summary_counts'],
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
  return { report_html: '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Regression Detection — Failed</title></head><body><h1>Regression Detection — Failed</h1><p>Discovery phase failed. Check that konflux-opentelemetry is cloned with --recurse-submodules and contains manifest.yaml.</p></body></html>', summary_counts: { critical: 0, high: 0, medium: 0, low: 0, total: 0 } }
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
   - This diff also naturally surfaces new/deleted operator feature test suites (tests/e2e-*/) — note those too.

3. OPERATOR FEATURES (not collector components — operator-level capabilities like target allocator, OpAMP bridge, sidecar injection, autoscaling, etc.):

   a. Discover the feature list dynamically:
      ls -d ${operatorPath}/tests/e2e-*/
      Exclude the generic harness dirs: "e2e" (bare), "test-e2e-apps", "step-templates".
      Each remaining "e2e-<name>" directory IS a dedicated upstream test suite for that feature — so upstream_test is always "dedicated" for every discovered feature (that's expected, not a bug: the point of this section is the QE/downstream column, not the upstream one).

   b. For each discovered feature, derive a short human-readable name and one-line description from the directory name (e.g. "e2e-targetallocator" -> feature "target-allocator", "e2e-opampbridge" -> feature "opamp-bridge", "e2e-autoscale" -> feature "autoscaling").

   c. For each feature, check downstream QE coverage:
      ${qePath ? `grep -rl "<feature keyword>" ${qePath}/tests/ 2>/dev/null | head -3
      Search across ${qePath}/tests/ (not just tests/e2e-otel/, which is component-focused — operator-feature tests may live in other suites under tests/), but stay within that tests/ tree. A match only counts as coverage if it's an actual test file or test fixture (a Go test file, a Ginkgo/Chainsaw test spec, a test-case YAML) — a mention in a README, doc, comment, or CI pipeline config does NOT count as coverage.
      If a clear match exists: qe_test = "dedicated" (a directory/file clearly dedicated to this feature) or "implicit" (feature mentioned within a broader test). If no qualifying match: qe_test = "none".` : 'QE repo not available — set qe_test to "none" for all features.'}

   d. Return operator_feature_matrix (one entry per discovered feature) and feature_summary (total_features, with_qe_test, with_no_test).

4. Return:
   - coverage_matrix: one entry per component with all fields
   - summary: counts of total, with_upstream_test, with_qe_test, with_any_test, with_no_test, documented_with_no_test
   - test_change_findings: any test deletion/modification findings
   - operator_feature_matrix and feature_summary as described above`,
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

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Findings carry free text sourced from upstream changelogs, GitHub issues, and PR
// titles. That text flows into the report-generation prompt below and ultimately
// into report_html, which is a self-contained HTML document opened directly in a
// browser (unlike the old markdown report, nothing else escapes it downstream) —
// so escape every free-text field here, before it ever reaches that prompt.
const allFindingsSafe = allFindings.map(f => ({
  ...f,
  title: f.title != null ? escapeHtml(f.title) : f.title,
  description: f.description != null ? escapeHtml(f.description) : f.description,
  component: f.component != null ? escapeHtml(f.component) : f.component,
  recommended_action: f.recommended_action != null ? escapeHtml(f.recommended_action) : f.recommended_action,
  upstream_pr: f.upstream_pr != null ? escapeHtml(f.upstream_pr) : f.upstream_pr,
  affected_config_fields: (f.affected_config_fields || []).map(escapeHtml),
}))

const findingsSummary = allFindingsSafe.map(f =>
  `[${f.severity}] [${f.category}] ${f.component}: ${f.title} (via: ${f.detection_method})`
).join('\n')

// Build the coverage data for the report. The matrices/bars/callouts below are
// pre-rendered here in JS (not left to the report-generation agent) because this
// data doesn't need creative synthesis, and pre-rendering guarantees every row
// appears — no risk of the model summarizing or truncating a long table.
const coverageMatrix = coverageResult ? coverageResult.coverage_matrix : []
const coverageSummary = coverageResult ? coverageResult.summary : null
const operatorFeatureMatrix = coverageResult ? (coverageResult.operator_feature_matrix || []) : []
const featureSummary = coverageResult ? coverageResult.feature_summary : null

const hasAnyTest = (row) => row.upstream_test !== 'none' || row.qe_test !== 'none'

const COMPONENT_TYPE_ORDER = ['receiver', 'processor', 'exporter', 'connector', 'extension']
const COMPONENT_TYPE_LABELS = { receiver: 'Receivers', processor: 'Processors', exporter: 'Exporters', connector: 'Connectors', extension: 'Extensions' }

const componentBarsHtml = COMPONENT_TYPE_ORDER.map(t => {
  const rows = coverageMatrix.filter(c => c.component_type === t)
  if (rows.length === 0) return ''
  const covered = rows.filter(hasAnyTest).length
  const pct = Math.round((covered / rows.length) * 100)
  return `<div class="bar-row"><span>${COMPONENT_TYPE_LABELS[t]}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><span>${covered} / ${rows.length}</span></div>`
}).filter(Boolean).join('\n')
const componentBarsBlock = componentBarsHtml ? `<div class="bars">\n${componentBarsHtml}\n</div>` : ''

const noCoverageComponents = coverageMatrix.filter(c => c.upstream_test === 'none' && c.qe_test === 'none')
const componentCalloutBlock = noCoverageComponents.length > 0
  ? `<div class="callout"><strong>⚠️ Components with no test coverage (${noCoverageComponents.length} of ${coverageMatrix.length})</strong><ul>\n${noCoverageComponents.map(c =>
      `<li><strong>${escapeHtml(c.component)}</strong> (${c.component_type}) — ${c.has_doc ? 'documented' : 'undocumented'}, no upstream or QE test</li>`
    ).join('\n')}\n</ul></div>`
  : ''

const componentMatrixHtml = COMPONENT_TYPE_ORDER.map(t => {
  const rows = coverageMatrix.filter(c => c.component_type === t)
  if (rows.length === 0) return ''
  const trs = rows.map(c => {
    const none = c.upstream_test === 'none' && c.qe_test === 'none'
    const nameCell = none ? `${escapeHtml(c.component)} <span class="tag-none">NONE</span>` : escapeHtml(c.component)
    return `<tr${none ? ' class="none"' : ''}><td>${nameCell}</td><td>${c.has_doc ? 'Yes' : 'No'}</td><td>${c.upstream_test}</td><td>${c.qe_test}</td></tr>`
  }).join('\n')
  return `<div class="matrix-group"><h4 class="group">${COMPONENT_TYPE_LABELS[t]} (${rows.length})</h4><table><thead><tr><th>Component</th><th>Documented</th><th>Upstream Test</th><th>QE Test</th></tr></thead><tbody>\n${trs}\n</tbody></table></div>`
}).filter(Boolean).join('\n')
const componentMatrixBlock = coverageMatrix.length > 0
  ? `<details class="matrix"><summary>Show full coverage matrix (${coverageMatrix.length} components)</summary>\n${componentMatrixHtml}\n</details>`
  : ''

// Operator features: same pre-rendering treatment as components above.
const featureCovered = operatorFeatureMatrix.filter(f => f.qe_test !== 'none').length
const featurePct = operatorFeatureMatrix.length ? Math.round((featureCovered / operatorFeatureMatrix.length) * 100) : 0
const featureBarsBlock = operatorFeatureMatrix.length
  ? `<div class="bars">\n<div class="bar-row"><span>Operator features</span><div class="bar-track"><div class="bar-fill" style="width:${featurePct}%"></div></div><span>${featureCovered} / ${operatorFeatureMatrix.length}</span></div>\n</div>`
  : ''

const noCoverageFeatures = operatorFeatureMatrix.filter(f => f.qe_test === 'none')
const featureCalloutBlock = noCoverageFeatures.length > 0
  ? `<div class="callout"><strong>⚠️ Operator features with no QE test (${noCoverageFeatures.length} of ${operatorFeatureMatrix.length})</strong><ul>\n${noCoverageFeatures.map(f =>
      `<li><strong>${escapeHtml(f.feature)}</strong>${f.description ? ` — ${escapeHtml(f.description)}` : ''} — upstream: dedicated, no QE test</li>`
    ).join('\n')}\n</ul></div>`
  : ''

const featureMatrixBlock = operatorFeatureMatrix.length > 0
  ? `<details class="matrix"><summary>Show full operator feature matrix (${operatorFeatureMatrix.length} features)</summary>\n<table><thead><tr><th>Feature</th><th>Upstream Test</th><th>QE Test</th></tr></thead><tbody>\n${operatorFeatureMatrix.map(f => {
      const none = f.qe_test === 'none'
      const nameCell = none ? `${escapeHtml(f.feature)} <span class="tag-none">NONE</span>` : escapeHtml(f.feature)
      return `<tr${none ? ' class="none"' : ''}><td>${nameCell}</td><td>${f.upstream_test}</td><td>${f.qe_test}</td></tr>`
    }).join('\n')}\n</tbody></table>\n</details>`
  : ''

// The exact, validated design-system CSS — copied verbatim into every generated report
// so visual output is deterministic across runs rather than left to model taste.
const REPORT_CSS = `
:root{
  color-scheme: light;
  --surface:#fcfcfb; --page:#f9f9f7; --border:rgba(11,11,11,0.10); --grid:#e1e0d9;
  --text:#0b0b0b; --text-2:#52514e; --muted:#898781;
  --accent:#2a78d6; --accent-tint:#cde2fb; --accent-tint-2:#9ec5f4;
  --critical:#d03b3b; --serious:#ec835a; --warning:#fab219; --good:#0ca30c;
  --critical-tint:#fbe4e4; --serious-tint:#fce4db; --warning-tint:#fef0d3; --good-tint:#dff3df;
  --shadow-sm:0 1px 2px rgba(11,11,11,0.04); --shadow-md:0 10px 30px -12px rgba(11,11,11,0.18);
}
@media (prefers-color-scheme: dark){
  :root{
    color-scheme: dark;
    --surface:#1a1a19; --page:#0d0d0d; --border:rgba(255,255,255,0.10); --grid:#2c2c2a;
    --text:#ffffff; --text-2:#c3c2b7; --muted:#898781;
    --accent:#3987e5; --accent-tint:#18314f; --accent-tint-2:#123055;
    --critical:#d03b3b; --serious:#ec835a; --warning:#fab219; --good:#0ca30c;
    --critical-tint:#3a1a1a; --serious-tint:#3a2416; --warning-tint:#3a2f10; --good-tint:#123a13;
    --shadow-sm:0 1px 2px rgba(0,0,0,0.3); --shadow-md:0 14px 34px -14px rgba(0,0,0,0.55);
  }
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--page);color:var(--text);line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:980px;margin:0 auto;padding:0 20px 90px}
header.hero{margin:0 -20px 28px;padding:44px 20px 30px;background:radial-gradient(1200px 300px at 15% -20%, var(--accent-tint) 0%, transparent 60%),radial-gradient(900px 260px at 90% -30%, var(--accent-tint-2) 0%, transparent 55%),var(--surface);border-bottom:1px solid var(--border)}
header.hero .eyebrow{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:6px}
header.hero h1{font-size:2rem;margin:0 0 12px;letter-spacing:-0.01em}
.meta{display:flex;flex-wrap:wrap;gap:8px;color:var(--text-2);font-size:.85rem}
.meta span{background:var(--surface);border:1px solid var(--border);border-radius:99px;padding:5px 12px;box-shadow:var(--shadow-sm)}
nav.jump{position:sticky;top:0;z-index:20;background:color-mix(in srgb, var(--page) 88%, transparent);backdrop-filter:saturate(160%) blur(8px);-webkit-backdrop-filter:saturate(160%) blur(8px);padding:12px 0;border-bottom:1px solid var(--border);margin-bottom:32px;display:flex;gap:18px;flex-wrap:wrap;font-size:.85rem}
nav.jump a{color:var(--text-2);text-decoration:none;font-weight:600;padding:4px 2px;border-bottom:2px solid transparent;transition:color .15s ease, border-color .15s ease}
nav.jump a:hover{color:var(--accent);border-color:var(--accent)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:14px;margin-bottom:20px}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px 16px;box-shadow:var(--shadow-sm);transition:transform .18s ease, box-shadow .18s ease}
.kpi:hover{transform:translateY(-3px);box-shadow:var(--shadow-md)}
.kpi .n{font-size:2.1rem;font-weight:650;line-height:1.05;font-variant-numeric:proportional-nums}
.kpi .l{font-size:.75rem;color:var(--muted);margin-top:6px;display:flex;align-items:center;gap:6px}
.kpi .dot{width:9px;height:9px;border-radius:50%;display:inline-block}
.kpi.crit .n{color:var(--critical)} .kpi.crit .dot{background:var(--critical)}
.kpi.high .n{color:var(--serious)} .kpi.high .dot{background:var(--serious)}
.kpi.med .n{color:var(--warning)} .kpi.med .dot{background:var(--warning)}
.kpi.low .n{color:var(--good)} .kpi.low .dot{background:var(--good)}
.kpi.cov .n{color:var(--accent)} .kpi.cov .dot{background:var(--accent)}
.dist{margin-bottom:36px}
.dist .track{display:flex;gap:2px;height:14px;border-radius:7px;overflow:hidden;background:var(--grid)}
.dist .seg{height:100%}
.dist .seg.crit{background:var(--critical)} .dist .seg.high{background:var(--serious)} .dist .seg.med{background:var(--warning)} .dist .seg.low{background:var(--good)}
.dist .legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:.78rem;color:var(--text-2)}
.dist .legend span{display:inline-flex;align-items:center;gap:6px}
.dist .legend i{width:8px;height:8px;border-radius:50%;display:inline-block}
.dist .legend .crit i{background:var(--critical)} .dist .legend .high i{background:var(--serious)} .dist .legend .med i{background:var(--warning)} .dist .legend .low i{background:var(--good)}
h2.section{font-size:1.15rem;margin:44px 0 16px;padding-bottom:10px;border-bottom:1px solid var(--grid);display:flex;align-items:center;gap:8px;scroll-margin-top:64px}
.card{background:var(--surface);border:1px solid var(--border);border-left:4px solid transparent;border-radius:10px;padding:16px 20px;margin-bottom:12px;box-shadow:var(--shadow-sm);transition:transform .15s ease, box-shadow .15s ease}
.card:hover{transform:translateX(2px);box-shadow:var(--shadow-md)}
.card.crit{border-left-color:var(--critical)} .card.high{border-left-color:var(--serious)} .card.med{border-left-color:var(--warning)} .card.low{border-left-color:var(--good)}
.card h3{margin:0 0 8px;font-size:1rem;font-weight:650}
.badges{margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap}
.badge{font-size:.7rem;font-weight:600;padding:3px 10px;border-radius:99px;background:var(--page);border:1px solid var(--border);color:var(--text-2)}
.badge.id{font-family:ui-monospace,"SF Mono",Menlo,monospace;color:var(--muted);background:transparent;border-style:dashed}
.badge.sev{color:var(--text)}
.badge.sev.crit{background:var(--critical-tint)} .badge.sev.high{background:var(--serious-tint)} .badge.sev.med{background:var(--warning-tint)} .badge.sev.low{background:var(--good-tint)}
.card .impact{margin:0 0 4px;color:var(--text)}
.card details{margin-top:10px;font-size:.9rem;color:var(--text-2)}
.card details summary{cursor:pointer;color:var(--accent);font-weight:600;margin-bottom:8px;list-style:none}
.card details summary::-webkit-details-marker{display:none}
.card details summary::before{content:"▸ "}
.card details[open] summary::before{content:"▾ "}
.card details ul{margin:6px 0;padding-left:18px}
.card code{background:var(--page);border:1px solid var(--border);border-radius:4px;padding:1px 5px;font-size:.85em}
.bars{display:flex;flex-direction:column;gap:12px;margin-bottom:24px}
.bar-row{display:grid;grid-template-columns:150px 1fr 90px;align-items:center;gap:12px;font-size:.85rem}
.bar-track{background:var(--accent-tint);border-radius:6px;height:10px;overflow:hidden}
.bar-fill{background:var(--accent);height:100%;border-radius:6px}
.bar-row span:last-child{font-variant-numeric:tabular-nums;color:var(--text-2)}
.callout{border-radius:10px;padding:16px 20px;margin-bottom:24px;border:1px solid var(--critical);background:var(--critical-tint)}
.callout strong{display:flex;align-items:center;gap:6px;margin-bottom:6px}
.callout ul{margin:6px 0 0;padding-left:20px}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--grid)}
th{color:var(--muted);font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}
td{font-variant-numeric:tabular-nums}
tr:hover td{background:var(--page)}
details.matrix{margin-bottom:20px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 18px;box-shadow:var(--shadow-sm)}
details.matrix summary{cursor:pointer;font-weight:600;color:var(--accent);list-style:none}
details.matrix summary::-webkit-details-marker{display:none}
details.matrix summary::before{content:"▸ "}
details.matrix[open] summary::before{content:"▾ "}
details.matrix table{margin-top:14px}
h3.subsection{font-size:.72rem;margin:26px 0 10px;color:var(--text-2);font-weight:700;text-transform:uppercase;letter-spacing:.04em}
ol.reco-list{list-style:none;counter-reset:reco;padding:0;margin:0 0 8px;background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;box-shadow:var(--shadow-sm)}
ol.reco-list li{counter-increment:reco;padding:12px 18px 12px 52px;position:relative;border-bottom:1px solid var(--grid)}
ol.reco-list li:last-child{border-bottom:none}
ol.reco-list li::before{content:counter(reco);position:absolute;left:16px;top:11px;width:22px;height:22px;border-radius:50%;background:var(--accent-tint);color:var(--accent);font-size:.72rem;font-weight:700;display:flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums}
h4.group{font-size:.9rem;margin:18px 0 8px;color:var(--text)}
.matrix-group{margin-bottom:18px}
.matrix-group table{margin-bottom:0}
tr.none td{background:var(--critical-tint)}
tr.none td:first-child{font-weight:650}
.tag-none{display:inline-block;font-size:.68rem;font-weight:700;color:var(--critical);background:var(--critical-tint);border-radius:4px;padding:1px 6px;letter-spacing:.02em}
footer{margin-top:56px;color:var(--muted);font-size:.8rem;text-align:center}
@media (prefers-reduced-motion: no-preference){.card,.kpi{animation:rise .4s ease both}}
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
`.trim()

// These are parsed out of repo metadata (branch names, commit hashes, version
// strings) by the Discover phase — lower risk than upstream changelog prose, but
// still not something we typed ourselves, so escape before it reaches report_html.
const operatorBaseSafe = escapeHtml(operatorBase)
const operatorVersionSafe = escapeHtml(operatorVersion)
const contribBaseSafe = escapeHtml(contribBase)
const releaseBranchSafe = escapeHtml(releaseBranch)

const report = await agent(`You are generating the final regression detection report as a single self-contained HTML document.

TASK: Synthesize findings and test coverage into a polished HTML report and a JSON summary.

DOWNSTREAM BASE: operator ${operatorBaseSafe} (v${operatorVersionSafe}), collector ${contribBaseSafe}
UPSTREAM TARGET: origin/main
RELEASE BRANCH: ${releaseBranchSafe}
COMPONENTS IN BUILD: ${components.length} (discovered from manifest.yaml)
DOCUMENTED COMPONENTS: ${documentedComponents.length}
${docDrift.length > 0 ? `DOCS WITHOUT MATCHING BUILD COMPONENT: ${docDrift.length}` : ''}

ALL FINDINGS (${allFindings.length} total):
${findingsSummary || '(no findings)'}

DETAILED FINDINGS:
${JSON.stringify(allFindingsSafe, null, 2)}

${coverageSummary ? `COMPONENT TEST COVERAGE SUMMARY:
- Total components: ${coverageSummary.total_components}
- With upstream test: ${coverageSummary.with_upstream_test}
- With QE test: ${coverageSummary.with_qe_test}
- With any test: ${coverageSummary.with_any_test}
- With NO test: ${coverageSummary.with_no_test}
- Documented but no test: ${coverageSummary.documented_with_no_test || 'N/A'}` : '(no component coverage data)'}

${featureSummary ? `OPERATOR FEATURE COVERAGE SUMMARY:
- Total features: ${featureSummary.total_features}
- With QE test: ${featureSummary.with_qe_test}
- With NO test: ${featureSummary.with_no_test}` : '(no operator feature coverage data)'}

INSTRUCTIONS:

1. Deduplicate findings (same issue from multiple methods → keep highest severity, note all methods).
2. Sort by severity: CRITICAL → HIGH → MEDIUM → LOW.
3. Assign each finding a stable short ID per severity (CRIT-1, CRIT-2, HIGH-1, HIGH-2, MED-1, LOW-1, ...) and reuse those exact IDs when referencing findings in Recommendations, so every recommendation is traceable back to a finding card.
4. Produce report_html: ONE complete, self-contained HTML document (<!DOCTYPE html> through </html>). No external stylesheets, fonts, CDNs, or <script> tags — it must render fully offline when opened as a local file or downloaded as a CI artifact. The finding text above is already HTML-escaped; insert it as-is. Never emit a <script> tag, an event-handler attribute (onclick=, onerror=, etc.), or a javascript: URL anywhere in the output, regardless of what appears in the input data.

Copy this exact CSS into a single <style> block in <head>, unchanged:

<style>
${REPORT_CSS}
</style>

BODY STRUCTURE (use these exact classes so the CSS above applies correctly):

- <header class="hero"> containing a <div class="wrap" style="padding:0"> with: <div class="eyebrow">Red Hat build of OpenTelemetry</div>, an <h1> with a 🔎 emoji and "Regression Detection Report", and a <div class="meta"> of pill <span>s showing the date, downstream base, upstream target, and release branch.
- <div class="wrap"> wrapping everything below the header, containing:
  - <nav class="jump"> with anchor links to #critical #high #medium #low #coverage #operator-features #drift #recommendations — only include a link to a section that actually has content below.
  - <div class="kpis"> — one <div class="kpi crit|high|med|low|cov"> stat tile per severity (a <div class="n"> count and <div class="l"><span class="dot"></span>Label</div>), plus a "Components in build" tile.
  - <div class="dist"> — a single stacked <div class="track"> bar with one <div class="seg crit|high|med|low" style="width:X%"> per severity sized to its share of total findings, plus a <div class="legend"> listing each with its count.
  - <h2 class="section" id="critical">🔴 Critical Findings</h2> followed by one <div class="card crit"> per critical finding (same pattern for High/🟠/id="high", Medium/🟡/id="medium", Low/🟢/id="low"). Each card: a <div class="badges"> row with a <span class="badge id"> (the stable ID from step 3), a <span class="badge sev crit|high|med|low">SEVERITY</span>, a category badge, and a component badge; an <h3> title; a one-line <p class="impact">; and a <details><summary>Details</summary>...</details> with introduced-in/reference/full description/affected fields/recommended action. Skip a severity's <h2> and nav link entirely if it has zero findings.
  - <h2 class="section" id="coverage">🧪 Test Coverage Report</h2> then insert this pre-rendered block verbatim (already correctly empty if there's no data — do not add your own bars):
${componentBarsBlock || '(no component coverage bars — omit)'}
    Then insert this pre-rendered callout verbatim (already omitted if there are zero uncovered components — do not add your own):
${componentCalloutBlock || '(no uncovered components — omit this callout entirely)'}
    Then insert this pre-rendered collapsible matrix verbatim, in full, with no changes, truncation, or "N more rows" placeholders:
${componentMatrixBlock || '(no matrix data — omit)'}
  - <h2 class="section" id="operator-features">🧩 Operator Features</h2> — coverage of operator-level capabilities (target allocator, OpAMP bridge, sidecar injection, autoscaling, etc.), distinct from collector components above. Omit this entire section (and its nav link) if there is no operator feature data. Otherwise insert these pre-rendered blocks verbatim, unchanged, in full:
${featureBarsBlock || '(no feature bar — omit)'}
${featureCalloutBlock || '(no uncovered features — omit this callout)'}
${featureMatrixBlock || '(no feature matrix — omit)'}
  - <h2 class="section" id="drift">📄 Documentation Drift</h2> — a plain <table> of any doc-only components or stale doc findings. Skip if none.
  - <h2 class="section" id="recommendations">✅ Recommendations</h2> — group into three <h3 class="subsection"> blocks: "Immediate actions (before release)", "Before next release", "Documentation updates". Under each, an <ol class="reco-list"> of <li> items, each citing the finding ID(s) it addresses (e.g. "<strong>...</strong> (CRIT-1) — ...").
  - <footer>Generated by otel-regression-detection · Red Hat build of OpenTelemetry</footer>

The pre-rendered blocks above (bars, callouts, matrix tables) are already complete and correct — copy them exactly as given, with no paraphrasing, shortening, or "... N more rows ..." placeholders. Every finding must get its own card; never summarize multiple findings into one card or drop any to save space.

5. Return report_html (the full HTML document as a string) and summary_counts.`, {
  label: 'report-generator',
  phase: 'Synthesize',
  schema: REPORT_SCHEMA,
})

return report
