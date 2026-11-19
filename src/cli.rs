//! Hand-rolled argument parsing for the `trireme` binary: no CLI crate, no
//! global state, and explicit exit codes (0 ok, 1 no route, 2 usage/IO).

use std::fs;
use std::net::TcpListener;
use std::path::PathBuf;

use crate::chart;
use crate::json;
use crate::router::{find_route, render_ascii};
use crate::web;

const HELP: &str = "\
trireme — offline sailing route planner for small sea charts

USAGE:
  trireme route <chart> --from X,Y --to X,Y [--ascii] [--json]
  trireme chart <chart> [--json] [--calm]
  trireme serve [--port N] [--project DIR]
  trireme help | --help | --version

CHART:
  TRIREME-CHART v1
  grid <width> <height>
  wind <dx> <dy>              # direction the wind blows toward, each -1..=1
  land <x> <y>               # repeatable, impassable
  current <x> <y> <dx> <dy>  # repeatable local flow

  Lines may appear in any order; '#' comments and blank lines are ignored.

EXIT CODES:
  0  a route was found (or the chart was described)
  1  the goal is unreachable
  2  bad arguments, unreadable chart or another error
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
        Some("route") => cmd_route(&args[1..]),
        Some("chart") => cmd_chart(&args[1..]),
        Some("serve") => cmd_serve(&args[1..]),
        Some(other) => fail(
            &format!("unknown command '{other}'"),
            "Trireme only plans routes and describes charts.",
            "Run 'trireme --help' to see the chart format.",
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

fn read_chart(path: &str) -> Result<chart::Chart, i32> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) => {
            return Err(fail(
                &format!("cannot read chart '{path}': {err}"),
                "A chart must exist and be valid UTF-8.",
                "Create a text file with a 'TRIREME-CHART v1' header, grid and wind.",
            ))
        }
    };
    chart::parse(&text).map_err(|err| {
        fail(
            &err,
            "Trireme will not guess what a damaged chart meant.",
            "Compare the file with the format in 'trireme --help'.",
        )
    })
}

fn parse_point(value: &str, flag: &str) -> Result<(u32, u32), String> {
    let mut parts = value.split(',');
    let x = parts.next().and_then(|part| part.parse::<u32>().ok());
    let y = parts.next().and_then(|part| part.parse::<u32>().ok());
    match (x, y, parts.next()) {
        (Some(x), Some(y), None) => Ok((x, y)),
        _ => Err(format!("{flag} needs X,Y with non-negative integers, got '{value}'")),
    }
}

fn cmd_route(args: &[&str]) -> i32 {
    let mut chart_path: Option<&str> = None;
    let mut from: Option<&str> = None;
    let mut to: Option<&str> = None;
    let mut ascii = false;
    let mut json_output = false;
    let mut index = 0;
    while index < args.len() {
        match args[index] {
            "--from" | "--to" => {
                let flag = args[index];
                index += 1;
                match args.get(index) {
                    Some(value) if flag == "--from" => from = Some(value),
                    Some(value) => to = Some(value),
                    None => return fail(&format!("{flag} needs X,Y"), "Both endpoints are required.", "Use --from X,Y --to X,Y."),
                }
            }
            "--ascii" => ascii = true,
            "--json" => json_output = true,
            other if other.starts_with('-') => {
                return fail(
                    &format!("unknown option '{other}'"),
                    "route accepts --from, --to, --ascii and --json.",
                    "Use: trireme route <chart> --from X,Y --to X,Y [--ascii] [--json]",
                )
            }
            other if chart_path.is_none() => chart_path = Some(other),
            other => {
                return fail(
                    &format!("unexpected argument '{other}'"),
                    "route takes exactly one chart file.",
                    "Use: trireme route <chart> --from X,Y --to X,Y",
                )
            }
        }
        index += 1;
    }

    let (path, from, to) = match (chart_path, from, to) {
        (Some(path), Some(from), Some(to)) => (path, from, to),
        _ => {
            return fail(
                "route needs a chart, --from and --to",
                "A route is a query: the chart gives the sea, the flags give the endpoints.",
                "Use: trireme route <chart> --from X,Y --to X,Y [--ascii]",
            )
        }
    };
    let (from, to) = match (parse_point(from, "--from"), parse_point(to, "--to")) {
        (Ok(from), Ok(to)) => (from, to),
        (Err(err), _) | (_, Err(err)) => {
            return fail(&err, "Endpoints are grid coordinates.", "Write them as X,Y, for example --from 0,0 --to 4,3.")
        }
    };
    let sea = match read_chart(path) {
        Ok(sea) => sea,
        Err(code) => return code,
    };
    let route = match find_route(&sea, from, to) {
        Ok(Some(route)) => route,
        Ok(None) => {
            let message = format!(
                "NO ROUTE: ({},{}) cannot reach ({},{}) on this chart",
                from.0, from.1, to.0, to.1
            );
            if json_output {
                println!("{}", web::error_json(&message));
            } else {
                println!("{message}");
            }
            return 1;
        }
        Err(err) => {
            return fail(
                &err,
                "Endpoints must be inside the chart.",
                "Check the grid size with 'trireme chart <chart>'.",
            )
        }
    };

    if json_output {
        let map = render_ascii(&sea, from, to, Some(&route));
        println!("{}", web::route_json(from, to, &route, &map));
        return 0;
    }

    println!("TRIREME ROUTE");
    println!("from ({},{}) to ({},{})", from.0, from.1, to.0, to.1);
    if route.steps.is_empty() {
        println!("steps (already there)");
    } else {
        println!("steps {}", route.steps.join(" "));
    }
    let path: Vec<String> = route.waypoints.iter().map(|(x, y)| format!("({x},{y})")).collect();
    println!("waypoints {}", path.join(" -> "));
    println!("time {} units", route.time);
    println!("explored {} cells", route.explored);
    if ascii {
        println!("{}", render_ascii(&sea, from, to, Some(&route)));
    }
    0
}

fn cmd_chart(args: &[&str]) -> i32 {
    let json_output = args.iter().any(|arg| *arg == "--json");
    let calm_output = args.iter().any(|arg| *arg == "--calm");
    let paths: Vec<&str> = args
        .iter()
        .copied()
        .filter(|arg| *arg != "--json" && *arg != "--calm")
        .collect();
    if paths.len() != 1 || paths[0].starts_with('-') {
        return fail(
            "chart needs exactly one chart file",
            "Describing a chart requires a single source.",
            "Use: trireme chart <chart> [--json] [--calm]",
        );
    }
    if calm_output {
        let raw = match fs::read_to_string(paths[0]) {
            Ok(raw) => raw,
            Err(err) => {
                return fail(
                    &format!("cannot read chart '{}': {err}", paths[0]),
                    "A calm copy needs the original chart text.",
                    "Check the path and permissions, then retry.",
                )
            }
        };
        let still = match chart::calm(&raw) {
            Ok(still) => still,
            Err(err) => return fail(&err, "The chart must be valid before it can be calmed.", "Fix the named chart problem and retry."),
        };
        if json_output {
            println!("{{\"ok\":true,\"chart\":{}}}", json::quote(&still));
        } else {
            print!("{still}");
        }
        return 0;
    }
    let sea = match read_chart(paths[0]) {
        Ok(sea) => sea,
        Err(code) => return code,
    };
    if json_output {
        println!(
            "{{\"ok\":true,\"width\":{},\"height\":{},\"wind\":[{},{}],\"land\":{},\"currents\":{}}}",
            sea.width,
            sea.height,
            sea.wind.dx,
            sea.wind.dy,
            sea.land.len(),
            sea.currents.len()
        );
        return 0;
    }
    println!("TRIREME CHART");
    println!("grid {}x{}", sea.width, sea.height);
    println!("wind ({},{})", sea.wind.dx, sea.wind.dy);
    println!("land {}", sea.land.len());
    println!("currents {}", sea.currents.len());
    0
}

fn cmd_serve(args: &[&str]) -> i32 {
    let mut port = 7878u16;
    let mut project_dir: Option<&str> = None;
    let mut index = 0;
    while index < args.len() {
        match args[index] {
            "--port" => {
                index += 1;
                match args.get(index).and_then(|value| value.parse::<u16>().ok()) {
                    Some(value) if value > 0 => port = value,
                    _ => return fail("--port needs a number from 1 to 65535", "The server binds one TCP port.", "Use: trireme serve --port 7878"),
                }
            }
            "--project" => {
                index += 1;
                match args.get(index) {
                    Some(value) => project_dir = Some(value),
                    None => return fail("--project needs a directory", "Static files are read from DIR/web.", "Use: trireme serve --project ."),
                }
            }
            other => {
                return fail(
                    &format!("unknown option '{other}'"),
                    "serve accepts only --port and --project.",
                    "Use: trireme serve [--port N] [--project DIR]",
                )
            }
        }
        index += 1;
    }

    let root = match project_dir {
        Some(dir) => PathBuf::from(dir),
        None => std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
    };
    let listener = match TcpListener::bind(("127.0.0.1", port)) {
        Ok(listener) => listener,
        Err(err) => {
            return fail(
                &format!("cannot bind 127.0.0.1:{port}: {err}"),
                "The browser UI needs a free loopback port.",
                "Pick another port with --port, or stop the process holding this one.",
            )
        }
    };
    println!("Trireme UI: http://127.0.0.1:{port}/ (Ctrl+C to stop)");
    web::serve(listener, &root);
    0
}
