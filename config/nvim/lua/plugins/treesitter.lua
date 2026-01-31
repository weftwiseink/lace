-- Treesitter: syntax highlighting and more
-- nvim-treesitter was rewritten in 2025 - this uses the new main branch API
-- See: https://github.com/nvim-treesitter/nvim-treesitter
return {
  {
    "nvim-treesitter/nvim-treesitter",
    branch = "main",
    lazy = false,
    build = ":TSUpdate",
    config = function()
      require("nvim-treesitter").setup({})

      -- Install parsers (async)
      local parsers = {
        "typescript", "tsx", "javascript", "lua", "vim", "vimdoc",
        "html", "css", "json", "yaml", "markdown", "markdown_inline",
        "bash", "rust", "python",
      }
      vim.schedule(function()
        require("nvim-treesitter").install(parsers)
      end)

      -- Enable treesitter highlighting for all filetypes
      vim.api.nvim_create_autocmd("FileType", {
        callback = function()
          pcall(vim.treesitter.start)
        end,
      })

      -- Incremental selection (matching mjr's 's' for expand)
      vim.keymap.set("n", "s", function()
        require("nvim-treesitter.incremental_selection").init_selection()
      end, { desc = "Start incremental selection" })
      vim.keymap.set("x", "s", function()
        require("nvim-treesitter.incremental_selection").node_incremental()
      end, { desc = "Expand selection" })
      vim.keymap.set("x", "S", function()
        require("nvim-treesitter.incremental_selection").node_decremental()
      end, { desc = "Shrink selection" })
    end,
  },

  -- TODO: nvim-treesitter-textobjects needs API update for main branch
  -- Disabled until we verify the correct API
  -- {
  --   "nvim-treesitter/nvim-treesitter-textobjects",
  --   branch = "main",
  --   dependencies = { "nvim-treesitter/nvim-treesitter" },
  -- },
}
