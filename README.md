# Red Hat build of OpenTelemetry Workspace

Cross-repo workspace for Red Hat build of OpenTelemetry — shared specs, routing, and AI conventions.

## Repositories

| Repo                                                                                                              | Purpose                                                               |
|-------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------|
| [opentelemetry-collector](https://github.com/open-telemetry/opentelemetry-collector)                              | Core collector                                                        |
| [opentelemetry-collector-contrib](https://github.com/open-telemetry/opentelemetry-collector-contrib)              | Collector contrib with all components                                 |
| [redhat-opentelemetry-collector](https://github.com/os-observability/redhat-opentelemetry-collector)              | Red Hat distribution of the collector                                 |
| [opentelemetry-operator](https://github.com/open-telemetry/opentelemetry-operator)                                | Kubernetes operator                                                   |
| [konflux-opentelemetry](https://github.com/os-observability/konflux-opentelemetry)                                | Downstream productization repository, contains all product components |
| [redhat-build-of-opentelemetery-docs](https://github.com/openshift/openshift-docs/tree/standalone-otel-docs-main) | Documentation for the Red Hat build of OpenTelemetry  |

## Setup

Clone all repos into this directory:

```bash
for repo in opentelemetry-collector opentelemetry-collector-contrib opentelemetry-operator; do
  git clone git@github.com:open-telemetry/$repo.git
done
for repo in redhat-opentelemetry-collector konflux-opentelemetry; do
  git clone git@github.com:os-observability/$repo.git
done
git clone --single-branch --branch standalone-otel-docs-main git@github.com:openshift/openshift-docs.git
```

Pull all repos:

```bash
for d in opentelemetry-collector opentelemetry-collector-contrib opentelemetry-operator \
  redhat-opentelemetry-collector konflux-opentelemetry openshift-docs; do
  [ -d "$d/.git" ] && echo "=== $d ===" && git -C "$d" pull --ff-only
done
```

## Specs

All specifications live in `.ai/spec/`. Start with [`.ai/spec/README.md`](.ai/spec/README.md) for the product overview and reading guide. Use [`.ai/spec/how/repo-map.md`](.ai/spec/how/repo-map.md) to find which repo and spec file to update for a given concern.

1. New spec files should be created with `/superpowers:brainstorming` [skill](https://github.com/obra/superpowers/tree/main) skill. 
As an input use product requirements or design ideas. The output is a set of spec files in `.ai/spec/` that can be used to implement the feature.
2. After the spec files are created, in the same session run `/superpowers:brainstorming` skill again to create Jira tickets for the spec files.
3. For implementation, use `/superpowers:implementation` skill with the Jira ticket as an input. After the implementation is done ask agent to update the spec files based on the implementation. 

### Create initial spec files

Use the `/spec-first:init` was used to create initial set of spec files. To install the `spec-first` plugin, run:
```bash
/plugin marketplace add joshuawilson/spec-first
/plugin install spec-first@spec-first-marketplace
```

## Conventions

- **Jira**: Project key `TRACING` on `redhat.atlassian.net`
- **Git workflow**: Fork-based — push to your fork, PR against `origin/main`, squash before pushing
- **Per-repo guides**: Each repo has an `AGENTS.md` with repo-specific conventions
