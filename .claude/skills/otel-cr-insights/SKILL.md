---
name: otel-cr-insights
description: >
  Write Snowflake queries to analyze OpenTelemetry Collector CR usage from
  insights archives. Use when the user asks to analyze OpenTelemetry Collector CR usage patterns from insights archives.
argument-hint: "[query-description or use-case]"
---

# OpenTelemetry CR Insights Query Skill

Write Snowflake queries to analyze OpenTelemetry Collector custom resource usage patterns from Red Hat OpenShift insights archives.

## When to Use This Skill

Use this skill when:
- Writing queries to analyze OTel collector adoption, component usage, or configuration patterns
- Understanding what data is available from insights archives
- Need to know which CR fields are collected and which are stripped
- Checking data collection limits or potential gaps
- Building dashboards or reports on collector usage

## Query Execution Options

### Option 1: Dataverse MCP (Cursor IDE Only)

**For Cursor IDE users**, you can query Snowflake directly using the Dataverse MCP server:

1. Add the MCP server in Cursor Settings → Tools & MCP → Add New MCP Server:
   ```json
   {
     "mcpServers": {
       "dataverse": {
         "url": "https://mcp.dataverse.redhat.com/mcp/"
       }
     }
   }
   ```

2. Toggle on the `dataverse` server and complete Red Hat SSO authentication in your browser

3. Use the MCP tools to query Snowflake directly without opening the Snowflake console

**Prerequisites:**
- Connected to Red Hat VPN
- Cursor IDE (the MCP server is not compatible with Claude Code CLI)

**Reference:** https://dataverse.pages.redhat.com/consumer/use/dataverse-agent/#direct-mcp-usage-in-cursor

### Option 2: Snowflake Console (All Users)

**For Claude Code CLI users** or those who prefer manual queries, use the Snowflake web console:

## Data Source

The OpenTelemetry Collector CR data is stored in Snowflake:

**Database**: `LIGHTSPEEDARCHIVES_DB.INSIGHTS_MARTS.ARCHIVES`

**Service ID**: `insights_daily`

**File path pattern**: `config/opentelemetry/%` (format: `config/opentelemetry/{namespace}/{name}`)

**CR Kind**: `OpenTelemetryCollector` (from `opentelemetry.io/v1beta1`)

**Access:**
- Via MCP (Cursor IDE): Use the Dataverse MCP server (see Option 1 above)
- Via Web UI: [Snowflake Console](https://app.snowflake.com/gdadclc/rhprod/#/homepage) (see Option 2 above)

## How to Execute Queries (Snowflake Console)

**This section applies to Option 2 (manual Snowflake console). If using the Dataverse MCP in Cursor, you can query directly via MCP tools.**

1. Navigate to the [Snowflake Console](https://app.snowflake.com/gdadclc/rhprod/#/homepage)
2. In the left sidebar, click **Projects** → **Worksheets**
3. Click **+ Worksheet** to create a new SQL worksheet
4. In the worksheet context selector (top right), select:
   - **Role**: `LIGHTSPEEDARCHIVES_INSIGHTSMARTS_GROUP` with `DEFAULT` warehouse (required — queries fail without this role)
   - This role provides read access to the insights data
5. Paste your query into the worksheet
6. Click **Run** (or press `Ctrl+Enter` / `Cmd+Enter`) to execute
7. Results appear in the **Results** pane below the query editor
8. Optionally, click **⋮** (three dots) on the results pane to download as CSV or other formats

## Collection Implementation

The OpenTelemetry Collector CR collection is implemented in the insights-operator:

**Primary source file**: 
- https://github.com/openshift/insights-operator/blob/master/pkg/gatherers/clusterconfig/gather_opentelemetry_collectors.go

**Key function**: `gatherOpenTelemetryCollectors`

**API reference**:
- https://github.com/open-telemetry/opentelemetry-operator/blob/main/apis/v1beta1/opentelemetrycollector_types.go

**Sample archive data**:
- https://github.com/openshift/insights-operator/blob/master/docs/insights-archive-sample/config/opentelemetry/example-namespace/otel.json

## Collection Limits

**Only the first 5 OpenTelemetryCollector CRs per cluster are collected**, so component usage queries can undercount clusters with more than 5 CRs. See [reference.md](reference.md#collection-limits) for the detection query and details.

## Fields Collected

Only `spec.config.service` (pipelines, extensions, telemetry), metadata, and a few top-level spec/status fields are collected. Component **configuration** (`spec.config.receivers/exporters/processors/extensions/connectors`) is stripped for privacy — you can see which components are referenced, not their config. See [reference.md](reference.md#fields-collected) for the full field list and a sample CR.

## Data Structure

Component names use `<type>[/<instance-name>]` and pipeline keys use `<signal>[/<name>]` — use `SPLIT_PART(name, '/', 1)` to extract the type/signal. See [reference.md](reference.md#data-structure) for examples and a sample archived CR.

## Standard Query Pattern

Every query should use a `clusters_dedup` CTE (external customers only, deduplicated) and a `crs` CTE (latest archive per CR). See [reference.md](reference.md#standard-query-pattern) for the full template and CTE-by-CTE explanation, including why Red Hat/IBM email domains are excluded.

## Ready-to-Use Queries

For complete, copy-paste-ready Snowflake queries, see **[queries.md](queries.md)**.

The queries file includes:
1. **Component Usage by Type** - Which receivers, processors, exporters, connectors, and extensions are most used
2. **Signal Adoption** - How many clusters collect logs, metrics, and/or traces
3. **Multi-Signal Adoption** - Signal combinations (logs+metrics+traces)
4. **Deployment Mode Distribution** - DaemonSet vs Deployment usage
5. **CR Density Per Cluster** - How many collector CRs per cluster

---

## Best Practices

### 1. Always Filter to External Clusters

Use the `clusters_dedup` CTE to exclude internal Red Hat clusters, CI clusters, and test environments.

### 2. Always Deduplicate CRs

Use `QUALIFY ROW_NUMBER() OVER (PARTITION BY system_id, file_path ORDER BY received_at DESC) = 1` to get the latest archive per CR.

### 3. Use SPLIT_PART for Component Names

Component and pipeline names may include instance names (e.g., `otlphttp/production`). Use `SPLIT_PART(name, '/', 1)` to extract the type.

### 4. Deduplicate Before Counting

A component may appear in multiple pipelines within the same CR. Use `SELECT DISTINCT system_id, component_type` before counting clusters.

### 5. Handle NULL/Missing Fields

Use `COALESCE()` and `NULLIF()` for optional fields:
```sql
COALESCE(NULLIF(a.content:spec:mode::STRING, ''), 'unset') AS mode
```

## References

- [reference.md](reference.md) - Collection limits, full field list, sample CR JSON, standard query template
- [Insights Operator GitHub](https://github.com/openshift/insights-operator)
- [OpenTelemetry Operator API](https://github.com/open-telemetry/opentelemetry-operator/blob/main/apis/v1beta1/opentelemetrycollector_types.go)
- [OpenTelemetry Collector Documentation](https://opentelemetry.io/docs/collector/)
