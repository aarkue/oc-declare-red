# OC-DECLARE: Simplification of Object-Centric Declarative Process Models

Implementation of the OC-DECLARE framework for discovering and simplifying object-centric declarative process models from OCEL data.

## Quick Start / Demo

A web demo is available at **[oc-declare-reduction.vercel.app](https://oc-declare-reduction.vercel.app)**.
It allows exploring example models from the evaluation, applying lossless reduction or activity projections, and discovering new models.
As all code runs in the browser, very large datasets or models may not be supported.

## Repository Structure

```
.
├── rust/                      # Rust workspace
│   ├── oc-declare/            # Core library (discovery, reduction, conformance)
│   ├── cli/                   # Command-line interface
│   └── wasm/                  # WebAssembly bindings (wasm-bindgen)
├── frontend/                  # Interactive web visualization (React + WASM)
│   ├── src/
│   │   ├── oc-declare-viz/    # Visualization component (ReactFlow + ELK)
│   │   ├── wasm/              # WASM integration layer
│   │   └── App.tsx            # Main application
│   └── public/models/         # Pre-computed models from the evaluation
├── evaluation/                # Evaluation notebook and figures
│   ├── evaluation.ipynb       # Reproduces paper tables and figures
│   └── figures/               # Generated PDF figures
└── eval-datasets/             # OCEL datasets used in the evaluation (zipped)
```

## Quick Setup

### Web Visualization

The web visualization runs entirely in the browser via WebAssembly.
Pre-computed models from the evaluation are included for immediate exploration.

```bash
cd frontend
pnpm install
pnpm run dev
```

Open `http://localhost:5173` to:
- Browse pre-computed models for all evaluation datasets
- Upload an OCEL file (JSON or XML) and run discovery in the browser
- Apply lossless transitive reduction
- Project models onto activity subsets
- View model statistics (size, density, separability, etc.)

### Command-Line Interface

```bash
cd rust
cargo build --release

# Discover an OC-DECLARE model from an OCEL file
cargo run --release --package oc-declare-cli -- discover input.json -o model.json

# Apply lossless transitive reduction
cargo run --release --package oc-declare-cli -- reduce model.json -o reduced.json

# Full pipeline: discover + reduce in one step
cargo run --release --package oc-declare-cli -- pipeline input.json -o result.json

# Conformance checking
cargo run --release --package oc-declare-cli -- conformance model.json input.json

# OCEL statistics
cargo run --release --package oc-declare-cli -- info input.json

# Model statistics
cargo run --release --package oc-declare-cli -- stats model.json

# Project model onto a subset of activities
cargo run --release --package oc-declare-cli -- project model.json --activities "Act A" "Act B"
```

Both JSON and XML OCEL formats are supported.

### CLI Discovery Options

| Flag | Default | Description |
|------|---------|-------------|
| `-n, --noise-threshold` | 0.2 | Fraction of source events allowed to violate a constraint |
| `-r, --reduction` | none | Apply transitive reduction after discovery (`none` or `lossless`) |
| `--arrow-types` | AS, EF, EP | Arc types to consider |
| `--max-count-gen` | 20 | Max object count for candidate generation (0 = unlimited) |
| `--max-count-filter` | 20 | Max object count for candidate filtering (0 = unlimited) |
| `--no-refine` | (off) | Disable label refinement |
| `--o2o` | none | Object-to-object relationship mode |
| `--activities` | all | Restrict discovery to specific activities |

**Pre-pruning** (default): Both `--max-count-gen` and `--max-count-filter` default to 20,
limiting candidate generation to object types with at most 20 instances per event.

## Building the WASM Module

```bash
cd rust/wasm
wasm-pack build --target web
```

The built package in `rust/wasm/pkg/` is resolved by the frontend via a Vite alias.

## Architecture

### Discovery Pipeline

1. **Candidate generation**: Generate OC-DECLARE constraint candidates for each activity pair based on object involvement patterns
2. **Candidate filtering**: Verify candidates against the event log using the noise threshold
3. **Transitive reduction** (optional): Remove redundant constraints while preserving the transitive closure
4. **Label refinement** (optional): Refine object involvement labels based on actual object type associations

### Arc Types

- **AS** (Association): Activities share objects of a given type
- **EF** (Eventually-Follows): Target activity eventually occurs after source
- **EP** (Eventually-Precedes): Target activity eventually occurs before source

### Transitive Reduction

Lossless transitive reduction removes constraints implied by other constraints in the model. The reduction operates per arc type: an EF constraint from A to C can be removed if EF constraints A->B and B->C exist with compatible object involvement labels.

## Evaluation

The `evaluation/` directory contains a Jupyter notebook that reproduces the tables and figures from the paper.
It loads pre-computed models from `frontend/public/models/` and computes complexity metrics.

Requirements: `pip install pandas plotly kaleido networkx`

The OCEL datasets are provided as individual zip files in `eval-datasets/`. They must be uncompressed before use with the CLI or the web tool.

## Dependencies

- **Rust** (edition 2021): Core implementation
- **[process_mining](https://crates.io/crates/process_mining)** (v0.5): OCEL data structures and import/export
- **Node.js + pnpm**: Web visualization build tooling
- **wasm-pack**: Building the WASM module
