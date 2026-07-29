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
| [distributed-tracing-console-plugin](https://github.com/openshift/distributed-tracing-console-plugin)           | OpenShift console plugin for distributed tracing                     |
| [logging-console-plugin](https://github.com/openshift/logging-view-plugin) | OpenShift console plugin for logging view |

## Setup

Clone all repos into this directory:

```bash
for repo in opentelemetry-collector opentelemetry-collector-contrib opentelemetry-operator; do
  git clone git@github.com:open-telemetry/$repo.git
done
for repo in redhat-opentelemetry-collector konflux-opentelemetry; do
  git clone git@github.com:os-observability/$repo.git
done
for repo in distributed-tracing-console-plugin logging-view-plugin; do
  git clone git@github.com:openshift/$repo.git
done
git clone --single-branch --branch standalone-otel-docs-main git@github.com:openshift/openshift-docs.git
```

Pull all repos:

```bash
for d in opentelemetry-collector opentelemetry-collector-contrib opentelemetry-operator \
  redhat-opentelemetry-collector konflux-opentelemetry \
  distributed-tracing-console-plugin logging-view-plugin openshift-docs; do
  [ -d "$d/.git" ] && echo "=== $d ===" && git -C "$d" pull --ff-only
done
```

## Specs

All specifications live in `.ai/spec/`. Start with [`.ai/spec/README.md`](.ai/spec/README.md) for the product overview and reading guide. Use [`.ai/spec/how/repo-map.md`](.ai/spec/how/repo-map.md) to find which repo and spec file to update for a given concern.

1. Create spec: a new spec files should be created with `/superpowers:brainstorming` [skill](https://github.com/obra/superpowers/tree/main).
   ```
   > /superpowers:brainstorming create or update specs for https://redhat.atlassian.net/browse/TRACING-6499. Also consider https://redhat.atlassian.net/browse/OBSDA-1454 which is the parent
   ticket.
   ```
   As an input use product requirements or design ideas. The output should be a set of spec files in `.ai/spec/`.
1. Create Jira tickets: in the same session run `/make-jira-from-spec` skill to create Jira tickets from the spec files.
1. Implementation: use `/superpowers:brainstorming` skill with the Jira ticket as an input. After the implementation is done ask agent to update the spec files based on the implementation. 

### Create initial spec files

The `/spec-first:init` [skill](https://github.com/joshuawilson/spec-first) was used to create initial set of spec files. To install the `spec-first` plugin, run:
```bash
/plugin marketplace add joshuawilson/spec-first
/plugin install spec-first@spec-first-marketplace
```

Example prompt: 
> /spec-first:init create the specs. Document which features are supported and which not. The supported features are the ones that are documented in the docs. These features are either generally available (GA) or tech-preview (TP). If a feature is in the source code, but missing in docs, it is
not supported.

## Conventions

- **Jira**: Project key `TRACING` on `redhat.atlassian.net`
- **Git workflow**: Fork-based — push to your fork, PR against `origin/main`, squash before pushing
- **Per-repo guides**: Each repo has an `AGENTS.md` with repo-specific conventions
