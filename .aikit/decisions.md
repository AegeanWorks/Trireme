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
