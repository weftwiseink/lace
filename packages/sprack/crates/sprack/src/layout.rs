//! Responsive layout tiers and breakpoint logic.
//!
//! The TUI adapts to viewport width using four layout tiers.
//! The tier is determined by `area.width` at render time: no persistent layout state.

use ratatui::layout::{Constraint, Layout, Rect};

/// Responsive layout tier based on terminal width.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayoutTier {
    /// <30 cols: single-char status icons, truncated names.
    Compact,
    /// 30-59 cols: tree with short labels, inline status badges.
    Standard,
    /// 60-99 cols: tree + detail column showing process summary.
    Wide,
    /// 100+ cols: tree + expanded detail with full integration info.
    Full,
}

/// Determines the layout tier from terminal width.
pub fn layout_tier(width: u16) -> LayoutTier {
    match width {
        0..30 => LayoutTier::Compact,
        30..60 => LayoutTier::Standard,
        60..100 => LayoutTier::Wide,
        _ => LayoutTier::Full,
    }
}

/// Splits the body area into tree and optional detail panel.
///
/// Compact, Standard, and Wide tiers use the full area for the tree.
/// Inline summaries at Wide tier make a separate detail pane unnecessary.
/// Full tier splits horizontally: tree (min 40 cols) + detail (fill) for
/// supplemental debugging metadata.
pub fn body_layout(area: Rect, tier: LayoutTier) -> (Rect, Option<Rect>) {
    match tier {
        LayoutTier::Compact | LayoutTier::Standard | LayoutTier::Wide => (area, None),
        LayoutTier::Full => {
            let [tree, detail] =
                Layout::horizontal([Constraint::Min(40), Constraint::Fill(1)]).areas(area);
            (tree, Some(detail))
        }
    }
}

/// Splits the full terminal area into header, body, and status bar.
pub fn frame_layout(area: Rect) -> (Rect, Rect) {
    let [body, status_bar] =
        Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).areas(area);
    (body, status_bar)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_layout_tier_compact_below_30() {
        assert_eq!(layout_tier(0), LayoutTier::Compact);
        assert_eq!(layout_tier(10), LayoutTier::Compact);
        assert_eq!(layout_tier(29), LayoutTier::Compact);
    }

    #[test]
    fn test_layout_tier_standard_30_to_59() {
        assert_eq!(layout_tier(30), LayoutTier::Standard);
        assert_eq!(layout_tier(45), LayoutTier::Standard);
        assert_eq!(layout_tier(59), LayoutTier::Standard);
    }

    #[test]
    fn test_layout_tier_wide_60_to_99() {
        assert_eq!(layout_tier(60), LayoutTier::Wide);
        assert_eq!(layout_tier(80), LayoutTier::Wide);
        assert_eq!(layout_tier(99), LayoutTier::Wide);
    }

    #[test]
    fn test_layout_tier_full_100_plus() {
        assert_eq!(layout_tier(100), LayoutTier::Full);
        assert_eq!(layout_tier(500), LayoutTier::Full);
    }

    #[test]
    fn test_body_layout_compact_no_detail() {
        let area = Rect::new(0, 0, 25, 20);
        let (tree, detail) = body_layout(area, LayoutTier::Compact);
        assert_eq!(tree, area);
        assert!(detail.is_none());
    }

    #[test]
    fn test_body_layout_standard_no_detail() {
        let area = Rect::new(0, 0, 50, 20);
        let (tree, detail) = body_layout(area, LayoutTier::Standard);
        assert_eq!(tree, area);
        assert!(detail.is_none());
    }

    #[test]
    fn test_body_layout_wide_no_detail() {
        let area = Rect::new(0, 0, 80, 20);
        let (tree, detail) = body_layout(area, LayoutTier::Wide);
        assert_eq!(tree, area);
        assert!(detail.is_none());
    }

    #[test]
    fn test_body_layout_full_has_detail() {
        let area = Rect::new(0, 0, 120, 20);
        let (tree, detail) = body_layout(area, LayoutTier::Full);
        assert!(tree.width >= 40);
        assert!(detail.is_some());
    }
}
