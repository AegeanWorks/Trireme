# Trireme

[![Built with AIKit](https://img.shields.io/badge/built%20with-AIKit-6f42c1)](https://github.com/AegeanWorks/AIKit)

Trireme is a zero-dependency Rust CLI that builds deterministic, content-addressed directory manifests with SHA-256 and verifies trees against them, offline.

A manifest is a plain text file: one version header, then one `<sha256>\t<size>\t<relative-path>` line per regular file, sorted by path with `/` separators. It is meant to be read by humans and diffed by git. Trireme hashes with its own in-tree SHA-256, so it needs no crates, no network and no runtime.

## ⚡ 30-Second Cold-Start Quick Reference

- **Runtime Prerequisites**: Rust 1.70 or newer (edition 2021); no third-party crates and no network access at build or run time.
- **Canonical Regression Shield Gate**:
  ```bash
  cargo test
  ```
- **Typical use**:
  ```bash
  # Best: write the snapshot outside the tree you are snapshotting.
  cargo run -- manifest ./src -o ../src.manifest
  cargo run -- verify ./src ../src.manifest

  # If you keep the manifest inside the tree, exclude its own name:
  cargo run -- manifest . -o trireme.manifest -e trireme.manifest
  cargo run -- verify . trireme.manifest -e trireme.manifest
  # exit 0 = clean, 1 = added/missing/changed files, 2 = bad input or I/O error
  ```

### 🛠️ Commands

| Command | What it does |
|---|---|
| `trireme hash <file>` | Print the SHA-256 of one file. |
| `trireme manifest <dir> [-o <file>] [-e <name>]...` | Write a deterministic snapshot of a tree (stdout by default). |
| `trireme verify <dir> <manifest> [-e <name>]...` | Report `ADDED`, `MISSING` and `CHANGED` paths and exit accordingly. |
| `trireme help` / `trireme --version` | Show usage or the version. |

`-e NAME` skips any file or directory with that name at any depth; symlinks are always skipped. Paths with tabs or newlines are refused rather than encoded, so a manifest is never ambiguous.

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
├── src/
│   ├── main.rs               <- process entry point and exit code
│   ├── lib.rs                <- public library surface
│   ├── cli.rs                <- argument parsing and human-readable output
│   ├── sha256.rs             <- streaming SHA-256, written in-tree
│   └── manifest.rs           <- collect, serialise, parse and compare trees
├── tests/
│   └── cli.rs                <- end-to-end proofs through the real binary
├── assets/                   <- generated logo and social preview candidates
├── inventory.py              <- AI-compat inventory: kind|name|locator lines (ADR-315)
├── demo.py                   <- AI-compat scripted drive: WORLD-DELTA lines (ADR-315)
├── README.md
├── LICENSE                   <- Aegean License 1.1 (AL-1.1): free personal use
├── COMMERCIAL.md             <- Commercial licensing terms
├── LICENSES/                 <- REUSE license texts
├── REUSE.toml                <- Machine-readable SPDX metadata
├── .gitattributes            <- LF line endings on every platform
├── .gitignore                <- transient AIKit state excluded
└── .aikit/                   <- this project's memory: record, ledger, decisions
```

## 📜 License

Free for personal use under the Aegean License 1.1 (AL-1.1); see [LICENSE](LICENSE). Any commercial use needs the Aegean Commercial License 1.0 (ACL-1.0); see [COMMERCIAL.md](COMMERCIAL.md).
