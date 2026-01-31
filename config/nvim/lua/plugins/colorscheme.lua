-- Solarized colorscheme (matching mjr's preference)
return {
  {
    "maxmx03/solarized.nvim",
    lazy = false,
    priority = 1000,
    opts = {
      transparent = { enabled = false },
      styles = {
        comments = { italic = true },
        keywords = { bold = true },
      },
    },
    config = function(_, opts)
      require("solarized").setup(opts)
      vim.o.background = "dark"

      -- Git highlighting for neo-tree and gitsigns (solarized colors)
      local hl = vim.api.nvim_set_hl
      -- Neo-tree git status colors
      hl(0, "NeoTreeGitAdded", { fg = "#859900" })      -- solarized green
      hl(0, "NeoTreeGitModified", { fg = "#b58900" })   -- solarized yellow
      hl(0, "NeoTreeGitUntracked", { fg = "#93a1a1" })  -- solarized base1
      hl(0, "NeoTreeGitDeleted", { fg = "#dc322f" })    -- solarized red
      -- Gitsigns line number colors (when numhl enabled)
      hl(0, "GitSignsAddNr", { fg = "#859900" })
      hl(0, "GitSignsChangeNr", { fg = "#b58900" })
      hl(0, "GitSignsDeleteNr", { fg = "#dc322f" })
    end,
  },
}
