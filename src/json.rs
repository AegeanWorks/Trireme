//! The smallest JSON reader and writer Trireme needs.
//!
//! Requests are flat objects with string and `[x,y]` values. A real parser
//! avoids the classic bug where a key is matched inside a string value.

use std::collections::HashMap;

/// Quotes and escapes a string for use as a JSON value.
pub fn quote(value: &str) -> String {
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

/// Reads a flat object into raw value slices, keyed by decoded key names.
pub fn fields(body: &str) -> Result<HashMap<String, String>, String> {
    let bytes = body.as_bytes();
    let mut at = 0usize;
    skip_space(bytes, &mut at);
    if bytes.get(at) != Some(&b'{') {
        return Err("body must be a JSON object".to_string());
    }
    at += 1;
    let mut out = HashMap::new();
    loop {
        skip_space(bytes, &mut at);
        if bytes.get(at) == Some(&b'}') {
            return Ok(out);
        }
        let key = read_string(bytes, &mut at)?;
        skip_space(bytes, &mut at);
        if bytes.get(at) != Some(&b':') {
            return Err(format!("key '{key}' has no colon"));
        }
        at += 1;
        skip_space(bytes, &mut at);
        let value = read_value(body, bytes, &mut at)?;
        out.insert(key, value.to_string());
        skip_space(bytes, &mut at);
        match bytes.get(at) {
            Some(b',') => at += 1,
            Some(b'}') => return Ok(out),
            _ => return Err("expected ',' or '}' after a value".to_string()),
        }
    }
}

/// Decodes a quoted raw value, or refuses one that is not a string.
pub fn string_value(raw: &str) -> Result<String, String> {
    let bytes = raw.as_bytes();
    let mut at = 0usize;
    let value = read_string(bytes, &mut at)?;
    skip_space(bytes, &mut at);
    if at != bytes.len() {
        return Err("string has trailing characters".to_string());
    }
    Ok(value)
}

/// Decodes an `[x,y]` raw value into grid coordinates.
pub fn point_value(raw: &str) -> Result<(u32, u32), String> {
    let text = raw.trim();
    let inside = text
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
        .ok_or_else(|| "value must be an [x,y] array".to_string())?;
    let mut numbers = inside.split(',');
    let x = numbers
        .next()
        .and_then(|part| part.trim().parse::<u32>().ok())
        .ok_or_else(|| "x must be a non-negative integer".to_string())?;
    let y = numbers
        .next()
        .and_then(|part| part.trim().parse::<u32>().ok())
        .ok_or_else(|| "y must be a non-negative integer".to_string())?;
    if numbers.next().is_some() {
        return Err("array must have exactly two numbers".to_string());
    }
    Ok((x, y))
}

fn skip_space(bytes: &[u8], at: &mut usize) {
    while bytes.get(*at).is_some_and(u8::is_ascii_whitespace) {
        *at += 1;
    }
}

fn read_string(bytes: &[u8], at: &mut usize) -> Result<String, String> {
    if bytes.get(*at) != Some(&b'"') {
        return Err("expected a quoted string".to_string());
    }
    *at += 1;
    let mut out: Vec<u8> = Vec::new();
    while let Some(byte) = bytes.get(*at) {
        match byte {
            b'"' => {
                *at += 1;
                return String::from_utf8(out).map_err(|_| "string is not valid UTF-8".to_string());
            }
            b'\\' => {
                *at += 1;
                let escaped = *bytes.get(*at).ok_or_else(|| "string ends with a backslash".to_string())?;
                *at += 1;
                out.push(match escaped {
                    b'n' => b'\n',
                    b'r' => b'\r',
                    b't' => b'\t',
                    other => other,
                });
            }
            other => {
                out.push(*other);
                *at += 1;
            }
        }
    }
    Err("string has no closing quote".to_string())
}

fn read_value<'a>(source: &'a str, bytes: &[u8], at: &mut usize) -> Result<&'a str, String> {
    let start = *at;
    match bytes.get(*at) {
        Some(b'"') => {
            read_string(bytes, at)?;
        }
        Some(b'[') => {
            *at += 1;
            while let Some(byte) = bytes.get(*at) {
                *at += 1;
                if *byte == b']' {
                    break;
                }
            }
            if bytes.get(*at - 1) != Some(&b']') {
                return Err("array has no closing bracket".to_string());
            }
        }
        Some(_) => {
            while bytes
                .get(*at)
                .is_some_and(|byte| *byte != b',' && *byte != b'}')
            {
                *at += 1;
            }
        }
        None => return Err("missing value".to_string()),
    }
    Ok(&source[start..*at])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_object_round_trips_escapes() {
        let body = "{\"chart\":\"a\\nb\\\"c\",\"from\":[0,2],\"to\":[7,0]}";
        let parsed = fields(body).unwrap();
        assert_eq!(string_value(&parsed["chart"]).unwrap(), "a\nb\"c");
        assert_eq!(point_value(&parsed["from"]).unwrap(), (0, 2));
        assert_eq!(point_value(&parsed["to"]).unwrap(), (7, 0));
    }

    #[test]
    fn a_key_inside_a_value_is_not_mistaken_for_a_field() {
        let body = "{\"chart\":\"from:[9,9]\",\"from\":[1,1]}";
        let parsed = fields(body).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(point_value(&parsed["from"]).unwrap(), (1, 1));
    }

    #[test]
    fn malformed_objects_are_refused() {
        for body in [
            "{",
            "[]",
            "{\"chart\" [1,2]}",
            "{\"chart\":\"x\" \"from\":[0,0]}",
            "{\"chart\":\"unterminated}",
        ] {
            assert!(fields(body).is_err(), "accepted: {body}");
        }
        for raw in ["[1,2,3]", "[-1,2]", "[a,0]", "[0]"] {
            assert!(point_value(raw).is_err(), "accepted: {raw}");
        }
        assert!(string_value("[0,0]").is_err());
    }

    #[test]
    fn non_ascii_chart_text_survives_the_round_trip() {
        let body = "{\"chart\":\"# Türkçe yorum\\ngrid 2 2\\nwind 0 0\\n\"}";
        let parsed = fields(body).unwrap();
        assert!(string_value(&parsed["chart"]).unwrap().contains("Türkçe"));
    }

    #[test]
    fn quote_escapes_every_control_character_it_handles() {
        assert_eq!(quote("a\n\"b\\c"), "\"a\\n\\\"b\\\\c\"");
    }
}
