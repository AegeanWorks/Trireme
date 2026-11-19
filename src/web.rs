//! A tiny, dependency-free HTTP server for the browser UI.
//!
//! It serves three static files from `web/` and one JSON endpoint that calls
//! the same chart parser and router as the CLI. No framework, no crates.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::time::Duration;

use crate::chart;
use crate::json;
use crate::router::{find_route, render_ascii, Route};

/// One parsed HTTP request; only the method, path and body are needed here.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub body: String,
}

/// Splits the request line from the body, accepting both CRLF and LF framing.
pub fn parse_request(raw: &str) -> Result<Request, String> {
    let (head, body) = match raw.split_once("\r\n\r\n") {
        Some(parts) => parts,
        None => raw.split_once("\n\n").unwrap_or((raw, "")),
    };
    let mut lines = head.lines();
    let first = lines.next().ok_or_else(|| "request has no first line".to_string())?;
    let mut words = first.split_whitespace();
    let method = words.next().ok_or_else(|| "request has no method".to_string())?;
    let path = words
        .next()
        .ok_or_else(|| "request has no path".to_string())?
        .split('?')
        .next()
        .unwrap_or("/");
    Ok(Request {
        method: method.to_string(),
        path: path.to_string(),
        body: body.to_string(),
    })
}

/// Builds a complete HTTP/1.1 response with a correct byte length.
pub fn response(status: u16, content_type: &str, body: &str) -> String {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Internal Server Error",
    };
    let length = body.as_bytes().len();
    format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {length}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}"
    )
}

/// Routes one request to a static file or the route API.
pub fn handle(raw: &str, project_root: &Path) -> String {
    let request = match parse_request(raw) {
        Ok(request) => request,
        Err(err) => return response(400, "text/plain; charset=utf-8", &error_text(&err)),
    };
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/" | "/index.html") => serve_file(project_root, "index.html", "text/html; charset=utf-8"),
        ("GET", "/app.js") => serve_file(project_root, "app.js", "text/javascript; charset=utf-8"),
        ("GET", "/styles.css") => serve_file(project_root, "styles.css", "text/css; charset=utf-8"),
        ("POST", "/api/route") => api_route(&request.body),
        ("POST", "/api/calm") => api_calm(&request.body),
        ("POST", "/api/stats") => api_stats(&request.body),
        ("POST", "/api/issues") => api_issues(&request.body),
        ("POST", "/api/normalize") => api_normalize(&request.body),
        ("POST", "/api/compare") => api_compare(&request.body),
        ("POST", "/api/fingerprint") => api_fingerprint(&request.body),
        ("POST", "/api/chart-diff") => api_chart_diff(&request.body),
        ("POST", "/api/diff-summary") => api_diff_summary(&request.body),
        ("POST", "/api/inspect") => api_inspect(&request.body),
        ("GET", _) => response(404, "text/plain; charset=utf-8", "not found"),
        _ => response(405, "text/plain; charset=utf-8", "method not allowed"),
    }
}

fn error_text(err: &str) -> String {
    format!("error: {err}\nWhy: the request was not well formed.\nFix: retry with a valid HTTP request.")
}

/// Only three fixed names are reachable, so path traversal is impossible.
fn serve_file(project_root: &Path, name: &str, content_type: &str) -> String {
    let path = project_root.join("web").join(name);
    match std::fs::read_to_string(&path) {
        Ok(body) => response(200, content_type, &body),
        Err(err) => response(
            500,
            "text/plain; charset=utf-8",
            &format!("cannot read web/{name}: {err}"),
        ),
    }
}

/// Returns the canonical form of a chart from the Rust core.
pub fn api_normalize(body: &str) -> String {
    let parsed = match json::fields(body) {
        Ok(parsed) => parsed,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let raw = match parsed
        .get("chart")
        .ok_or_else(|| "missing field 'chart'".to_string())
        .and_then(|value| json::string_value(value))
    {
        Ok(text) => text,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    match chart::normalize(&raw) {
        Ok(canonical) => response(
            200,
            "application/json",
            &format!("{{\"ok\":true,\"chart\":{}}}", json::quote(&canonical)),
        ),
        Err(err) => response(400, "application/json", &error_json(&err)),
    }
}

/// Returns line-numbered chart problems as structured JSON.
pub fn api_issues(body: &str) -> String {
    let parsed = match json::fields(body) {
        Ok(parsed) => parsed,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let raw = match parsed
        .get("chart")
        .ok_or_else(|| "missing field 'chart'".to_string())
        .and_then(|value| json::string_value(value))
    {
        Ok(text) => text,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let found = chart::issues(&raw);
    let items: Vec<String> = found
        .iter()
        .map(|issue| {
            format!(
                "{{\"line\":{},\"message\":{}}}",
                issue.line,
                json::quote(&issue.message)
            )
        })
        .collect();
    response(
        200,
        "application/json",
        &format!("{{\"ok\":true,\"issues\":[{}]}}", items.join(",")),
    )
}

/// Returns counts derived from a chart by the Rust core.
pub fn api_stats(body: &str) -> String {
    let parsed = match json::fields(body) {
        Ok(parsed) => parsed,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let raw = match parsed
        .get("chart")
        .ok_or_else(|| "missing field 'chart'".to_string())
        .and_then(|value| json::string_value(value))
    {
        Ok(text) => text,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    match chart::parse(&raw) {
        Ok(sea) => {
            let stats = sea.stats();
            response(
                200,
                "application/json",
                &format!(
                    "{{\"ok\":true,\"width\":{},\"height\":{},\"cells\":{},\"land\":{},\"currents\":{},\"wind\":[{},{}]}}",
                    stats.width,
                    stats.height,
                    stats.cells,
                    stats.land,
                    stats.currents,
                    stats.wind.dx,
                    stats.wind.dy
                ),
            )
        }
        Err(err) => response(400, "application/json", &error_json(&err)),
    }
}

/// Returns the Rust-derived calm-water copy of a chart.
pub fn api_calm(body: &str) -> String {
    let parsed = match json::fields(body) {
        Ok(parsed) => parsed,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let raw = match parsed
        .get("chart")
        .ok_or_else(|| "missing field 'chart'".to_string())
        .and_then(|value| json::string_value(value))
    {
        Ok(text) => text,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    match chart::calm(&raw) {
        Ok(still) => response(
            200,
            "application/json",
            &format!("{{\"ok\":true,\"chart\":{}}}", json::quote(&still)),
        ),
        Err(err) => response(400, "application/json", &error_json(&err)),
    }
}

/// Returns stats, fingerprint and validation issues in one document.
pub fn api_inspect(body: &str) -> String {
    let parsed = match json::fields(body) {
        Ok(parsed) => parsed,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let raw = match parsed
        .get("chart")
        .ok_or_else(|| "missing field 'chart'".to_string())
        .and_then(|value| json::string_value(value))
    {
        Ok(text) => text,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let found = chart::issues(&raw);
    if !found.is_empty() {
        let items: Vec<String> = found
            .iter()
            .map(|issue| {
                format!(
                    "{{\"line\":{},\"message\":{}}}",
                    issue.line,
                    json::quote(&issue.message)
                )
            })
            .collect();
        return response(
            200,
            "application/json",
            &format!("{{\"ok\":true,\"valid\":false,\"issues\":[{}]}}", items.join(",")),
        );
    }
    let stats = chart::parse(&raw).map(|sea| sea.stats());
    let stats = match stats {
        Ok(stats) => stats,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let value = match chart::fingerprint(&raw) {
        Ok(value) => value,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    response(
        200,
        "application/json",
        &format!(
            "{{\"ok\":true,\"valid\":true,\"fingerprint\":{},\"width\":{},\"height\":{},\"cells\":{},\"land\":{},\"currents\":{},\"wind\":[{},{}]}}",
            json::quote(&value),
            stats.width,
            stats.height,
            stats.cells,
            stats.land,
            stats.currents,
            stats.wind.dx,
            stats.wind.dy
        ),
    )
}

/// Returns counts-only summary of two charts from the Rust core.
pub fn api_diff_summary(body: &str) -> String {
    let parsed = match json::fields(body) {
        Ok(parsed) => parsed,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let field = |name: &str| {
        parsed
            .get(name)
            .ok_or_else(|| format!("missing field '{name}'"))
            .and_then(|value| json::string_value(value))
    };
    let left = match field("left") {
        Ok(text) => text,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let right = match field("right") {
        Ok(text) => text,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let summary = chart::diff_summary(&chart::diff(&left, &right));
    response(
        200,
        "application/json",
        &format!(
            "{{\"ok\":true,\"changed\":{},\"added\":{},\"removed\":{},\"total\":{}}}",
            summary.changed, summary.added, summary.removed, summary.total
        ),
    )
}

/// Returns a line-by-line diff of two charts from the Rust core.
pub fn api_chart_diff(body: &str) -> String {
    let parsed = match json::fields(body) {
        Ok(parsed) => parsed,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let field = |name: &str| {
        parsed
            .get(name)
            .ok_or_else(|| format!("missing field '{name}'"))
            .and_then(|value| json::string_value(value))
    };
    let left = match field("left") {
        Ok(text) => text,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let right = match field("right") {
        Ok(text) => text,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let rows: Vec<String> = chart::diff(&left, &right)
        .iter()
        .map(|row| {
            format!(
                "{{\"line\":{},\"kind\":{},\"left\":{},\"right\":{}}}",
                row.line,
                json::quote(row.kind),
                json::quote(&row.left),
                json::quote(&row.right)
            )
        })
        .collect();
    response(
        200,
        "application/json",
        &format!("{{\"ok\":true,\"rows\":[{}]}}", rows.join(",")),
    )
}

/// Returns the stable fingerprint of a chart from the Rust core.
pub fn api_fingerprint(body: &str) -> String {
    let parsed = match json::fields(body) {
        Ok(parsed) => parsed,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let raw = match parsed
        .get("chart")
        .ok_or_else(|| "missing field 'chart'".to_string())
        .and_then(|value| json::string_value(value))
    {
        Ok(text) => text,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    match chart::fingerprint(&raw) {
        Ok(value) => response(
            200,
            "application/json",
            &format!("{{\"ok\":true,\"fingerprint\":{}}}", json::quote(&value)),
        ),
        Err(err) => response(400, "application/json", &error_json(&err)),
    }
}

/// Plans one query against both the chart and its calm baseline in Rust.
pub fn api_compare(body: &str) -> String {
    let parsed = match json::fields(body) {
        Ok(parsed) => parsed,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let raw = match parsed
        .get("chart")
        .ok_or_else(|| "missing field 'chart'".to_string())
        .and_then(|value| json::string_value(value))
    {
        Ok(text) => text,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let from = match parsed
        .get("from")
        .ok_or_else(|| "missing field 'from'".to_string())
        .and_then(|value| json::point_value(value))
    {
        Ok(point) => point,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let to = match parsed
        .get("to")
        .ok_or_else(|| "missing field 'to'".to_string())
        .and_then(|value| json::point_value(value))
    {
        Ok(point) => point,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let still_text = match chart::calm(&raw) {
        Ok(text) => text,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let sea = match chart::parse(&raw) {
        Ok(sea) => sea,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let calm_sea = match chart::parse(&still_text) {
        Ok(sea) => sea,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let (wind, calm) = match (find_route(&sea, from, to), find_route(&calm_sea, from, to)) {
        (Ok(Some(wind)), Ok(Some(calm))) => (wind, calm),
        (Ok(None), _) | (_, Ok(None)) => {
            let message = format!(
                "NO ROUTE: ({},{}) cannot reach ({},{}) on this chart",
                from.0, from.1, to.0, to.1
            );
            return response(200, "application/json", &error_json(&message));
        }
        (Err(err), _) | (_, Err(err)) => {
            return response(400, "application/json", &error_json(&err))
        }
    };
    response(
        200,
        "application/json",
        &comparison_json(from, to, &wind, &calm),
    )
}

/// Answers a planning request from the browser.
pub fn api_route(body: &str) -> String {
    let parsed = match json::fields(body) {
        Ok(parsed) => parsed,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let chart_text = match parsed
        .get("chart")
        .ok_or_else(|| "missing field 'chart'".to_string())
        .and_then(|raw| json::string_value(raw))
    {
        Ok(text) => text,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let from = match parsed
        .get("from")
        .ok_or_else(|| "missing field 'from'".to_string())
        .and_then(|raw| json::point_value(raw))
    {
        Ok(point) => point,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let to = match parsed
        .get("to")
        .ok_or_else(|| "missing field 'to'".to_string())
        .and_then(|raw| json::point_value(raw))
    {
        Ok(point) => point,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    let sea = match chart::parse(&chart_text) {
        Ok(sea) => sea,
        Err(err) => return response(400, "application/json", &error_json(&err)),
    };
    match find_route(&sea, from, to) {
        Ok(Some(route)) => {
            let map = render_ascii(&sea, from, to, Some(&route));
            response(200, "application/json", &route_json(from, to, &route, &map))
        }
        Ok(None) => response(
            200,
            "application/json",
            &error_json(&format!(
                "NO ROUTE: ({},{}) cannot reach ({},{}) on this chart",
                from.0, from.1, to.0, to.1
            )),
        ),
        Err(err) => response(400, "application/json", &error_json(&err)),
    }
}

/// The shared machine-readable route document used by the API and the CLI.
pub fn route_json(from: (u32, u32), to: (u32, u32), route: &Route, map: &str) -> String {
    let steps: Vec<String> = route.steps.iter().map(|step| json::quote(step)).collect();
    let points: Vec<String> = route
        .waypoints
        .iter()
        .map(|(x, y)| format!("[{x},{y}]"))
        .collect();
    format!(
        "{{\"ok\":true,\"from\":[{},{}],\"to\":[{},{}],\"steps\":[{}],\"step_times\":[{}],\"waypoints\":[{}],\"time\":{},\"explored\":{},\"ascii\":{}}}",
        from.0,
        from.1,
        to.0,
        to.1,
        steps.join(","),
        route
            .step_times
            .iter()
            .map(|time| time.to_string())
            .collect::<Vec<String>>()
            .join(","),
        points.join(","),
        route.time,
        route.explored,
        json::quote(map)
    )
}

/// A machine-readable wind-vs-calm comparison for the CLI.
pub fn comparison_json(
    from: (u32, u32),
    to: (u32, u32),
    wind: &Route,
    calm: &Route,
) -> String {
    let saved = calm.time as i64 - wind.time as i64;
    format!(
        "{{\"ok\":true,\"from\":[{},{}],\"to\":[{},{}],\"saved\":{},\"wind\":{},\"calm\":{}}}",
        from.0,
        from.1,
        to.0,
        to.1,
        saved,
        route_json(from, to, wind, ""),
        route_json(from, to, calm, "")
    )
}

/// A stable error document; never a bare string.
pub fn error_json(message: &str) -> String {
    format!("{{\"ok\":false,\"error\":{}}}", json::quote(message))
}

/// Serves requests forever on an already-bound listener.
pub fn serve(listener: TcpListener, project_root: &Path) {
    for connection in listener.incoming() {
        if let Ok(mut stream) = connection {
            answer(&mut stream, project_root);
        }
    }
}

fn answer(stream: &mut TcpStream, project_root: &Path) {
    if stream.set_read_timeout(Some(Duration::from_secs(5))).is_err() {
        return;
    }
    let request = match read_request(stream) {
        Some(request) => request,
        None => return,
    };
    let response = handle(&request, project_root);
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// Reads until the declared body is complete, honouring `Expect: 100-continue`
/// clients such as PowerShell's `Invoke-RestMethod`.
fn read_request(stream: &mut TcpStream) -> Option<String> {
    let mut bytes: Vec<u8> = Vec::with_capacity(4096);
    let mut buffer = [0u8; 8192];
    loop {
        let read = match stream.read(&mut buffer) {
            Ok(read) => read,
            Err(_) => break,
        };
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..read]);
        if bytes.len() > 1024 * 1024 {
            return None;
        }
        let text = String::from_utf8_lossy(&bytes).into_owned();
        if let Some((head, body)) = text.split_once("\r\n\r\n").or_else(|| text.split_once("\n\n")) {
            if body.as_bytes().len() >= content_length(head) {
                return Some(text);
            }
        }
        if text.to_ascii_lowercase().contains("expect: 100-continue") {
            let _ = stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n");
            let _ = stream.flush();
        }
    }
    None
}

fn content_length(head: &str) -> usize {
    for line in head.lines() {
        let lower = line.to_ascii_lowercase();
        if let Some(value) = lower.strip_prefix("content-length:") {
            if let Ok(length) = value.trim().parse::<usize>() {
                return length;
            }
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> &'static Path {
        Path::new(env!("CARGO_MANIFEST_DIR"))
    }

    #[test]
    fn parses_requests_with_both_line_endings() {
        let crlf = "POST /api/route?x=1 HTTP/1.1\r\nHost: local\r\n\r\n{}";
        let request = parse_request(crlf).unwrap();
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/api/route");
        assert_eq!(request.body, "{}");
        let lf = "GET /styles.css HTTP/1.1\n\n";
        assert_eq!(parse_request(lf).unwrap().path, "/styles.css");
    }

    #[test]
    fn static_pages_are_served_and_traversal_is_not_reachable() {
        let html = handle("GET / HTTP/1.1\r\n\r\n", root());
        assert!(html.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(html.contains("Trireme"));
        let js = handle("GET /app.js HTTP/1.1\r\n\r\n", root());
        assert!(js.contains("text/javascript"));
        let gone = handle("GET /../Cargo.toml HTTP/1.1\r\n\r\n", root());
        assert!(gone.starts_with("HTTP/1.1 404"));
    }

    #[test]
    fn route_api_returns_the_same_answer_as_the_cli() {
        let body = "{\"chart\":\"TRIREME-CHART v1\\ngrid 5 1\\nwind 0 0\\n\",\"from\":[0,0],\"to\":[4,0]}";
        let out = api_route(body);
        assert!(out.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(out.contains("\"ok\":true"));
        assert!(out.contains("\"steps\":[\"E\",\"E\",\"E\",\"E\"]"));
        assert!(out.contains("\"time\":400"));
        assert!(out.contains("\"ascii\":\"SoooG\""));
    }

    #[test]
    fn inspect_endpoint_combines_stats_fingerprint_and_issues() {
        let good = "{\"chart\":\"TRIREME-CHART v1\\ngrid 4 3\\nwind 1 0\\nland 2 2\\n\"}";
        let out = api_inspect(good);
        assert!(out.starts_with("HTTP/1.1 200 OK\r\n"), "{out}");
        assert!(out.contains("\"valid\":true"));
        assert!(out.contains("\"cells\":12"));
        assert!(out.contains("\"fingerprint\":\""));
        let bad = "{\"chart\":\"TRIREME-CHART v1\\nwind 2 0\\n\"}";
        let bad_out = api_inspect(bad);
        assert!(bad_out.contains("\"valid\":false"), "{bad_out}");
        assert!(bad_out.contains("\"issues\":[{"));
        assert!(api_inspect("{}").starts_with("HTTP/1.1 400"));
    }

    #[test]
    fn diff_summary_endpoint_returns_counts() {
        let body = "{\"left\":\"a\\nb\",\"right\":\"a\\nc\\nd\"}";
        let out = api_diff_summary(body);
        assert!(out.starts_with("HTTP/1.1 200 OK\r\n"), "{out}");
        assert!(out.contains("\"changed\":1"));
        assert!(out.contains("\"added\":1"));
        assert!(out.contains("\"total\":2"));
        assert!(api_diff_summary("{}").starts_with("HTTP/1.1 400"));
    }

    #[test]
    fn chart_diff_endpoint_returns_rust_rows() {
        let body = "{\"left\":\"a\\nb\",\"right\":\"a\\nc\\nd\"}";
        let out = api_chart_diff(body);
        assert!(out.starts_with("HTTP/1.1 200 OK\r\n"), "{out}");
        assert!(out.contains("\"ok\":true"));
        assert!(out.contains("\"line\":2"));
        assert!(out.contains("\"kind\":\"changed\""));
        assert!(out.contains("\"kind\":\"added\""));
        assert!(api_chart_diff("{}").starts_with("HTTP/1.1 400"));
    }

    #[test]
    fn fingerprint_endpoint_returns_a_stable_id() {
        let body = "{\"chart\":\"TRIREME-CHART v1\\ngrid 4 3\\nwind 1 0\\n\"}";
        let out = api_fingerprint(body);
        assert!(out.starts_with("HTTP/1.1 200 OK\r\n"), "{out}");
        assert!(out.contains("\"ok\":true"));
        assert!(out.contains("\"fingerprint\":\""));
        assert_eq!(out, api_fingerprint(body));
        assert!(api_fingerprint("{}").starts_with("HTTP/1.1 400"));
        assert!(api_fingerprint("{\"chart\":\"grid 2 2\"}").starts_with("HTTP/1.1 400"));
    }

    #[test]
    fn compare_endpoint_returns_the_rust_comparison_document() {
        let body = "{\"chart\":\"TRIREME-CHART v1\\ngrid 5 1\\nwind 1 0\\n\",\"from\":[0,0],\"to\":[4,0]}";
        let out = api_compare(body);
        assert!(out.starts_with("HTTP/1.1 200 OK\r\n"), "{out}");
        assert!(out.contains("\"ok\":true"));
        assert!(out.contains("\"saved\":68"));
        assert!(out.contains("\"wind\":{"));
        assert!(out.contains("\"calm\":{"));
        assert!(api_compare("{}").starts_with("HTTP/1.1 400"));
        assert!(api_compare("{\"chart\":\"grid 2 2\",\"from\":[0,0],\"to\":[1,1]}")
            .starts_with("HTTP/1.1 400"));
    }

    #[test]
    fn normalize_endpoint_returns_canonical_chart() {
        let body = "{\"chart\":\"# note\\nTRIREME-CHART v1\\ncurrent 1 1 0 1\\ngrid 4 3\\nwind 1 0\\n\"}";
        let out = api_normalize(body);
        assert!(out.starts_with("HTTP/1.1 200 OK\r\n"), "{out}");
        assert!(out.contains("\"ok\":true"));
        assert!(out.contains("grid 4 3\\nwind 1 0\\ncurrent 1 1 0 1"));
        assert!(!out.contains("# note"));
        assert!(api_normalize("{}").starts_with("HTTP/1.1 400"));
        assert!(api_normalize("{\"chart\":\"grid 2 2\"}").starts_with("HTTP/1.1 400"));
    }

    #[test]
    fn issues_endpoint_returns_line_numbered_problems() {
        let body = "{\"chart\":\"TRIREME-CHART v1\\ngrid 2 2\\nwind 2 0\\n\"}";
        let out = api_issues(body);
        assert!(out.starts_with("HTTP/1.1 200 OK\r\n"), "{out}");
        assert!(out.contains("\"ok\":true"));
        assert!(out.contains("\"line\":3"));
        assert!(out.contains("wind <dx>"));
        let clean = api_issues("{\"chart\":\"TRIREME-CHART v1\\ngrid 2 2\\nwind 0 0\\n\"}");
        assert!(clean.contains("\"issues\":[]"), "{clean}");
        assert!(api_issues("{}").starts_with("HTTP/1.1 400"));
    }

    #[test]
    fn stats_endpoint_returns_rust_derived_counts() {
        let body = "{\"chart\":\"TRIREME-CHART v1\\ngrid 4 3\\nwind 1 0\\nland 2 2\\ncurrent 1 1 0 1\\n\"}";
        let out = api_stats(body);
        assert!(out.starts_with("HTTP/1.1 200 OK\r\n"), "{out}");
        assert!(out.contains("\"cells\":12"));
        assert!(out.contains("\"land\":1"));
        assert!(out.contains("\"currents\":1"));
        assert!(out.contains("\"wind\":[1,0]"));
        assert!(api_stats("{}").starts_with("HTTP/1.1 400"));
        assert!(api_stats("{\"chart\":\"grid 2 2\"}").starts_with("HTTP/1.1 400"));
    }

    #[test]
    fn calm_endpoint_returns_the_rust_baseline() {
        let body = "{\"chart\":\"TRIREME-CHART v1\\ngrid 4 1\\nwind 1 0\\ncurrent 0 0 1 0\\n\"}";
        let out = api_calm(body);
        assert!(out.starts_with("HTTP/1.1 200 OK\r\n"), "{out}");
        assert!(out.contains("\"ok\":true"));
        assert!(out.contains("wind 0 0"));
        assert!(out.contains("current 0 0 0 0"));
        assert!(api_calm("{}").starts_with("HTTP/1.1 400"));
        assert!(api_calm("{\"chart\":\"grid 2 2\"}").starts_with("HTTP/1.1 400"));
    }

    #[test]
    fn route_document_exposes_one_time_per_step() {
        let body = "{\"chart\":\"TRIREME-CHART v1\\ngrid 5 1\\nwind 0 0\\n\",\"from\":[0,0],\"to\":[4,0]}";
        let out = api_route(body);
        assert!(out.contains("\"step_times\":[100,100,100,100]"), "{out}");
    }

    #[test]
    fn bad_json_and_bad_charts_are_refused_without_panicking() {
        assert!(api_route("{}").starts_with("HTTP/1.1 400"));
        let bad = "{\"chart\":\"not a chart\",\"from\":[0,0],\"to\":[1,1]}";
        assert!(api_route(bad).starts_with("HTTP/1.1 400"));
        let far = "{\"chart\":\"TRIREME-CHART v1\\ngrid 2 2\\nwind 0 0\\n\",\"from\":[9,9],\"to\":[1,1]}";
        assert!(api_route(far).starts_with("HTTP/1.1 400"));
    }

    #[test]
    fn content_length_is_read_case_insensitively() {
        let head = "POST /api/route HTTP/1.1\r\nContent-Length: 42\r\nExpect: 100-continue\r\n";
        assert_eq!(content_length(head), 42);
        assert_eq!(content_length("GET / HTTP/1.1"), 0);
    }

    #[test]
    fn a_key_inside_the_chart_text_is_not_read_as_a_field() {
        let body = "{\"chart\":\"TRIREME-CHART v1\\n# from:[9,9]\\ngrid 2 2\\nwind 0 0\\n\",\"from\":[0,0],\"to\":[1,1]}";
        let out = api_route(body);
        assert!(out.contains("\"ok\":true"), "{out}");
        assert!(out.contains("\"from\":[0,0]"), "{out}");
    }
}
