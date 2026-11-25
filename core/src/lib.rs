//! Lingonberry Router core: cross-platform agent orchestration engine.
//!
//! Discovery -> dynamic worker registry -> dispatch -> verify -> receipts.
//! All workers, keys, and providers are discovered at runtime; nothing is hard-coded.

pub mod agents;
pub mod discovery;
pub mod registry;
pub mod server;
pub mod storage;
pub mod types;
