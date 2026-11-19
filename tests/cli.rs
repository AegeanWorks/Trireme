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
fn compare_uses_the_calm_baseline_for_same_endpoints() {
    let scratch = Scratch::new();
    let chart = scratch.chart("grid 5 1\nwind 1 0\n");
    let out = ok_text(&run(&["compare", &chart, "--from", "0,0", "--to", "4,0"]));
    assert!(out.contains("TRIREME COMPARISON"));
    assert!(out.contains("wind  332 units"));
    assert!(out.contains("calm  400 units"));
    assert!(out.contains("Saving: 68 units (17% faster)."));
    let json = ok_text(&run(&["compare", &chart, "--from", "0,0", "--to", "4,0", "--json"]));
    assert!(json.contains("\"ok\":true"));
    assert!(json.contains("\"saved\":68"));
    assert!(json.contains("\"wind\":{"));
    assert!(json.contains("\"calm\":{"));
    let blocked = scratch.chart("grid 3 3\nwind 0 0\nland 1 0\nland 1 1\nland 1 2\n");
    let failed = run(&["compare", &blocked, "--from", "0,1", "--to", "2,1"]);
    assert_eq!(failed.status.code(), Some(1));
}

#[test]
fn import_inspection_validates_and_canonicalizes_documents() {
    let scratch = Scratch::new();
    let source = scratch.0.join("inspection.json");
    let body = r#"{"schema":"trireme.inspection/1","generatedBy":"x","inspection":{"valid":true,"fingerprint":"abc","stats":{"width":2,"height":2,"cells":4,"land":0,"currents":0,"wind":[0,0]},"issues":[]}}"#;
    std::fs::write(&source, body).unwrap();
    let source_s = source.to_str().unwrap();
    let printed = ok_text(&run(&["import-inspection", source_s]));
    assert!(printed.contains("\"schema\":\"trireme.inspection/1\""));
    let out = scratch.0.join("canonical.json");
    let out_s = out.to_str().unwrap();
    ok_text(&run(&["import-inspection", source_s, "--out", out_s]));
    let saved = std::fs::read_to_string(&out).unwrap();
    assert_eq!(saved.trim_end(), printed.trim_end());
    let bad = scratch.0.join("bad.json");
    std::fs::write(&bad, "{\"schema\":\"other\"}").unwrap();
    let failed = run(&["import-inspection", bad.to_str().unwrap()]);
    assert_eq!(failed.status.code(), Some(2));
    let missing = run(&["import-inspection"]);
    assert_eq!(missing.status.code(), Some(2));
}

#[test]
fn init_creates_a_valid_starter_chart() {
    let scratch = Scratch::new();
    let path = scratch.0.join("starter.txt");
    let path_s = path.to_str().unwrap();
    let out = ok_text(&run(&["init", path_s, "--width", "6", "--height", "3", "--wind", "1,0"]));
    assert!(out.contains("Created"));
    let body = std::fs::read_to_string(&path).unwrap();
    assert!(body.starts_with("TRIREME-CHART v1\ngrid 6 3\nwind 1 0\n"));
    let issues = ok_text(&run(&["chart", path_s, "--issues"]));
    assert!(issues.contains("OK: no chart issues found."));
    let again = run(&["init", path_s, "--width", "2", "--height", "2"]);
    assert_eq!(again.status.code(), Some(2));
    assert!(ok_text(&run(&["init", path_s, "--width", "2", "--height", "2", "--force"])).contains("Created"));
    assert_eq!(run(&["init", path_s, "--width", "0", "--height", "2", "--force"]).status.code(), Some(2));
}

#[test]
fn inspect_reports_stats_fingerprint_and_issues() {
    let scratch = Scratch::new();
    let chart = scratch.chart("grid 4 3\nwind 1 0\nland 2 2\n");
    let text = ok_text(&run(&["inspect", &chart]));
    assert!(text.contains("TRIREME INSPECTION"));
    assert!(text.contains("4x3 grid \u{b7} 12 cells"));
    assert!(text.contains("fingerprint "));
    assert!(text.contains("valid: yes"));
    let json = ok_text(&run(&["inspect", &chart, "--json"]));
    assert!(json.contains("\"valid\":true"));
    assert!(json.contains("\"cells\":12"));
    assert!(json.contains("\"fingerprint\":\""));
    let bad = scratch.chart("wind 2 0\n");
    let bad_text = ok_text(&run(&["inspect", &bad]));
    assert!(bad_text.contains("INVALID CHART"));
    assert!(bad_text.contains("wind <dx>"));
    let bad_json = ok_text(&run(&["inspect", &bad, "--json"]));
    assert!(bad_json.contains("\"valid\":false"));
    let missing = run(&["inspect"]);
    assert_eq!(missing.status.code(), Some(2));
}

#[test]
fn diff_summary_reports_only_counts() {
    let scratch = Scratch::new();
    let left = scratch.chart("grid 3 1\nwind 0 0\n");
    let right = scratch.chart("grid 3 1\nwind 1 0\nland 2 0\n");
    let text = ok_text(&run(&["diff", &left, &right, "--summary"]));
    assert!(text.contains("CHART DIFF SUMMARY"));
    assert!(text.contains("changed=1 added=1 removed=0 total=2"));
    assert!(!text.contains("wind 0 0"));
    let json = ok_text(&run(&["diff", &left, &right, "--summary", "--json"]));
    assert!(json.contains("\"total\":2"));
    assert!(json.contains("\"added\":1"));
    let same = ok_text(&run(&["diff", &left, &left, "--summary"]));
    assert_eq!(same.trim(), "No differences.");
}

#[test]
fn diff_compares_two_chart_files_in_text_and_json() {
    let scratch = Scratch::new();
    let left = scratch.chart("grid 3 1\nwind 0 0\n");
    let right = scratch.chart("grid 3 1\nwind 1 0\nland 2 0\n");
    let text = ok_text(&run(&["diff", &left, &right]));
    assert!(text.contains("TRIREME CHART DIFF"));
    assert!(text.contains("3 - wind 0 0"));
    assert!(text.contains("3 + wind 1 0"));
    let json = ok_text(&run(&["diff", &left, &right, "--json"]));
    assert!(json.contains("\"ok\":true"));
    assert!(json.contains("\"line\":3"));
    assert!(json.contains("\"kind\":\"changed\""));
    let same = ok_text(&run(&["diff", &left, &left]));
    assert!(same.contains("No differences."));
    let bad = run(&["diff", &left]);
    assert_eq!(bad.status.code(), Some(2));
}

#[test]
fn chart_fingerprint_is_stable_across_comment_and_order_changes() {
    let scratch = Scratch::new();
    let chart = scratch.chart("grid 3 3\nwind 1 0\nland 2 2\n");
    let other = scratch.chart("# note\nland 2 2\nwind 1 0\ngrid 3 3\n");
    let first = ok_text(&run(&["chart", &chart, "--fingerprint"]));
    assert_eq!(first.trim().len(), 16);
    assert_eq!(ok_text(&run(&["chart", &other, "--fingerprint"])).trim(), first.trim());
    let json = ok_text(&run(&["chart", &chart, "--fingerprint", "--json"]));
    assert!(json.contains("\"ok\":true"));
    assert!(json.contains(&format!("\"fingerprint\":\"{}\"", first.trim())));
    let combined = run(&["chart", &chart, "--fingerprint", "--stats"]);
    assert_eq!(combined.status.code(), Some(2));
}

#[test]
fn chart_normalize_produces_a_canonical_chart() {
    let scratch = Scratch::new();
    let chart = scratch.chart("current 1 1 0 1\nwind 1 0\nland 2 2\ngrid 3 3\n");
    let out = ok_text(&run(&["chart", &chart, "--normalize"]));
    assert!(out.starts_with("TRIREME-CHART v1\ngrid 3 3\nwind 1 0\n"));
    assert!(out.contains("land 2 2\ncurrent 1 1 0 1\n"));
    assert_eq!(out, ok_text(&run(&["chart", &chart, "--normalize"])));
    let json = ok_text(&run(&["chart", &chart, "--normalize", "--json"]));
    assert!(json.contains("\"ok\":true"));
    assert!(json.contains("grid 3 3\\nwind 1 0"));
    let combined = run(&["chart", &chart, "--normalize", "--stats"]);
    assert_eq!(combined.status.code(), Some(2));
}

#[test]
fn chart_issues_reports_every_problem_in_text_and_json() {
    let scratch = Scratch::new();
    let chart = scratch.chart("grid 3 1\nwind 2 0\nunknown 7\n");
    let text = ok_text(&run(&["chart", &chart, "--issues"]));
    assert!(text.contains("line 3: expected wind <dx> <dy>"));
    assert!(text.contains("line 4: unknown directive 'unknown'."));
    let json = ok_text(&run(&["chart", &chart, "--issues", "--json"]));
    assert!(json.contains("\"valid\":false"));
    assert!(json.contains("\"line\":3"));
    assert!(json.contains("\"line\":4"));
    let clean = scratch.chart("grid 3 1\nwind 0 0\n");
    assert_eq!(ok_text(&run(&["chart", &clean, "--issues"])).trim(), "OK: no chart issues found.");
    let combined = run(&["chart", &chart, "--issues", "--stats"]);
    assert_eq!(combined.status.code(), Some(2));
}

#[test]
fn chart_stats_reports_counts_in_text_and_json() {
    let scratch = Scratch::new();
    let chart = scratch.chart("grid 4 3\nwind 1 0\nland 2 2\ncurrent 1 1 0 1\n");
    let text = ok_text(&run(&["chart", &chart, "--stats"]));
    assert_eq!(text.trim(), "4x3 grid \u{b7} 12 cells \u{b7} 1 land \u{b7} 1 currents \u{b7} wind (1,0)");
    let json = ok_text(&run(&["chart", &chart, "--stats", "--json"]));
    assert!(json.contains("\"cells\":12"));
    assert!(json.contains("\"land\":1"));
    assert!(json.contains("\"wind\":[1,0]"));
    let both = run(&["chart", &chart, "--stats", "--calm"]);
    assert_eq!(both.status.code(), Some(2));
}

#[test]
fn chart_calm_zeroes_wind_and_currents_for_the_same_geography() {
    let scratch = Scratch::new();
    let chart = scratch.chart("# note\ngrid 4 3\nwind 1 -1\nland 2 2\ncurrent 1 1 0 1\n");
    let calm = ok_text(&run(&["chart", &chart, "--calm"]));
    assert!(calm.contains("# note"));
    assert!(calm.contains("grid 4 3"));
    assert!(calm.contains("land 2 2"));
    assert!(calm.contains("wind 0 0"));
    assert!(calm.contains("current 1 1 0 0"));
    assert!(!calm.contains("wind 1 -1"));
    let json = ok_text(&run(&["chart", &chart, "--calm", "--json"]));
    assert!(json.contains("\"ok\":true"));
    assert!(json.contains("wind 0 0"));
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
    assert!(routed.contains("\"step_times\""));
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
