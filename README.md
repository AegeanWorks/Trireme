# Trireme

[![Built with AIKit](https://img.shields.io/badge/built%20with-AIKit-6f42c1)](https://github.com/AegeanWorks/AIKit)

Trireme is an offline sailing route planner: deterministic shortest-time routing over small sea charts.

You describe a grid of water, land, a prevailing wind and optional local currents in a plain text chart. Trireme finds the fastest route with Dijkstra over eight headings, costs each move by wind and current alignment, and breaks ties by coordinate — so the same chart and endpoints always produce the same route. It is a search tool, not a checksum or file-verification tool.

## ⚡ 30-Second Cold-Start Quick Reference

- **Runtime Prerequisites**: Rust 1.70 or newer (edition 2021); no third-party crates and no network access at build or run time.
- **Canonical Regression Shield Gate**:
  ```bash
  cargo test
  ```
- **Try it** (from the project root):
  ```bash
  cargo run -- chart examples/aegean.txt
  cargo run -- route examples/aegean.txt --from 0,2 --to 7,0 --ascii
  # exit 0 = route found, 1 = unreachable, 2 = bad chart or arguments
  ```
- **Browser UI** (no dependencies, no build step):
  ```bash
  cargo run -- serve --project .     # http://127.0.0.1:7878/
  ```
  Pick a preset, edit the chart and endpoints, press **Plan route**, and read the headings, waypoints and ASCII map on the right. **Save chart** / **Load saved** keep a chart in this browser's local storage; **Export route** downloads the last answer as JSON. The page calls `/api/route`, which shares its route document with `route --json`.
- **Client logic proof** (Node 18+): `node --test web/app.test.js`

### 🛠️ Commands

| Command | What it does |
|---|---|
| `trireme chart <chart> [--json]` | Describe the grid, wind, land and current count. |
| `trireme route <chart> --from X,Y --to X,Y [--ascii] [--json]` | Print the headings, waypoints, time in integer units and cells explored; `--json` emits the shared machine-readable route document. |
| `trireme serve [--port N] [--project DIR]` | Serve the browser UI from `DIR/web` on loopback (default `7878`). |
| `trireme help` / `trireme --version` | Show usage or the version. |

### 🗺️ Chart format

```text
TRIREME-CHART v1
grid <width> <height>
wind <dx> <dy>                 # direction the wind blows toward; each -1..=1
land <x> <y>                   # repeatable, impassable
current <x> <y> <dx> <dy>      # repeatable local flow
```

Directives may appear in any order; blank lines and `#` comments are ignored. `grid` and `wind` are required exactly once. Coordinates start at `(0,0)` in the top-left corner.

Each move is orthogonal (distance 10) or diagonal (distance 14). Its time is `distance * 100 / speed`, where `speed = max(1, 10 + 2·wind·heading + 2·current·heading)`. All arithmetic is integer, which keeps results identical across platforms.

### 🛠️ AIKit Commands (run from the AIKit folder)

| Role | Command |
|---|---|
| Status, task and gates | `python aikit.py status trireme` |
| Phase 4: every gate | `python aikit.py check trireme` |
| Repair memory and map, then check | `python aikit.py fix trireme` |
| Resume an interrupted task | `python aikit.py resume trireme` |

## 📦 What's Inside

```text
trireme/
├── Cargo.toml                <- crate manifest; no dependencies
├── Cargo.lock                <- pinned versions for reproducible builds
├── examples/
│   └── aegean.txt            <- small example chart used in the quick start
├── web/
│   ├── index.html            <- chart editor and route results surface
│   ├── app.js                <- presets, save/load, export and JSON rendering
│   ├── app.test.js           <- node:test proofs of the pure client helpers
│   └── styles.css            <- theme variables and layout
├── src/
│   ├── main.rs               <- process entry point and exit code
│   ├── lib.rs                <- public library surface
│   ├── cli.rs                <- argument parsing and human-readable output
│   ├── chart.rs              <- chart format, parsing and validation
│   ├── json.rs               <- flat JSON reader and writer shared by CLI and API
│   ├── router.rs             <- Dijkstra routing, integer costs and ASCII map
│   └── web.rs                <- std-only HTTP server and JSON route API
├── tests/
│   ├── cli.rs                <- end-to-end proofs through the real binary
│   └── web.rs                <- loopback proof of the running server
├── inventory.py              <- AI-compat inventory: kind|name|locator lines (ADR-315)
├── demo.py                   <- AI-compat scripted drive: WORLD-DELTA lines (ADR-315)
├── README.md
├── LICENSE                   <- Aegean License 1.1 (AL-1.1): free personal use
├── COMMERCIAL.md             <- Commercial licensing terms
├── LICENSES/                 <- REUSE license texts
├── REUSE.toml                <- Machine-readable SPDX metadata
├── assets/                   <- generated logo and social preview candidates
├── .gitattributes            <- LF line endings on every platform
├── .gitignore                <- transient AIKit state excluded
└── .aikit/                   <- this project's memory: record, ledger, decisions
```

## 📜 License

Free for personal use under the Aegean License 1.1 (AL-1.1); see [LICENSE](LICENSE). Any commercial use needs the Aegean Commercial License 1.0 (ACL-1.0); see [COMMERCIAL.md](COMMERCIAL.md).
