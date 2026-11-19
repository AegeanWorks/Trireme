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
  The browser surface is local-first: nothing is sent anywhere.

  - **Presets** — pick a built-in preset or type a name and press **Save as preset** to keep the current chart and endpoints in this browser. The **Saved presets** dropdown reloads them; **Filter saved presets** narrows by name, chart or endpoint, **Sort saved presets** orders by name or chart size. **Compare presets** shows a line-by-line diff of two saved charts (Rust `chart::diff` via `POST /api/chart-diff`) with **Copy diff**; a counts readout from `POST /api/diff-summary` has **Copy diff summary**. **Diff current vs right** compares the editor chart with the right-hand preset. **Validate presets** checks every saved name, chart and endpoint; **Copy preset stats** copies a stats block. **Export presets** / **Import presets** move the set as `trireme.presets.json` (schema `trireme.presets/1`, merged by name); **Delete preset**, **Rename preset** (chart unchanged) and **Duplicate preset** manage entries.
  - **Editing and planning** — edit the chart and endpoints, use **Swap endpoints** to reverse from/to or **Copy chart** to copy the chart text with its endpoints, then press **Plan route** (or Ctrl+Enter). The right panel shows headings, waypoints and the ASCII map, refreshed on every plan; **Step times** shows what each heading cost. **Clear editor** restores the default chart and endpoints.
  - **Live chart feedback** — a statistics line shows grid size, cell count, land, current counts and wind from Rust `Chart::stats` via `POST /api/stats`, with **Copy stats**. Invalid lines are listed with line numbers as you type, from structured `chart::issues` via `POST /api/issues`, with **Copy issues**. **Canonicalize** replaces the chart with its sorted Rust-normalized form via `POST /api/normalize`; **Copy fingerprint** copies the stable Rust ID; **Inspect chart** shows stats, fingerprint and issues from `POST /api/inspect`; **Export inspection** saves `trireme-inspection.json` (schema `trireme.inspection/1`) and **Import inspection** validates such a file.
  - **Calm-water comparison** — **Ctrl+Shift+C** (or the button) asks `POST /api/compare` to plan the same query twice in Rust, once as written and once against the `chart::calm` baseline, and reports the time difference. **Export comparison CSV** writes both scenarios and the saving to `trireme-comparison.csv`; **Export comparison JSON** writes the versioned `trireme.comparison/1` document; **Copy Markdown** puts a comparison table on the clipboard. See ADR-004.
  - **Chart files and output** — **Import file** reads a `.txt` chart from disk (header/grid/wind validated); **Download chart** writes the current chart back. **Save chart** / **Load saved** keep a chart in browser local storage. **Copy summary** copies a plain-text route report, **Copy CLI command** copies the exact `cargo run -- route ...` invocation, **Copy map** copies the ASCII map with its legend, and **Copy Markdown** copies a full report (metrics, headings, per-step times, fenced map). **Export route (JSON)** downloads the raw answer; **Export route (CSV)** writes `step,x,y,heading,time_units` rows.
  - **Route history** — the last 10 plans (chart text and endpoints included) stay in browser local storage. **Restore** reloads an entry; **Export JSON** saves all history as `trireme.history.json` and **Export CSV** writes the visible plans (chart, endpoints, time, steps, heading, note) to `trireme.history.csv`. **Import JSON** validates the schema and previews file count, new vs duplicate entries, kept total and timestamp range before **Apply import** merges it (deduped, newest first, 10-entry cap); **Cancel** discards it. The panel opens with a summary of plan count, total steps, unique charts and fastest/slowest/average time, plus **Copy summary**. **Filter history** narrows by endpoint, time, note or chart text with a live shown/total count; **Sort history** orders newest, oldest, fastest or slowest; **Undo last** removes only the newest entry and **Clear** empties the history.
  - **Help, bundle and reset** — **Help / shortcuts** opens an in-browser panel listing CLI commands, chart syntax and every UI control and shortcut; Escape closes it. The same panel has **Copy all data (JSON)**, which puts a versioned `trireme.bundle/1` document (current chart, presets and history) on the clipboard, and **Import bundle**, which validates such a document and previews incoming and kept presets/plans before **Apply import** merges its chart, presets and history; **Cancel** discards it. **Reset local data** (click twice to confirm) clears the saved chart, presets and history.

  The page calls `/api/route`, which shares its route document with `route --json`.
- **Client logic proof** (Node 18+): `node --test web/app.test.js`

### 🛠️ Commands

| Command | What it does |
|---|---|
| `trireme chart <chart> [--json] [--calm\|--stats\|--issues\|--normalize\|--fingerprint]` | Describe the chart; `--fingerprint` prints a stable ID of its canonical form. Other flags print a calm copy, counts, issues or a sorted copy. |
| `trireme route <chart> --from X,Y --to X,Y [--ascii] [--json]` | Print the headings, waypoints, total time, per-step times and cells explored; `--json` emits the shared route document including `step_times` (ADR-005). |
| `trireme import-inspection <file> [--out <file>]` | Validate and canonicalize a `trireme.inspection/1` document. |
| `trireme init <file> --width W --height H [--wind DX DY] [--force]` | Write a valid empty starter chart. |
| `trireme inspect <chart> [--json]` | Report stats, fingerprint and validation issues in one document. |
| `trireme diff <left> <right> [--summary] [--json]` | Show numbered line differences, or `--summary` for counts only. |
| `trireme compare <chart> --from X,Y --to X,Y [--json]` | Plan the same query with wind/currents and against the Rust calm baseline, then report the saving. |
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
