//! Trireme: deterministic, content-addressed directory manifests.
//!
//! The library exposes the same three operations as the binary — hashing,
//! manifest I/O and verification — so other tools can drive it without spawning
//! a process.

pub mod cli;
pub mod manifest;
pub mod sha256;
