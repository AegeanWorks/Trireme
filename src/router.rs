//! Deterministic shortest-time routing over a [`Chart`].
//!
//! Costs are integer time units: a move's grid distance is scaled by wind and
//! current alignment. Dijkstra's queue is ordered by (cost, x, y), so equal
//! routes always resolve the same way on every machine — no floating point.

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};

use crate::chart::{Chart, Vec2};

/// The eight legal headings, their grid delta and their unscaled distance.
pub const MOVES: [(&str, i32, i32, u64); 8] = [
    ("N", 0, -1, 10),
    ("NE", 1, -1, 14),
    ("E", 1, 0, 10),
    ("SE", 1, 1, 14),
    ("S", 0, 1, 10),
    ("SW", -1, 1, 14),
    ("W", -1, 0, 10),
    ("NW", -1, -1, 14),
];

/// A found route, including every cell visited and the cells scanned to find it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Route {
    pub waypoints: Vec<(u32, u32)>,
    pub steps: Vec<&'static str>,
    /// Integer time of each move, in the same order as `steps`.
    pub step_times: Vec<u64>,
    pub time: u64,
    pub explored: u32,
}

/// Finds the fastest route, or `None` when the goal is unreachable.
pub fn find_route(
    chart: &Chart,
    from: (u32, u32),
    to: (u32, u32),
) -> Result<Option<Route>, String> {
    for point in [from, to] {
        if !chart.contains(point) {
            return Err(format!(
                "point ({},{}) lies outside the {}x{} grid",
                point.0, point.1, chart.width, chart.height
            ));
        }
    }
    if chart.is_land(from) || chart.is_land(to) {
        return Ok(None);
    }
    if from == to {
        return Ok(Some(Route {
            waypoints: vec![from],
            steps: Vec::new(),
            step_times: Vec::new(),
            time: 0,
            explored: 0,
        }));
    }

    let mut best: HashMap<(u32, u32), u64> = HashMap::new();
    let mut previous: HashMap<(u32, u32), ((u32, u32), &'static str, u64)> = HashMap::new();
    let mut queue = BinaryHeap::new();
    best.insert(from, 0);
    queue.push(Reverse((0u64, from.0, from.1)));
    let mut explored = 0u32;

    while let Some(Reverse((time, x, y))) = queue.pop() {
        let here = (x, y);
        if best.get(&here) != Some(&time) {
            continue;
        }
        if here == to {
            let mut waypoints = vec![to];
            let mut steps = Vec::new();
            let mut step_times = Vec::new();
            let mut cursor = to;
            while cursor != from {
                let (before, heading, used) = previous[&cursor];
                steps.push(heading);
                step_times.push(used);
                waypoints.push(before);
                cursor = before;
            }
            waypoints.reverse();
            steps.reverse();
            step_times.reverse();
            return Ok(Some(Route {
                waypoints,
                steps,
                step_times,
                time,
                explored,
            }));
        }
        explored += 1;

        let flow = chart.current_at(here);
        for (heading, dx, dy, distance) in MOVES {
            let nx = x as i32 + dx;
            let ny = y as i32 + dy;
            if nx < 0 || ny < 0 || nx >= chart.width as i32 || ny >= chart.height as i32 {
                continue;
            }
            let next = (nx as u32, ny as u32);
            if chart.is_land(next) {
                continue;
            }
            let step_time = time_for_move(distance, chart.wind, flow, dx, dy);
            let candidate = time + step_time;
            if candidate < best.get(&next).copied().unwrap_or(u64::MAX) {
                best.insert(next, candidate);
                previous.insert(next, (here, heading, step_time));
                queue.push(Reverse((candidate, next.0, next.1)));
            }
        }
    }
    Ok(None)
}

/// Integer time for one move: distance scaled by wind and current alignment.
fn time_for_move(distance: u64, wind: Vec2, current: Vec2, dx: i32, dy: i32) -> u64 {
    let wind_push = i32::from(wind.dx) * dx + i32::from(wind.dy) * dy;
    let current_push = i32::from(current.dx) * dx + i32::from(current.dy) * dy;
    let speed = (10 + 2 * wind_push + 2 * current_push).max(1) as u64;
    distance * 100 / speed
}

/// Renders the chart with the route marked: `S` start, `G` goal, `o` route,
/// `#` land and `~` open water.
pub fn render_ascii(chart: &Chart, from: (u32, u32), to: (u32, u32), route: Option<&Route>) -> String {
    let on_route: Vec<(u32, u32)> = route
        .map(|route| {
            route
                .waypoints
                .iter()
                .copied()
                .filter(|point| *point != from && *point != to)
                .collect()
        })
        .unwrap_or_default();
    let mut map = String::new();
    for y in 0..chart.height {
        for x in 0..chart.width {
            let point = (x, y);
            let glyph = if point == from {
                'S'
            } else if point == to {
                'G'
            } else if on_route.contains(&point) {
                'o'
            } else if chart.is_land(point) {
                '#'
            } else {
                '~'
            };
            map.push(glyph);
        }
        if y + 1 < chart.height {
            map.push('\n');
        }
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chart::parse;

    fn chart(body: &str) -> Chart {
        parse(&format!("TRIREME-CHART v1\n{body}")).unwrap()
    }

    #[test]
    fn straight_route_in_still_water() {
        let sea = chart("grid 5 1\nwind 0 0\n");
        let route = find_route(&sea, (0, 0), (4, 0)).unwrap().unwrap();
        assert_eq!(route.steps, vec!["E", "E", "E", "E"]);
        assert_eq!(route.waypoints.len(), 5);
        assert_eq!(route.time, 4 * 10 * 100 / 10);
        assert_eq!(route.step_times, vec![100, 100, 100, 100]);
        assert_eq!(route.step_times.iter().sum::<u64>(), route.time);
    }

    #[test]
    fn per_step_times_follow_wind_and_sum_to_total() {
        let sea = chart("grid 4 1\nwind 1 0\n");
        let route = find_route(&sea, (0, 0), (3, 0)).unwrap().unwrap();
        assert_eq!(route.step_times.len(), route.steps.len());
        assert_eq!(route.step_times.iter().sum::<u64>(), route.time);
        assert!(route.step_times.iter().all(|time| *time < 100));
    }

    #[test]
    fn land_forces_a_detour_and_can_block_completely() {
        let sea = chart("grid 3 3\nwind 0 0\nland 1 0\nland 1 1\nland 1 2\n");
        assert!(find_route(&sea, (0, 1), (2, 1)).unwrap().is_none());
        let partial = chart("grid 3 3\nwind 0 0\nland 1 1\n");
        let route = find_route(&partial, (0, 1), (2, 1)).unwrap().unwrap();
        assert!(!route.waypoints.contains(&(1, 1)));
        assert!(route.steps.len() >= 2);
    }

    #[test]
    fn wind_and_current_change_the_cost() {
        let calm = chart("grid 3 1\nwind 0 0\n");
        let tail = chart("grid 3 1\nwind 1 0\n");
        let head = chart("grid 3 1\nwind -1 0\n");
        let pushed = chart("grid 3 1\nwind 0 0\ncurrent 0 0 1 0\ncurrent 1 0 1 0\n");
        let base = find_route(&calm, (0, 0), (2, 0)).unwrap().unwrap().time;
        assert!(find_route(&tail, (0, 0), (2, 0)).unwrap().unwrap().time < base);
        assert!(find_route(&head, (0, 0), (2, 0)).unwrap().unwrap().time > base);
        assert!(find_route(&pushed, (0, 0), (2, 0)).unwrap().unwrap().time < base);
    }

    #[test]
    fn routing_is_deterministic_and_ties_break_on_coordinates() {
        let sea = chart("grid 5 5\nwind 0 0\n");
        let first = find_route(&sea, (0, 0), (4, 4)).unwrap().unwrap();
        let second = find_route(&sea, (0, 0), (4, 4)).unwrap().unwrap();
        assert_eq!(first, second);
        assert_eq!(first.steps[0], "SE");
    }

    #[test]
    fn same_cell_and_bad_points_are_handled() {
        let sea = chart("grid 2 2\nwind 0 0\n");
        let here = find_route(&sea, (1, 1), (1, 1)).unwrap().unwrap();
        assert!(here.steps.is_empty());
        assert_eq!(here.time, 0);
        assert!(find_route(&sea, (9, 9), (0, 0)).is_err());
    }

    #[test]
    fn ascii_map_marks_every_kind_of_cell() {
        let sea = chart("grid 3 2\nwind 0 0\nland 2 0\n");
        let route = find_route(&sea, (0, 0), (1, 0)).unwrap().unwrap();
        assert_eq!(render_ascii(&sea, (0, 0), (1, 0), Some(&route)), "SG#\n~~~");
    }
}
