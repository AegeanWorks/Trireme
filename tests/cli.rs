//! End-to-end proofs through the real binary: stdout, stderr and exit codes.

use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "trireme-cli-{stamp}-{}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn write(&self, relative: &str, body: &[u8]) -> PathBuf {
        let target = self.0.join(relative);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, body).unwrap();
        target
    }

    fn tree(&self) -> PathBuf {
        self.0.join("tree")
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_trireme"))
        .args(args)
        .output()
        .expect("the trireme binary must be runnable")
}

fn ok_text(output: &Output) -> String {
    assert!(
        output.status.success(),
        "command failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout.clone()).unwrap()
}

#[test]
fn hash_prints_the_known_sha256() {
    let scratch = Scratch::new();
    let file = scratch.write("abc.txt", b"abc");
    let out = ok_text(&run(&["hash", file.to_str().unwrap()]));
    assert_eq!(
        out.trim(),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn manifest_and_verify_a_clean_tree() {
    let scratch = Scratch::new();
    let tree = scratch.tree();
    fs::create_dir_all(tree.join("nested")).unwrap();
    fs::write(tree.join("nested/b.txt"), b"beta").unwrap();
    fs::write(tree.join("a.txt"), b"alpha").unwrap();
    let manifest = scratch.0.join("snapshot.txt");
    let tree_s = tree.to_str().unwrap();
    let manifest_s = manifest.to_str().unwrap();

    assert!(run(&["manifest", tree_s, "-o", manifest_s]).status.success());
    let listed = ok_text(&run(&["manifest", tree_s]));
    let paths: Vec<&str> = listed.lines().filter_map(|line| line.split('\t').nth(2)).collect();
    assert_eq!(paths, vec!["a.txt", "nested/b.txt"]);

    let verified = ok_text(&run(&["verify", tree_s, manifest_s]));
    assert!(verified.contains("matched=2"));
    assert!(verified.contains("OK: tree matches the manifest"));
}

#[test]
fn verify_exits_one_and_names_each_difference() {
    let scratch = Scratch::new();
    let tree = scratch.tree();
    fs::create_dir_all(&tree).unwrap();
    fs::write(tree.join("same.txt"), b"stable").unwrap();
    fs::write(tree.join("edit.txt"), b"before").unwrap();
    fs::write(tree.join("gone.txt"), b"bye").unwrap();
    let manifest = scratch.0.join("snapshot.txt");
    let tree_s = tree.to_str().unwrap();
    let manifest_s = manifest.to_str().unwrap();
    assert!(run(&["manifest", tree_s, "-o", manifest_s]).status.success());

    fs::remove_file(tree.join("gone.txt")).unwrap();
    fs::write(tree.join("edit.txt"), b"after").unwrap();
    fs::write(tree.join("new.txt"), b"added").unwrap();

    let output = run(&["verify", tree_s, manifest_s]);
    assert_eq!(output.status.code(), Some(1));
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("matched=1"));
    assert!(text.contains("MISSING  gone.txt"));
    assert!(text.contains("CHANGED  edit.txt"));
    assert!(text.contains("ADDED    new.txt"));
}

#[test]
fn excludes_are_honoured_by_both_commands() {
    let scratch = Scratch::new();
    let tree = scratch.tree();
    fs::create_dir_all(tree.join("ignored")).unwrap();
    fs::write(tree.join("ignored/big.bin"), b"x").unwrap();
    fs::write(tree.join("keep.txt"), b"y").unwrap();
    let manifest = scratch.0.join("snapshot.txt");
    let tree_s = tree.to_str().unwrap();
    let manifest_s = manifest.to_str().unwrap();
    let args = ["-e", "ignored"];

    let mut make = vec!["manifest", tree_s];
    make.extend_from_slice(&args);
    make.extend_from_slice(&["-o", manifest_s]);
    assert!(run(&make).status.success());
    let listed = ok_text(&run(&["manifest", tree_s, "-e", "ignored"]));
    assert_eq!(listed.lines().count(), 2);

    let mut check = vec!["verify", tree_s, manifest_s];
    check.extend_from_slice(&args);
    assert!(ok_text(&run(&check)).contains("OK: tree matches the manifest"));
}

#[test]
fn bad_usage_and_missing_files_exit_two_with_a_fix() {
    let unknown = run(&["fly"]);
    assert_eq!(unknown.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&unknown.stderr).contains("Fix:"));

    let missing = run(&["hash", "definitely-not-a-file"]);
    assert_eq!(missing.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&missing.stderr).contains("Why:"));

    let bad_manifest = run(&["verify", ".", "definitely-not-a-manifest"]);
    assert_eq!(bad_manifest.status.code(), Some(2));
}

#[test]
fn help_and_version_are_cheap_and_explicit() {
    let help = ok_text(&run(&["--help"]));
    assert!(help.contains("trireme hash <file>"));
    let version = ok_text(&run(&["--version"]));
    assert!(version.starts_with("trireme "));
}
