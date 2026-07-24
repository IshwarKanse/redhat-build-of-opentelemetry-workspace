# Build Pipeline

## Module Map

| File/Directory | Key Symbols | Responsibility |
|---|---|---|
| `redhat-opentelemetry-collector/manifest.yaml` | — | Declarative component selection for the collector distro |
| `redhat-opentelemetry-collector/Makefile` | `build`, `generate-schemas` | Downloads OCB, generates `_build/`, compiles binary |
| `redhat-opentelemetry-collector/_build/` | `main.go`, `components.go` | OCB-generated Go source (committed) |
| `konflux-opentelemetry/.gitmodules` | — | Pins operator and collector at product branches |
| `konflux-opentelemetry/Dockerfile.operator` | — | Multi-stage UBI9 build for operator image |
| `konflux-opentelemetry/Dockerfile.collector` | — | Multi-stage UBI9 build for collector image |
| `konflux-opentelemetry/Dockerfile.targetallocator` | — | Multi-stage UBI9 build for target allocator image |
| `konflux-opentelemetry/Dockerfile.bundle` | — | OLM bundle image |
| `konflux-opentelemetry/Dockerfile-v4-*.catalog` | — | Per-OCP-version FBC catalog images |
| `konflux-opentelemetry/.tekton/` | — | Tekton pipeline definitions (push/PR triggers) |
| `konflux-opentelemetry/bundle-patch/patch_csv.py` | — | Applies Red Hat CSV overlay |
| `konflux-opentelemetry/bundle-patch/update_bundle.sh` | — | Orchestrates bundle generation |
| `konflux-opentelemetry/scripts/snapshot-tool.py` | — | Updates pullspecs from Konflux snapshots |
| `konflux-opentelemetry/scripts/update-catalog.py` | — | Catalog regeneration |
| `konflux-opentelemetry/fips_check.sh` | — | Verifies binary FIPS compliance |

## Data Flow

```
manifest.yaml → OCB → _build/ (Go source) → Konflux Dockerfile → container image
                                                                      ↓
operator source (submodule) → Konflux Dockerfile ──────────────→ container image
                                                                      ↓
upstream bundle → patch_csv.py + bundle.env → patched bundle → bundle image
                                                                      ↓
catalog-template.yaml → opm render → per-OCP FBC ──────────→ catalog images
```

## Key Abstractions

**OCB (OpenTelemetry Collector Builder):** A code generator that reads `manifest.yaml` and produces a Go main package with all selected components registered. This is the only mechanism for adding/removing components from the distro.

**Hermetic builds:** Konflux builds prefetch Go modules and RPMs, then build in isolation. The `_build/` directory being committed ensures reproducibility.

**CSV patching:** The upstream operator generates a community OLM bundle. `patch_csv.py` overlays Red Hat-specific metadata without forking the entire bundle generation. `bundle.env` maps component names to registry pullspecs.

**Konflux nudging:** After a successful image build, Konflux automatically updates `catalog.env` with the new bundle pullspec, triggering FBC catalog rebuilds.

## Integration Points

| Consumer | Provider | Mechanism |
|---|---|---|
| `redhat-opentelemetry-collector` | `opentelemetry-collector`, `opentelemetry-collector-contrib` | Go module dependencies in `manifest.yaml` |
| `konflux-opentelemetry` | `opentelemetry-operator`, `redhat-opentelemetry-collector` | Git submodules at product branches |
| Konflux CI | `konflux-opentelemetry/.tekton/` | Tekton PipelineRun definitions with CEL triggers |
| OLM | FBC catalog images | Per-OCP catalog channel resolution |
| RPM repos (Fedora/EPEL) | `redhat-opentelemetry-collector/.packit.yaml` | packit SRPM builds |

## Implementation Notes

- The OCB version is pinned in the Makefile and must match the core collector version in `manifest.yaml`.
- Tekton push pipelines use `pipelinesascode.tekton.dev/on-cel-expression` to trigger only on relevant file changes.
- Multi-arch builds target amd64, arm64, ppc64le, s390x. The `check-image-multiarch.sh` script verifies all architectures are present.
- The `versions.txt` file in the operator submodule provides version info injected via `-ldflags` at compile time.
