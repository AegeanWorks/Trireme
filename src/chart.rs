//! Sea charts: a small, human-editable text format describing water, land,
//! wind and local currents. No query lives in a chart; routes ask for one.

use std::collections::{HashMap, HashSet};

/// First line of every chart file.
pub const HEADER: &str = "TRIREME-CHART v1";

/// A direction or flow on the grid; each component is -1, 0 or 1.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Vec2 {
    pub dx: i8,
    pub dy: i8,
}

impl Vec2 {
    /// Builds a vector, refusing components outside the chart alphabet.
    pub fn new(dx: i8, dy: i8) -> Result<Self, String> {
        if (-1..=1).contains(&dx) && (-1..=1).contains(&dy) {
            Ok(Self { dx, dy })
        } else {
            Err(format!("vector ({dx},{dy}) has a component outside -1..=1"))
        }
    }

    /// The still-water flow used where a chart declares no local current.
    pub fn calm() -> Self {
        Self { dx: 0, dy: 0 }
    }
}

/// The environment a ship sails through.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Chart {
    pub width: u32,
    pub height: u32,
    pub wind: Vec2,
    pub land: HashSet<(u32, u32)>,
    pub currents: HashMap<(u32, u32), Vec2>,
}

impl Chart {
    /// Whether a point is inside the grid.
    pub fn contains(&self, point: (u32, u32)) -> bool {
        point.0 < self.width && point.1 < self.height
    }

    /// Land cannot be entered.
    pub fn is_land(&self, point: (u32, u32)) -> bool {
        self.land.contains(&point)
    }

    /// Local current at a point, or still water.
    pub fn current_at(&self, point: (u32, u32)) -> Vec2 {
        self.currents.get(&point).copied().unwrap_or_else(Vec2::calm)
    }
}

/// Parses chart text. Directives may appear in any order; duplicates of
/// `grid` or `wind` are errors, and every coordinate is range-checked.
pub fn parse(text: &str) -> Result<Chart, String> {
    let mut lines = text.lines().enumerate();
    let mut found_header = false;
    for (index, raw) in &mut lines {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line == HEADER {
            found_header = true;
        } else {
            return Err(format!(
                "line {}: chart header must be '{HEADER}', found '{line}'",
                index + 1
            ));
        }
        break;
    }
    if !found_header {
        return Err(format!("chart has no '{HEADER}' header"));
    }

    let mut grid: Option<(u32, u32)> = None;
    let mut wind: Option<Vec2> = None;
    let mut land_lines: Vec<((u32, u32), usize)> = Vec::new();
    let mut current_lines: Vec<(((u32, u32), Vec2), usize)> = Vec::new();

    for (index, raw) in lines {
        let number = index + 2;
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        match parts[0] {
            "grid" => {
                if grid.is_some() {
                    return Err(format!("line {number}: grid declared more than once"));
                }
                if parts.len() != 3 {
                    return Err(format!("line {number}: grid needs a width and a height"));
                }
                let width = parse_u32(parts[1], number, "width")?;
                let height = parse_u32(parts[2], number, "height")?;
                if width == 0 || height == 0 {
                    return Err(format!("line {number}: grid dimensions must be positive"));
                }
                grid = Some((width, height));
            }
            "wind" => {
                if wind.is_some() {
                    return Err(format!("line {number}: wind declared more than once"));
                }
                if parts.len() != 3 {
                    return Err(format!("line {number}: wind needs dx and dy"));
                }
                let dx = parse_i8(parts[1], number, "wind dx")?;
                let dy = parse_i8(parts[2], number, "wind dy")?;
                wind = Some(Vec2::new(dx, dy).map_err(|err| format!("line {number}: {err}"))?);
            }
            "land" => {
                if parts.len() != 3 {
                    return Err(format!("line {number}: land needs x and y"));
                }
                let x = parse_u32(parts[1], number, "land x")?;
                let y = parse_u32(parts[2], number, "land y")?;
                land_lines.push(((x, y), number));
            }
            "current" => {
                if parts.len() != 5 {
                    return Err(format!("line {number}: current needs x, y, dx and dy"));
                }
                let x = parse_u32(parts[1], number, "current x")?;
                let y = parse_u32(parts[2], number, "current y")?;
                let dx = parse_i8(parts[3], number, "current dx")?;
                let dy = parse_i8(parts[4], number, "current dy")?;
                let vector =
                    Vec2::new(dx, dy).map_err(|err| format!("line {number}: {err}"))?;
                current_lines.push((((x, y), vector), number));
            }
            other => return Err(format!("line {number}: unknown directive '{other}'")),
        }
    }

    let (width, height) = grid.ok_or_else(|| "chart has no grid directive".to_string())?;
    let wind = wind.ok_or_else(|| "chart has no wind directive".to_string())?;
    let check = |point: (u32, u32), line: usize| {
        if point.0 >= width || point.1 >= height {
            Err(format!(
                "line {line}: point ({},{}) lies outside the {width}x{height} grid",
                point.0, point.1
            ))
        } else {
            Ok(())
        }
    };
    for ((x, y), line) in &land_lines {
        check((*x, *y), *line)?;
    }
    for (((x, y), _), line) in &current_lines {
        check((*x, *y), *line)?;
    }
    let land = land_lines.into_iter().map(|(point, _)| point).collect();
    let currents = current_lines.into_iter().map(|(entry, _)| entry).collect();
    Ok(Chart {
        width,
        height,
        wind,
        land,
        currents,
    })
}

fn parse_u32(value: &str, line: usize, label: &str) -> Result<u32, String> {
    value
        .parse::<u32>()
        .map_err(|_| format!("line {line}: {label} '{value}' is not a non-negative integer"))
}

fn parse_i8(value: &str, line: usize, label: &str) -> Result<i8, String> {
    value
        .parse::<i8>()
        .map_err(|_| format!("line {line}: {label} '{value}' is not between -128 and 127"))
}

/// Serialises a chart in the same stable order the parser expects.
pub fn to_text(chart: &Chart) -> String {
    let mut text = format!("{HEADER}\ngrid {} {}\nwind {} {}\n", chart.width, chart.height, chart.wind.dx, chart.wind.dy);
    let mut land: Vec<(u32, u32)> = chart.land.iter().copied().collect();
    land.sort();
    for (x, y) in land {
        text.push_str(&format!("land {x} {y}\n"));
    }
    let mut currents: Vec<((u32, u32), Vec2)> = chart.currents.iter().map(|(p, v)| (*p, *v)).collect();
    currents.sort_by_key(|(point, _)| *point);
    for ((x, y), vector) in currents {
        text.push_str(&format!("current {x} {y} {} {}\n", vector.dx, vector.dy));
    }
    text
}

/// Returns a copy of the chart with wind and every current set to still water.
///
/// Land, grid size and comments are preserved, so the result is a genuine
/// calm-water baseline for the same geography. The text is validated first.
pub fn calm(text: &str) -> Result<String, String> {
    parse(text)?;
    let mut out: Vec<String> = Vec::new();
    for line in text.replace("\r\n", "\n").replace('\r', "\n").split('\n') {
        let trimmed = line.trim();
        if trimmed.starts_with("wind ") {
            out.push("wind 0 0".to_string());
        } else if trimmed.starts_with("current ") {
            let coordinates: Vec<&str> = trimmed.split_whitespace().take(3).collect();
            out.push(format!("{} 0 0", coordinates.join(" ")));
        } else {
            out.push(line.to_string());
        }
    }
    Ok(out.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHART: &str = "TRIREME-CHART v1\ngrid 4 3\nwind 1 0\nland 2 1\ncurrent 1 1 0 1\n";

    #[test]
    fn parses_a_chart_and_round_trips() {
        let chart = parse(CHART).unwrap();
        assert_eq!((chart.width, chart.height), (4, 3));
        assert_eq!(chart.wind, Vec2::new(1, 0).unwrap());
        assert!(chart.is_land((2, 1)));
        assert_eq!(chart.current_at((1, 1)), Vec2::new(0, 1).unwrap());
        assert_eq!(chart.current_at((0, 0)), Vec2::calm());
        assert_eq!(parse(&to_text(&chart)).unwrap(), chart);
    }

    #[test]
    fn comments_and_directive_order_do_not_matter() {
        let text = "# note\nTRIREME-CHART v1\n\nland 0 2\nwind 0 -1\ngrid 3 3\n";
        let chart = parse(text).unwrap();
        assert!(chart.is_land((0, 2)));
        assert_eq!(chart.wind, Vec2::new(0, -1).unwrap());
    }

    #[test]
    fn rejects_broken_charts_with_a_line_number() {
        let with_line = [
            "nope\ngrid 2 2\nwind 0 0\n",
            "TRIREME-CHART v1\ngrid 2 2\nwind 0 0\ngrid 3 3\n",
            "TRIREME-CHART v1\ngrid 2 2\nwind 0 0\nland 5 5\n",
            "TRIREME-CHART v1\ngrid 2 2\nwind 2 0\n",
            "TRIREME-CHART v1\ngrid 2 2\nwind 0 0\ncurrent 1 1 9 0\n",
            "TRIREME-CHART v1\ngrid 2 2\nwind 0 0\nunknown 1\n",
        ];
        for text in with_line {
            assert!(parse(text).is_err(), "accepted: {text}");
            assert!(parse(text).unwrap_err().contains("line"), "no line number: {text}");
        }
        let without_line = ["TRIREME-CHART v1\nwind 0 0\n", ""];
        for text in without_line {
            assert!(parse(text).is_err(), "accepted: {text}");
        }
    }

    #[test]
    fn calm_zeroes_flow_but_keeps_geography() {
        let text = concat!(
            "# note\r\nTRIREME-CHART v1\r\ngrid 4 3\r\nwind 1 -1\r\n",
            "land 2 2\r\ncurrent 1 1 0 1\r\ncurrent 3 0 -1 0\r\n"
        );
        let still = calm(text).unwrap();
        assert!(still.contains("# note"));
        assert!(still.contains("grid 4 3"));
        assert!(still.contains("land 2 2"));
        assert!(still.contains("wind 0 0"));
        assert!(still.contains("current 1 1 0 0"));
        assert!(still.contains("current 3 0 0 0"));
        assert!(!still.contains("wind 1 -1"));
        let parsed = parse(&still).unwrap();
        assert_eq!(parsed.wind, Vec2::calm());
        assert!(parsed.currents.values().all(|v| *v == Vec2::calm()));
        assert!(calm("grid 2 2\nwind 0 0\n").is_err());
    }

    #[test]
    fn vector_helper_bounds_components() {
        assert!(Vec2::new(1, -1).is_ok());
        assert!(Vec2::new(2, 0).is_err());
    }
}
