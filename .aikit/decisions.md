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
