# Decisions

Why this project is built the way it is, oldest first. One entry per decision that changes a
contract, a dependency, a data format or the architecture; IDs are consecutive and never reused.

<!-- Entry format:
### ADR-NNN: <decision in one line>
- **Date**: YYYY-MM-DD
- **Status**: Accepted
- **Context**: <what forced the decision>
- **Decision**: <what was decided>
- **Consequences**: <what follows, including what it costs>
-->

### ADR-001: Manifest format v1, in-tree SHA-256, zero dependencies
- **Date**: 2026-11-19
- **Status**: Accepted
- **Context**: A manifest must be reproducible on any machine with only `rustc` and `cargo`, with no network fetch, and readable/diffable as plain text. Paths with tabs or newlines would make a line-oriented format ambiguous.
- **Decision**: Use one `trireme-manifest-v1` header, then `<sha256>\t<size>\t<relative-path>` lines sorted by path with `/` separators. Hash files with an in-tree streaming SHA-256 and no crates; skip symlinks; refuse paths containing tab/newline; classify verification as added/missing/changed with exit codes 0/1/2.
- **Consequences**: Manifests are stable across platforms and reviewable in git, and the crate builds offline. The cost is owning a small SHA-256 implementation and its test vectors; any format change needs a new header version.

### ADR-002: Trireme is a sailing route planner; ADR-001 is superseded
- **Date**: 2026-11-19
- **Status**: Accepted
- **Context**: A review of the portfolio found several tools that already hash files and verify manifests (Dupefinder, Assay, Research-Engine, PNN, Crucible, the media dossier). A fifth hash-and-verify CLI would not be distinct by type. The Aegean theme and the zero-dependency constraint still hold.
- **Decision**: Replace the manifest/hash core with a shortest-time sailing router. A chart declares a grid, wind, land and local currents; `route` answers a from/to query with Dijkstra over eight headings. Costs are integers (`distance * 100 / speed`) and the queue is ordered by `(cost, x, y)`, so ties resolve deterministically. Exit codes are 0 route found, 1 unreachable, 2 bad input. ADR-001 remains in the register as history, not as current design.
- **Consequences**: The core job is search, not verification, so the project no longer overlaps the portfolio's manifest tools. The SHA-256 and manifest modules are removed and version moves to 0.2.0. The cost is a new chart format and a cost model that is a deliberate approximation, not real marine navigation.

### ADR-003: Browser UI uses a std-only HTTP core and one shared JSON contract
- **Date**: 2026-11-19
- **Status**: Accepted
- **Context**: A point-and-click surface was needed without crates or a build step, and CLI and browser had to agree on one route document.
- **Decision**: Serve web/ from src/web.rs, put JSON parsing in src/json.rs, share web::route_json with route --json, and add chart --json.
- **Consequences**: One route shape serves API and CLI and embedded-looking keys are rejected; the cost is a hand-written HTTP/JSON layer with explicit tests.

### ADR-004: Calm-water comparison zeroes wind and current vectors
- **Date**: 2026-11-19
- **Status**: Accepted
- **Context**: A comparison view needs an unambiguous baseline for the same grid and endpoints.
- **Decision**: Derive the calm chart in the client by replacing wind with 0 0 and every local current with 0 0, keeping land and grid unchanged.
- **Consequences**: The comparison isolates weather from geography and needs no server change; the cost is one more client helper with its own tests.

### ADR-005: Route documents carry a per-step time breakdown
- **Date**: 2026-11-19
- **Status**: Accepted
- **Context**: The route total hid which headings were expensive, and CSV export only had headings.
- **Decision**: Add step_times to the shared route JSON, populate it from Dijkstra's chosen moves, and render it in the browser panel and the CSV time_units column.
- **Consequences**: Consumers can see where time is spent and the times sum to the total; the cost is one more array to keep aligned with steps and covered by tests.

### ADR-006: Browser comparison uses the Rust calm baseline
- **Date**: 2026-11-19
- **Status**: Accepted
- **Context**: The browser previously zeroed wind and currents with its own JavaScript copy of the transformation, which could drift from the CLI chart --calm implementation.
- **Decision**: Expose chart::calm through POST /api/calm and have the comparison fetch that baseline instead of deriving it in JavaScript; ADR-004's client-side derivation is superseded.
- **Consequences**: One Rust implementation defines calm water for CLI and UI; the browser makes one extra local request per comparison, and API shape is covered by Rust and node tests.

### ADR-007: Chart validation is reported by Rust as structured issues
- **Date**: 2026-11-19
- **Status**: Accepted
- **Context**: The browser used its own line-numbered validation copy, which could drift from the Rust chart parser used by the CLI.
- **Decision**: Add chart::issues and POST /api/issues, returning every line-numbered problem as JSON, and drive the browser validation panel from that response.
- **Consequences**: One validator defines chart problems for CLI and UI; the browser sends one local request per edit with a sequence guard, and both sides are covered by tests.
