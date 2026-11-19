//! End-to-end proofs through the real binary: stdout and exit codes.

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

    fn chart(&self, body: &str) -> String {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let file = self.0.join(format!("chart-{stamp}.txt"));
        fs::write(&file, format!("TRIREME-CHART v1\n{body}")).unwrap();
        file.to_str().unwrap().to_string()
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
fn chart_command_describes_the_environment() {
    let scratch = Scratch::new();
    let chart = scratch.chart("grid 4 3\nwind 1 0\nland 2 1\ncurrent 1 1 0 1\n");
    let out = ok_text(&run(&["chart", &chart]));
    assert!(out.contains("grid 4x3"));
    assert!(out.contains("wind (1,0)"));
    assert!(out.contains("land 1"));
    assert!(out.contains("currents 1"));
}

#[test]
fn route_finds_a_known_straight_path() {
    let scratch = Scratch::new();
    let chart = scratch.chart("grid 5 1\nwind 0 0\n");
    let out = ok_text(&run(&["route", &chart, "--from", "0,0", "--to", "4,0"]));
    assert!(out.contains("steps E E E E"));
    assert!(out.contains("time 400 units"));
    assert!(out.contains("(0,0) -> (1,0) -> (2,0) -> (3,0) -> (4,0)"));
}

#[test]
fn wind_changes_time_and_ascii_marks_the_route() {
    let scratch = Scratch::new();
    let chart = scratch.chart("grid 3 1\nwind 1 0\n");
    let out = ok_text(&run(&[
        "route", &chart, "--from", "0,0", "--to", "2,0", "--ascii",
    ]));
    assert!(out.contains("time 166 units"));
    let ascii = out.lines().last().unwrap();
    assert_eq!(ascii, "SoG");
}

#[test]
fn json_output_is_machine_readable_for_charts_routes_and_failures() {
    let scratch = Scratch::new();
    let chart = scratch.chart("grid 4 2\nwind 1 0\nland 2 1\n");
    let described = ok_text(&run(&["chart", &chart, "--json"]));
    assert!(described.contains("\"width\":4"));
    assert!(described.contains("\"land\":1"));

    let routed = ok_text(&run(&[
        "route", &chart, "--from", "0,0", "--to", "3,0", "--json",
    ]));
    assert!(routed.contains("\"ok\":true"));
    assert!(routed.contains("\"from\":[0,0]"));
    assert!(routed.contains("\"steps\""));
    assert!(routed.contains("\"ascii\""));

    let blocked = scratch.chart("grid 3 3\nwind 0 0\nland 1 0\nland 1 1\nland 1 2\n");
    let failed = run(&["route", &blocked, "--from", "0,1", "--to", "2,1", "--json"]);
    assert_eq!(failed.status.code(), Some(1));
    let text = String::from_utf8(failed.stdout).unwrap();
    assert!(text.contains("\"ok\":false"));
    assert!(text.contains("NO ROUTE"));
}

#[test]
fn unreachable_goal_exits_one() {
    let scratch = Scratch::new();
    let chart = scratch.chart("grid 3 3\nwind 0 0\nland 1 0\nland 1 1\nland 1 2\n");
    let output = run(&["route", &chart, "--from", "0,1", "--to", "2,1"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stdout).contains("NO ROUTE"));
}

#[test]
fn bad_usage_and_bad_charts_exit_two_with_a_fix() {
    let unknown = run(&["fly"]);
    assert_eq!(unknown.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&unknown.stderr).contains("Fix:"));

    let missing = run(&["chart", "definitely-not-a-chart"]);
    assert_eq!(missing.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&missing.stderr).contains("Why:"));

    let scratch = Scratch::new();
    let broken = scratch.chart("grid 2 2\nwind 0 0\nland 9 9\n");
    let bad = run(&["route", &broken, "--from", "0,0", "--to", "1,1"]);
    assert_eq!(bad.status.code(), Some(2));

    let outside = scratch.chart("grid 2 2\nwind 0 0\n");
    let far = run(&["route", &outside, "--from", "9,9", "--to", "1,1"]);
    assert_eq!(far.status.code(), Some(2));
}

#[test]
fn help_and_version_are_cheap_and_explicit() {
    let help = ok_text(&run(&["--help"]));
    assert!(help.contains("TRIREME-CHART v1"));
    let version = ok_text(&run(&["--version"]));
    assert!(version.starts_with("trireme "));
}
