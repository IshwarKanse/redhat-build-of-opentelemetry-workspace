.PHONY: clone-repos pull-repos remove-repos help

REPOS = \
	open-telemetry/opentelemetry-collector \
	open-telemetry/opentelemetry-collector-contrib \
	open-telemetry/opentelemetry-operator \
	os-observability/redhat-opentelemetry-collector \
	os-observability/konflux-opentelemetry \
	openshift/openshift-docs \
	openshift/distributed-tracing-console-plugin \
	openshift/logging-view-plugin \
	openshift/distributed-tracing-qe \
	openshift/release \
	stolostron/multicluster-observability-addon

REPO_DIRS = $(foreach r,$(REPOS),$(notdir $(r)))

# Clone all workspace repos into this directory (HTTPS — works in both local and CI)
# konflux-opentelemetry: --recurse-submodules to populate operator and collector submodules
# openshift-docs: --single-branch --branch to clone the standalone otel docs branch
clone-repos:
	@for repo in $(REPOS); do \
	  name=$$(basename $$repo); \
	  if [ -d "$$name/.git" ]; then \
	    echo "=== $$name already cloned ==="; \
	  else \
	    flags=""; \
	    if [ "$$name" = "konflux-opentelemetry" ]; then flags="--recurse-submodules"; fi; \
	    if [ "$$name" = "openshift-docs" ]; then flags="--single-branch --branch standalone-otel-docs-main"; fi; \
	    git clone $$flags https://github.com/$$repo.git; \
	  fi; \
	done

# Pull latest changes in all cloned repos
pull-repos:
	@for d in $(REPO_DIRS); do \
	  if [ -d "$$d/.git" ]; then \
	    echo "=== $$d ==="; \
	    git -C "$$d" pull --ff-only; \
	    if [ -f "$$d/.gitmodules" ]; then git -C "$$d" submodule update --init --recursive; fi; \
	  fi; \
	done

# Remove all cloned repos to start fresh (re-clone with make clone-repos)
remove-repos:
	@echo "This will delete all cloned repos. Press Ctrl+C to cancel, Enter to continue."
	@read _confirm
	@for d in $(REPO_DIRS); do \
	  if [ -d "$$d/.git" ]; then echo "Removing $$d..."; rm -rf "$$d"; fi; \
	done
	@echo "Done. Run 'make clone-repos' to re-clone."

help:
	@echo "Available targets:"
	@echo "  clone-repos    - Clone all workspace repos into this directory"
	@echo "  pull-repos     - Pull latest in all cloned repos"
	@echo "  remove-repos   - Delete all cloned repos to start fresh"
	@echo "  help           - Show this help"
