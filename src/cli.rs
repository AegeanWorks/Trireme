//! Hand-rolled argument parsing for the `trireme` binary: no CLI crate, no
//! global state, and explicit exit codes (0 ok, 1 verification mismatch, 2 usage/IO).

use std::fs;
use std::path::{Path, PathBuf};

use crate::manifest;
use crate::sha256::{digest_reader, to_hex};

const HELP: &str = "\
trireme — deterministic, content-addressed directory manifests (offline)

USAGE:
  trireme hash <file>
  trireme manifest <dir> [-o <file>] [-e <name>]...
  trireme verify <dir> <manifest> [-e <name>]...
  trireme help | --help | --version

COMMANDS:
  hash      Print the SHA-256 of one file.
  manifest  List every regular file as <digest>\\t<size>\\t<relative path>.
  verify    Compare a directory with a manifest; exit 1 on any difference.
  -e NAME   Skip files or directories with this name (repeatable).
  -o FILE   Write the manifest to FILE instead of stdout.

EXIT CODES:
  0  success (or a clean verification)
  1  verification found added, missing or changed files
  2  bad arguments, unreadable input or another error
";

/// Runs the CLI with the process arguments and returns the exit code.
pub fn run(args: &[String]) -> i32 {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args.first().copied() {
        Some("help") | Some("-h") | Some("--help") => {
            print!("{HELP}");
            0
        }
        Some("-V") | Some("--version") => {
            println!("trireme {}", env!("CARGO_PKG_VERSION"));
            0
        }
        Some("hash") => cmd_hash(&args[1..]),
        Some("manifest") => cmd_manifest(&args[1..]),
        Some("verify") => cmd_verify(&args[1..]),
        Some(other) => fail(
            &format!("unknown command '{other}'"),
            "Trireme only understands hash, manifest and verify.",
            "Run 'trireme --help' to see the exact syntax.",
        ),
        None => {
            print!("{HELP}");
            2
        }
    }
}

fn fail(message: &str, why: &str, fix: &str) -> i32 {
    eprintln!("error: {message}");
    eprintln!("Why: {why}");
    eprintln!("Fix: {fix}");
    2
}

fn cmd_hash(args: &[&str]) -> i32 {
    if args.len() != 1 || args[0].starts_with('-') {
        return fail(
            "hash needs exactly one file path",
            "A digest is defined for one stream of bytes.",
            "Use: trireme hash <file>",
        );
    }
    let path = Path::new(args[0]);
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(err) => {
            return fail(
                &format!("cannot open '{}': {err}", path.display()),
                "Hashing requires read access to the file.",
                "Check the path and permissions, then retry.",
            )
        }
    };
    match digest_reader(file) {
        Ok(raw) => {
            println!("{}", to_hex(&raw));
            0
        }
        Err(err) => fail(
            &format!("cannot hash '{}': {err}", path.display()),
            "The file could not be read to its end.",
            "Check for I/O errors and retry.",
        ),
    }
}

/// Splits positional paths from `-e` excludes and an optional `-o` output.
fn parse_options<'a>(
    args: &'a [&'a str],
    allow_output: bool,
) -> Result<(Vec<&'a str>, Vec<String>, Option<PathBuf>), String> {
    let mut positional = Vec::new();
    let mut excludes = Vec::new();
    let mut output = None;
    let mut index = 0;
    while index < args.len() {
        match args[index] {
            "-e" | "--exclude" => {
                index += 1;
                match args.get(index) {
                    Some(name) if !name.is_empty() => excludes.push((*name).to_string()),
                    _ => return Err("-e needs a name".to_string()),
                }
            }
            "-o" | "--output" if allow_output => {
                index += 1;
                match args.get(index) {
                    Some(path) if !path.is_empty() => output = Some(PathBuf::from(path)),
                    _ => return Err("-o needs a file path".to_string()),
                }
            }
            other if other.starts_with('-') => return Err(format!("unknown option '{other}'")),
            other => positional.push(other),
        }
        index += 1;
    }
    Ok((positional, excludes, output))
}

fn cmd_manifest(args: &[&str]) -> i32 {
    let (positional, excludes, output) = match parse_options(args, true) {
        Ok(parsed) => parsed,
        Err(err) => {
            return fail(
                &err,
                "manifest accepts one directory, optional -e NAME and optional -o FILE.",
                "Use: trireme manifest <dir> [-o <file>] [-e <name>]...",
            )
        }
    };
    if positional.len() != 1 {
        return fail(
            "manifest needs exactly one directory",
            "A manifest describes one tree.",
            "Use: trireme manifest <dir>",
        );
    }
    let root = Path::new(positional[0]);
    let entries = match manifest::collect(root, &excludes) {
        Ok(entries) => entries,
        Err(err) => {
            return fail(
                &err,
                "Every file in the tree must be readable to produce a faithful manifest.",
                "Fix the named path or add '-e <name>' to skip it.",
            )
        }
    };
    let text = manifest::to_text(&entries);
    match output {
        Some(path) => match fs::write(&path, text) {
            Ok(()) => {
                eprintln!("wrote {} entries to {}", entries.len(), path.display());
                0
            }
            Err(err) => fail(
                &format!("cannot write '{}': {err}", path.display()),
                "The manifest output path is not writable.",
                "Choose a writable path or omit -o to print to stdout.",
            ),
        },
        None => {
            print!("{text}");
            0
        }
    }
}

fn cmd_verify(args: &[&str]) -> i32 {
    let (positional, excludes, _) = match parse_options(args, false) {
        Ok(parsed) => parsed,
        Err(err) => {
            return fail(
                &err,
                "verify accepts a directory, a manifest file and optional -e NAME.",
                "Use: trireme verify <dir> <manifest> [-e <name>]...",
            )
        }
    };
    if positional.len() != 2 {
        return fail(
            "verify needs a directory and a manifest",
            "Verification compares a tree against a recorded snapshot.",
            "Use: trireme verify <dir> <manifest>",
        );
    }
    let root = Path::new(positional[0]);
    let manifest_path = Path::new(positional[1]);
    let text = match fs::read_to_string(manifest_path) {
        Ok(text) => text,
        Err(err) => {
            return fail(
                &format!("cannot read '{}': {err}", manifest_path.display()),
                "A manifest must exist and be valid UTF-8.",
                "Create one with 'trireme manifest <dir> -o <file>'.",
            )
        }
    };
    let expected = match manifest::from_text(&text) {
        Ok(entries) => entries,
        Err(err) => {
            return fail(
                &err,
                "Trireme will not guess what a damaged manifest meant.",
                "Regenerate it with 'trireme manifest <dir> -o <file>'.",
            )
        }
    };
    let report = match manifest::verify(root, &expected, &excludes) {
        Ok(report) => report,
        Err(err) => {
            return fail(
                &err,
                "Verification needs to hash every file in the tree.",
                "Fix the named path or add '-e <name>' to skip it.",
            )
        }
    };

    println!("matched={}", report.matched);
    println!("added={}", report.added.len());
    println!("missing={}", report.missing.len());
    println!("changed={}", report.changed.len());
    for path in &report.added {
        println!("ADDED    {path}");
    }
    for path in &report.missing {
        println!("MISSING  {path}");
    }
    for path in &report.changed {
        println!("CHANGED  {path}");
    }
    if report.is_clean() {
        println!("OK: tree matches the manifest");
        0
    } else {
        println!("FAIL: tree differs from the manifest");
        1
    }
}
