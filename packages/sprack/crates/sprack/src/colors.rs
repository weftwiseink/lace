//! Catppuccin color conversion helpers.
//!
//! Bridges catppuccin v2 colors to ratatui v0.29 colors via RGB values.
//! The catppuccin crate's `From` impl targets `ratatui-core` v0.1 which is
//! incompatible with our ratatui version, so we convert manually.

use ratatui::style::Color;

/// Converts a catppuccin color to a ratatui color via its RGB components.
pub fn cat_color(color: catppuccin::Color) -> Color {
    let rgb = color.rgb;
    Color::Rgb(rgb.r, rgb.g, rgb.b)
}
