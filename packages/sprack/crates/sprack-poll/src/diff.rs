//! Hash-based change detection for tmux state.
//!
//! Uses `std::hash::DefaultHasher` to detect whether raw tmux output
//! or lace metadata has changed between poll cycles. The hash is only
//! for change detection, not security.

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};

use crate::tmux::{LaceMeta, TmuxSnapshot};

/// Computes a 64-bit hash of a string for change detection.
#[cfg(test)]
fn compute_hash(data: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    data.hash(&mut hasher);
    hasher.finish()
}

/// Computes a 64-bit hash of a `TmuxSnapshot` for change detection.
///
/// Uses the derived `Hash` impl on the snapshot struct hierarchy, so changes
/// to any field in any session/window/pane produce a different hash.
pub fn compute_snapshot_hash(snapshot: &TmuxSnapshot) -> u64 {
    let mut hasher = DefaultHasher::new();
    snapshot.hash(&mut hasher);
    hasher.finish()
}

/// Computes a hash over the lace metadata map for change detection.
///
/// Sorts keys to ensure deterministic ordering regardless of HashMap iteration order.
pub fn compute_lace_meta_hash(lace_meta: &HashMap<String, LaceMeta>) -> u64 {
    let mut hasher = DefaultHasher::new();
    let mut sorted_keys: Vec<&String> = lace_meta.keys().collect();
    sorted_keys.sort();
    for key in sorted_keys {
        key.hash(&mut hasher);
        let meta = &lace_meta[key];
        meta.container.hash(&mut hasher);
        meta.user.hash(&mut hasher);
        meta.workspace.hash(&mut hasher);
    }
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_diff_detects_change() {
        let output_a = "session1||1||0||main||1||%0||title||bash||/home||1234||1||0";
        let output_b = "session1||1||0||main||1||%0||title||nvim||/home||1234||1||0";
        let hash_a = compute_hash(output_a);
        let hash_b = compute_hash(output_b);
        assert_ne!(hash_a, hash_b);
    }

    #[test]
    fn test_hash_diff_detects_no_change() {
        let output = "session1||1||0||main||1||%0||title||bash||/home||1234||1||0";
        let hash_a = compute_hash(output);
        let hash_b = compute_hash(output);
        assert_eq!(hash_a, hash_b);
    }

    #[test]
    fn test_hash_diff_whitespace_sensitive() {
        let output_without_newline = "session1||1||0||main||1||%0||title||bash||/home||1234||1||0";
        let output_with_newline = "session1||1||0||main||1||%0||title||bash||/home||1234||1||0\n";
        let hash_a = compute_hash(output_without_newline);
        let hash_b = compute_hash(output_with_newline);
        assert_ne!(hash_a, hash_b);
    }

    #[test]
    fn test_lace_meta_hash_detects_change() {
        let mut meta_a = HashMap::new();
        meta_a.insert(
            "dev".to_string(),
            LaceMeta {
                port: Some(2222),
                user: Some("node".to_string()),
                workspace: Some("/workspace".to_string()),
            },
        );

        let mut meta_b = HashMap::new();
        meta_b.insert(
            "dev".to_string(),
            LaceMeta {
                port: Some(3333),
                user: Some("node".to_string()),
                workspace: Some("/workspace".to_string()),
            },
        );

        assert_ne!(
            compute_lace_meta_hash(&meta_a),
            compute_lace_meta_hash(&meta_b)
        );
    }

    #[test]
    fn test_lace_meta_hash_detects_no_change() {
        let mut meta_a = HashMap::new();
        meta_a.insert(
            "dev".to_string(),
            LaceMeta {
                port: Some(2222),
                user: Some("node".to_string()),
                workspace: Some("/workspace".to_string()),
            },
        );

        let mut meta_b = HashMap::new();
        meta_b.insert(
            "dev".to_string(),
            LaceMeta {
                port: Some(2222),
                user: Some("node".to_string()),
                workspace: Some("/workspace".to_string()),
            },
        );

        assert_eq!(
            compute_lace_meta_hash(&meta_a),
            compute_lace_meta_hash(&meta_b)
        );
    }
}
