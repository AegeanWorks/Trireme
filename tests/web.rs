//! The real HTTP server, exercised over loopback TCP.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

use trireme::web;

const BODY: &[u8] = br#"{"chart":"TRIREME-CHART v1\ngrid 5 1\nwind 0 0\n","from":[0,0],"to":[4,0]}"#;

fn spawn_server() -> SocketAddr {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    thread::spawn(move || web::serve(listener, &root));
    address
}

fn ask(address: SocketAddr, request: &[u8]) -> String {
    let mut stream = TcpStream::connect(address).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    stream.write_all(request).unwrap();
    let mut buffer = [0u8; 64 * 1024];
    let read = stream.read(&mut buffer).unwrap();
    String::from_utf8_lossy(&buffer[..read]).into_owned()
}

#[test]
fn server_serves_the_page_and_answers_a_route() {
    let address = spawn_server();
    let page = ask(address, b"GET / HTTP/1.1\r\nHost: test\r\n\r\n");
    assert!(page.starts_with("HTTP/1.1 200 OK\r\n"), "{page}");
    assert!(page.contains("Sea chart"));
    assert!(page.contains("Plan route"));

    let request = format!(
        "POST /api/route HTTP/1.1\r\nHost: test\r\nContent-Length: {}\r\n\r\n{}",
        BODY.len(),
        String::from_utf8_lossy(BODY)
    );
    let answer = ask(address, request.as_bytes());
    assert!(answer.starts_with("HTTP/1.1 200 OK\r\n"), "{answer}");
    assert!(answer.contains("\"ok\":true"));
    assert!(answer.contains("\"time\":400"));
}

#[test]
fn server_returns_diff_summaries_over_http() {
    let address = spawn_server();
    let body = br#"{"left":"a\nb","right":"a\nc\nd"}"#;
    let request = format!(
        "POST /api/diff-summary HTTP/1.1\r\nHost: test\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        String::from_utf8_lossy(body)
    );
    let answer = ask(address, request.as_bytes());
    assert!(answer.starts_with("HTTP/1.1 200 OK\r\n"), "{answer}");
    assert!(answer.contains("\"ok\":true"));
    assert!(answer.contains("\"total\":2"));
}

#[test]
fn server_returns_chart_diffs_over_http() {
    let address = spawn_server();
    let body = br#"{"left":"TRIREME-CHART v1\nwind 0 0","right":"TRIREME-CHART v1\nwind 1 0"}"#;
    let request = format!(
        "POST /api/chart-diff HTTP/1.1\r\nHost: test\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        String::from_utf8_lossy(body)
    );
    let answer = ask(address, request.as_bytes());
    assert!(answer.starts_with("HTTP/1.1 200 OK\r\n"), "{answer}");
    assert!(answer.contains("\"ok\":true"));
    assert!(answer.contains("\"kind\":\"changed\""));
    assert!(answer.contains("\"line\":2"));
}

#[test]
fn server_returns_chart_fingerprints_over_http() {
    let address = spawn_server();
    let body = br#"{"chart":"TRIREME-CHART v1\ngrid 3 2\nwind 0 0\n"}"#;
    let request = format!(
        "POST /api/fingerprint HTTP/1.1\r\nHost: test\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        String::from_utf8_lossy(body)
    );
    let answer = ask(address, request.as_bytes());
    assert!(answer.starts_with("HTTP/1.1 200 OK\r\n"), "{answer}");
    assert!(answer.contains("\"ok\":true"));
    assert!(answer.contains("\"fingerprint\":\""));
}

#[test]
fn server_compares_over_http() {
    let address = spawn_server();
    let body = br#"{"chart":"TRIREME-CHART v1\ngrid 5 1\nwind 1 0\n","from":[0,0],"to":[4,0]}"#;
    let request = format!(
        "POST /api/compare HTTP/1.1\r\nHost: test\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        String::from_utf8_lossy(body)
    );
    let answer = ask(address, request.as_bytes());
    assert!(answer.starts_with("HTTP/1.1 200 OK\r\n"), "{answer}");
    assert!(answer.contains("\"ok\":true"));
    assert!(answer.contains("\"saved\":68"));
    assert!(answer.contains("\"wind\":{"));
}

#[test]
fn server_normalizes_charts_over_http() {
    let address = spawn_server();
    let body = br#"{"chart":"TRIREME-CHART v1\nland 1 1\nwind 0 0\ngrid 3 2\n"}"#;
    let request = format!(
        "POST /api/normalize HTTP/1.1\r\nHost: test\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        String::from_utf8_lossy(body)
    );
    let answer = ask(address, request.as_bytes());
    assert!(answer.starts_with("HTTP/1.1 200 OK\r\n"), "{answer}");
    assert!(answer.contains("\"ok\":true"));
    assert!(answer.contains("grid 3 2\\nwind 0 0\\nland 1 1"));
}

#[test]
fn server_returns_chart_issues_over_http() {
    let address = spawn_server();
    let body = br#"{"chart":"TRIREME-CHART v1\ngrid 3 1\nwind 2 0\n"}"#;
    let request = format!(
        "POST /api/issues HTTP/1.1\r\nHost: test\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        String::from_utf8_lossy(body)
    );
    let answer = ask(address, request.as_bytes());
    assert!(answer.starts_with("HTTP/1.1 200 OK\r\n"), "{answer}");
    assert!(answer.contains("\"issues\":[{"));
    assert!(answer.contains("\"line\":3"));
}

#[test]
fn server_returns_rust_stats_over_http() {
    let address = spawn_server();
    let body = br#"{"chart":"TRIREME-CHART v1\ngrid 3 2\nwind 0 -1\nland 1 1\n"}"#;
    let request = format!(
        "POST /api/stats HTTP/1.1\r\nHost: test\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        String::from_utf8_lossy(body)
    );
    let answer = ask(address, request.as_bytes());
    assert!(answer.starts_with("HTTP/1.1 200 OK\r\n"), "{answer}");
    assert!(answer.contains("\"cells\":6"));
    assert!(answer.contains("\"land\":1"));
    assert!(answer.contains("\"wind\":[0,-1]"));
}

#[test]
fn server_returns_the_calm_baseline_over_http() {
    let address = spawn_server();
    let body = br#"{"chart":"TRIREME-CHART v1\ngrid 3 1\nwind 1 0\ncurrent 0 0 1 0\n"}"#;
    let request = format!(
        "POST /api/calm HTTP/1.1\r\nHost: test\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        String::from_utf8_lossy(body)
    );
    let answer = ask(address, request.as_bytes());
    assert!(answer.starts_with("HTTP/1.1 200 OK\r\n"), "{answer}");
    assert!(answer.contains("\"ok\":true"));
    assert!(answer.contains("wind 0 0"));
    assert!(answer.contains("current 0 0 0 0"));
}

#[test]
fn server_answers_expect_continue_clients() {
    let address = spawn_server();
    let mut stream = TcpStream::connect(address).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    let head = format!(
        "POST /api/route HTTP/1.1\r\nHost: test\r\nContent-Length: {}\r\nExpect: 100-continue\r\n\r\n",
        BODY.len()
    );
    stream.write_all(head.as_bytes()).unwrap();

    let mut first = [0u8; 256];
    let read = stream.read(&mut first).unwrap();
    assert!(
        String::from_utf8_lossy(&first[..read]).contains("100 Continue"),
        "no continue: {}",
        String::from_utf8_lossy(&first[..read])
    );

    stream.write_all(BODY).unwrap();
    let mut buffer = [0u8; 64 * 1024];
    let read = stream.read(&mut buffer).unwrap();
    let answer = String::from_utf8_lossy(&buffer[..read]);
    assert!(answer.starts_with("HTTP/1.1 200 OK\r\n"), "{answer}");
    assert!(answer.contains("\"ok\":true"));
}
