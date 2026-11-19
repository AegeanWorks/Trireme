//! Trireme: an offline sailing route planner for small, human-readable sea charts.
//!
//! The library exposes chart parsing, deterministic shortest-time routing and
//! an ASCII renderer, so other tools can drive it without spawning a process.

pub mod chart;
pub mod cli;
pub mod router;
