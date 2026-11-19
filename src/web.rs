//! A tiny, dependency-free HTTP server for the browser UI.
//!
//! It serves three static files from `web/` and one JSON endpoint that calls
//! the same chart parser and router as the CLI. No framework, no crates.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::time::Duration;

use crate::chart;
use crate::router::{find_route, render_ascii};

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

/// Answers a planning request from the browser.
pub fn api_route(body: &str) -> String {
    let chart_text = match json_string(body, "chart") {
        Ok(text) => text,
        Err(err) => return response(400, "application/json", &json_error(&err)),
    };
    let from = match json_point(body, "from") {
        Ok(point) => point,
        Err(err) => return response(400, "application/json", &json_error(&err)),
    };
    let to = match json_point(body, "to") {
        Ok(point) => point,
        Err(err) => return response(400, "application/json", &json_error(&err)),
    };
    let sea = match chart::parse(&chart_text) {
        Ok(sea) => sea,
        Err(err) => return response(400, "application/json", &json_error(&err)),
    };
    match find_route(&sea, from, to) {
        Ok(Some(route)) => {
            let steps: Vec<String> = route.steps.iter().map(|step| format!("\"{step}\"")).collect();
            let points: Vec<String> = route
                .waypoints
                .iter()
                .map(|(x, y)| format!("[{x},{y}]"))
                .collect();
            let map = render_ascii(&sea, from, to, Some(&route));
            let json = format!(
                "{{\"ok\":true,\"steps\":[{}],\"waypoints\":[{}],\"time\":{},\"explored\":{},\"ascii\":{}}}",
                steps.join(","),
                points.join(","),
                route.time,
                route.explored,
                json_string_literal(&map)
            );
            response(200, "application/json", &json)
        }
        Ok(None) => response(
            200,
            "application/json",
            &json_error(&format!(
                "NO ROUTE: ({},{}) cannot reach ({},{}) on this chart",
                from.0, from.1, to.0, to.1
            )),
        ),
        Err(err) => response(400, "application/json", &json_error(&err)),
    }
}

fn json_error(message: &str) -> String {
    format!("{{\"ok\":false,\"error\":{}}}", json_string_literal(message))
}

/// Reads one string field from a flat JSON object, decoding common escapes.
fn json_string(body: &str, key: &str) -> Result<String, String> {
    let needle = format!("\"{key}\"");
    let at = body
        .find(&needle)
        .ok_or_else(|| format!("missing field '{key}'"))?;
    let rest = body[at + needle.len()..]
        .trim_start()
        .strip_prefix(':')
        .ok_or_else(|| format!("field '{key}' has no value"))?
        .trim_start();
    let raw = rest
        .strip_prefix('"')
        .ok_or_else(|| format!("field '{key}' must be a string"))?;
    let mut out = String::new();
    let mut chars = raw.chars();
    while let Some(ch) = chars.next() {
        match ch {
            '"' => return Ok(out),
            '\\' => match chars.next() {
                Some('n') => out.push('\n'),
                Some('r') => out.push('\r'),
                Some('t') => out.push('\t'),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some(other) => out.push(other),
                None => return Err(format!("field '{key}' ends with a backslash")),
            },
            other => out.push(other),
        }
    }
    Err(format!("field '{key}' has no closing quote"))
}

/// Reads a `[x,y]` field from a flat JSON object.
fn json_point(body: &str, key: &str) -> Result<(u32, u32), String> {
    let needle = format!("\"{key}\"");
    let at = body
        .find(&needle)
        .ok_or_else(|| format!("missing field '{key}'"))?;
    let rest = body[at + needle.len()..]
        .trim_start()
        .strip_prefix(':')
        .ok_or_else(|| format!("field '{key}' has no value"))?
        .trim_start();
    let inside = rest
        .strip_prefix('[')
        .ok_or_else(|| format!("field '{key}' must be an [x,y] array"))?;
    let end = inside
        .find(']')
        .ok_or_else(|| format!("field '{key}' has no closing bracket"))?;
    let mut numbers = inside[..end].split(',');
    let x = numbers
        .next()
        .and_then(|part| part.trim().parse::<u32>().ok())
        .ok_or_else(|| format!("field '{key}' has an invalid x"))?;
    let y = numbers
        .next()
        .and_then(|part| part.trim().parse::<u32>().ok())
        .ok_or_else(|| format!("field '{key}' has an invalid y"))?;
    if numbers.next().is_some() {
        return Err(format!("field '{key}' must have exactly two numbers"));
    }
    Ok((x, y))
}

/// Quotes and escapes a string for use as a JSON value.
fn json_string_literal(value: &str) -> String {
    let mut out = String::from("\"");
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            other => out.push(other),
        }
    }
    out.push('"');
    out
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
    fn escaping_keeps_newlines_and_quotes_valid() {
        assert_eq!(json_string_literal("a\n\"b\""), "\"a\\n\\\"b\\\"\"");
        let body = "{\"chart\":\"TRIREME-CHART v1\\ngrid 2 2\\nwind 0 0\\n\",\"from\":[0,0],\"to\":[1,1]}";
        assert!(json_string(body, "chart").unwrap().contains('\n'));
        assert_eq!(json_point(body, "from").unwrap(), (0, 0));
    }
}
