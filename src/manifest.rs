//! Deterministic directory manifests and verification.
//!
//! A manifest is a small text file: one version header followed by one line per
//! regular file, sorted by relative path. Paths always use `/`, so a manifest
//! written on one platform verifies on another.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::path::{Path, PathBuf};

use crate::sha256::{digest_reader, to_hex};

/// First line of every manifest file.
pub const HEADER: &str = "trireme-manifest-v1";

/// One recorded file.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Entry {
    /// Relative path with `/` separators.
    pub path: String,
    /// File length in bytes.
    pub size: u64,
    /// SHA-256 as 64 lowercase hex characters.
    pub digest: String,
}

/// The outcome of comparing a tree with a manifest.
#[derive(Debug, Eq, PartialEq)]
pub struct Report {
    pub matched: usize,
    pub missing: Vec<String>,
    pub added: Vec<String>,
    pub changed: Vec<String>,
}

impl Report {
    /// True when the tree is byte-for-byte what the manifest describes.
    pub fn is_clean(&self) -> bool {
        self.missing.is_empty() && self.added.is_empty() && self.changed.is_empty()
    }
}

/// Walks `root` and returns one [`Entry`] per regular file, sorted by path.
///
/// Symlinks are skipped to avoid cycles and ambiguous content. Any file or
/// directory whose name appears in `excludes` is skipped at every depth.
pub fn collect(root: &Path, excludes: &[String]) -> Result<Vec<Entry>, String> {
    let mut entries = Vec::new();
    walk(root, "", excludes, &mut entries)?;
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}

fn walk(
    dir: &Path,
    relative: &str,
    excludes: &[String],
    out: &mut Vec<Entry>,
) -> Result<(), String> {
    let listing = fs::read_dir(dir).map_err(|err| {
        format!("cannot read directory '{}': {err}", dir.display())
    })?;

    for item in listing {
        let item = item.map_err(|err| format!("cannot read an entry in '{}': {err}", dir.display()))?;
        let name = item.file_name().to_string_lossy().into_owned();
        if excludes.iter().any(|skip| skip == &name) {
            continue;
        }

        let full: PathBuf = item.path();
        let meta = fs::symlink_metadata(&full)
            .map_err(|err| format!("cannot inspect '{}': {err}", full.display()))?;
        if meta.file_type().is_symlink() {
            continue;
        }

        let path = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };

        if meta.is_dir() {
            walk(&full, &path, excludes, out)?;
        } else if meta.is_file() {
            if path.contains(['\t', '\n', '\r']) {
                return Err(format!("path '{path}' contains a tab or newline and cannot be manifested"));
            }
            let file = File::open(&full)
                .map_err(|err| format!("cannot open '{}': {err}", full.display()))?;
            let raw = digest_reader(file)
                .map_err(|err| format!("cannot hash '{}': {err}", full.display()))?;
            out.push(Entry {
                path,
                size: meta.len(),
                digest: to_hex(&raw),
            });
        }
    }
    Ok(())
}

/// Serializes entries into the stable manifest text format.
pub fn to_text(entries: &[Entry]) -> String {
    let mut text = format!("{HEADER}\n");
    for entry in entries {
        text.push_str(&format!(
            "{}\t{}\t{}\n",
            entry.digest, entry.size, entry.path
        ));
    }
    text
}

/// Parses manifest text, rejecting unknown versions and malformed entries.
pub fn from_text(text: &str) -> Result<Vec<Entry>, String> {
    let mut lines = text.lines();
    match lines.next() {
        Some(line) if line.trim_end() == HEADER => {}
        Some(line) => {
            return Err(format!(
                "unsupported manifest header '{line}'; expected '{HEADER}'"
            ))
        }
        None => return Err("manifest is empty".to_string()),
    }

    let mut entries = Vec::new();
    let mut seen = HashSet::new();
    for (index, line) in lines.enumerate() {
        if line.is_empty() {
            continue;
        }
        let number = index + 2;
        let mut parts = line.splitn(3, '\t');
        let digest = parts.next().unwrap_or("");
        let size = parts.next().unwrap_or("");
        let path = parts.next().unwrap_or("");
        if path.is_empty() || !is_hex_digest(digest) {
            return Err(format!("manifest line {number} is malformed"));
        }
        let size: u64 = size
            .parse()
            .map_err(|_| format!("manifest line {number} has an invalid size"))?;
        if !seen.insert(path) {
            return Err(format!("manifest lists '{path}' more than once"));
        }
        entries.push(Entry {
            path: path.to_string(),
            size,
            digest: digest.to_string(),
        });
    }
    Ok(entries)
}

fn is_hex_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Compares `root` against `expected` and classifies every difference.
pub fn verify(root: &Path, expected: &[Entry], excludes: &[String]) -> Result<Report, String> {
    let actual = collect(root, excludes)?;
    let before: HashMap<&str, &Entry> = expected
        .iter()
        .map(|entry| (entry.path.as_str(), entry))
        .collect();
    let now: HashMap<&str, &Entry> = actual
        .iter()
        .map(|entry| (entry.path.as_str(), entry))
        .collect();

    let mut missing = Vec::new();
    let mut changed = Vec::new();
    for (path, old) in &before {
        match now.get(path) {
            None => missing.push((*path).to_string()),
            Some(new) if new.digest != old.digest || new.size != old.size => {
                changed.push((*path).to_string())
            }
            Some(_) => {}
        }
    }
    let mut added: Vec<String> = now
        .keys()
        .filter(|path| !before.contains_key(**path))
        .map(|path| (*path).to_string())
        .collect();

    missing.sort();
    added.sort();
    changed.sort();
    let matched = before.len() - missing.len() - changed.len();
    Ok(Report {
        matched,
        missing,
        added,
        changed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!("trireme-lib-{stamp}-{}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write(path: &Path, body: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    #[test]
    fn text_round_trips() {
        let entries = vec![
            Entry {
                path: "b.txt".into(),
                size: 3,
                digest: "a".repeat(64),
            },
            Entry {
                path: "a/x.txt".into(),
                size: 1,
                digest: "0".repeat(64),
            },
        ];
        let parsed = from_text(&to_text(&entries)).unwrap();
        assert_eq!(parsed, entries);
    }

    #[test]
    fn rejects_bad_header_and_duplicates() {
        assert!(from_text("nope\n").is_err());
        let dup = format!("{HEADER}\n{}\t1\tx\n{}\t1\tx\n", "a".repeat(64), "a".repeat(64));
        assert!(from_text(&dup).is_err());
    }

    #[test]
    fn verify_detects_every_difference_class() {
        let scratch = Scratch::new();
        let root = scratch.0.join("tree");
        write(&root.join("same.txt"), b"stable");
        write(&root.join("gone.txt"), b"removed later");
        write(&root.join("edit.txt"), b"before");

        let expected = collect(&root, &[]).unwrap();
        fs::remove_file(root.join("gone.txt")).unwrap();
        write(&root.join("edit.txt"), b"after");
        write(&root.join("new.txt"), b"added");

        let report = verify(&root, &expected, &[]).unwrap();
        assert_eq!(report.matched, 1);
        assert_eq!(report.missing, vec!["gone.txt"]);
        assert_eq!(report.changed, vec!["edit.txt"]);
        assert_eq!(report.added, vec!["new.txt"]);
        assert!(!report.is_clean());
    }

    #[test]
    fn excludes_skip_named_entries_and_paths_are_sorted() {
        let scratch = Scratch::new();
        let root = scratch.0.join("tree");
        write(&root.join("z.txt"), b"z");
        write(&root.join("skip/me.bin"), b"skip");
        write(&root.join("a.txt"), b"a");

        let entries = collect(&root, &["skip".to_string()]).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, "a.txt");
        assert_eq!(entries[1].path, "z.txt");
        assert!(verify(&root, &entries, &["skip".to_string()]).unwrap().is_clean());
    }
}
