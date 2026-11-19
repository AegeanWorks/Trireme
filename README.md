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
  Pick a built-in preset, or type a name and press **Save as preset** to keep the current chart and endpoints in this browser; the **Saved presets** dropdown reloads them and **Filter saved presets** narrows it by name, chart or endpoint **Sort saved presets** orders it by name or chart size, and **Compare presets** shows a line-by-line diff of two saved charts and **Copy diff** puts that diff with both preset names on the clipboard, **Diff current vs right** compares the editor chart with the preset selected on the right, and **Validate presets** checks every saved name, chart and endpoint, naming any broken entries, and **Copy preset stats** copies a stats block for the selected preset; **Export presets** / **Import presets** move the whole set as `trireme.presets.json` (schema `trireme.presets/1`, merged by name on import), **Delete preset** removes the selected one, and **Rename preset** renames it without changing its chart, and **Duplicate preset** copies it under a new name. Edit the chart and endpoints, use **Swap endpoints** to reverse the from/to coordinates or **Copy chart** to put the chart text with its endpoints on the clipboard, then press **Plan route** (or Ctrl+Enter) and read the headings, waypoints and ASCII map on the right; **Clear editor** restores the default chart and endpoints; **Ctrl+Shift+C** runs the calm-water comparison. A live statistics line shows grid size, cell count, land and current counts and wind from the Rust `Chart::stats` via `POST /api/stats`, with **Copy stats** to put that overview on the clipboard; invalid chart lines are listed with line numbers above the editor as you type, using structured issues from Rust `chart::issues` via `POST /api/issues`. **Compare with calm** runs the same query twice — once as written, once against the still-water baseline produced by the Rust `chart::calm` transformation via `POST /api/calm` — and reports the time difference; **Export comparison CSV** writes both scenarios and the saving to `trireme-comparison.csv`, **Export comparison JSON** writes the versioned `trireme.comparison/1` document, and **Copy Markdown** puts a comparison table on the clipboard; see ADR-004. **Import file** reads a `.txt` chart from disk (with header/grid/wind validation); **Download chart** writes the current chart back as text. **Save chart** / **Load saved** keep a chart in this browser's local storage; **Step times** shows what each heading cost, **Copy summary** puts a plain-text route report on the clipboard, **Copy CLI command** copies the exact `cargo run -- route ...` invocation for the current query, **Copy map** puts the ASCII route map with its legend on the clipboard, **Copy Markdown** copies a full Markdown report (metrics, headings, per-step times and fenced map), and the result panel's headings, waypoints and map update on every plan. **Export route (JSON)** downloads the raw answer, while **Export route (CSV)** writes `step,x,y,heading,time_units` rows for the last planned route. **Route history** keeps the last 10 plans — chart text and endpoints included — in this browser's local storage; **Restore** reloads an entry into the editor, **Export JSON** saves the whole history (charts and endpoints) as `trireme.history.json` while **Export CSV** writes the visible plans (chart, endpoints, time, steps, heading, note) to `trireme.history.csv`; **Import JSON** validates that schema and shows a preview — file count, new vs duplicate entries, kept total and timestamp range — before **Apply import** merges it (deduped, newest first, 10-entry cap) into local storage; **Cancel** discards it. The history panel opens with a summary of plan count, total steps, unique charts and fastest/slowest/average time, with a **Copy summary** button for that overview. **Filter history** narrows the list by endpoint, time, note or chart text, with a live shown/total count; **Sort history** orders the visible entries newest, oldest, fastest or slowest first. **Undo last** removes only the newest entry and **Clear** empties the history. Nothing is sent anywhere. **Help / shortcuts** opens an in-browser panel listing CLI commands, chart syntax and every UI control and shortcut; Escape closes it. The same panel has **Copy all data (JSON)**, which puts a versioned `trireme.bundle/1` document (current chart, presets and history) on the clipboard; **Import bundle** validates such a document and shows a preview of incoming and kept presets/plans before **Apply import** loads its chart and merges its presets and history into this browser; **Cancel** discards it. There is also a **Reset local data** action (click twice to confirm) that clears the saved chart, presets and history from this browser. The page calls `/api/route`, which shares its route document with `route --json`.
- **Client logic proof** (Node 18+): `node --test web/app.test.js`

### 🛠️ Commands

| Command | What it does |
|---|---|
| `trireme chart <chart> [--json] [--calm\|--stats\|--issues]` | Describe the chart; `--calm` prints a still-water copy, `--stats` prints counts, `--issues` prints line-numbered validation problems. |
| `trireme route <chart> --from X,Y --to X,Y [--ascii] [--json]` | Print the headings, waypoints, total time, per-step times and cells explored; `--json` emits the shared route document including `step_times` (ADR-005). |
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
