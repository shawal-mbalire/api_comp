//! Infra layer — external-environment plumbing.
//!
//! `config` is the ONLY place environment variables are read. The composition
//! root (src/main.rs) consumes the parsed config and wires everything up.

pub mod config;