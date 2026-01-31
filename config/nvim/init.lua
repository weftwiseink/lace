-- lace neovim config
-- Usage: NVIM_APPNAME=lace/config/nvim nvim
-- Or: XDG_CONFIG_HOME=/workspace/main/lace/config nvim

-- =============================================================================
-- Bootstrap lazy.nvim
-- =============================================================================

local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.uv.fs_stat(lazypath) then
  local out = vim.fn.system({
    "git", "clone", "--filter=blob:none", "--branch=stable",
    "https://github.com/folke/lazy.nvim.git", lazypath,
  })
  if vim.v.shell_error ~= 0 then
    error("Error cloning lazy.nvim:\n" .. out)
  end
end
vim.opt.rtp:prepend(lazypath)

-- =============================================================================
-- Core Settings (before plugins)
-- =============================================================================

-- Leader key (space is modern default)
vim.g.mapleader = " "
vim.g.maplocalleader = " "

-- Line numbers
vim.opt.number = true
vim.opt.relativenumber = true

-- Indentation (2 spaces default, matching mjr's CodeMode)
vim.opt.tabstop = 2
vim.opt.shiftwidth = 2
vim.opt.expandtab = true
vim.opt.smartindent = true

-- Search
vim.opt.ignorecase = true
vim.opt.smartcase = true
vim.opt.hlsearch = true
vim.opt.incsearch = true

-- UI
vim.opt.termguicolors = true
vim.opt.signcolumn = "yes"
vim.opt.cursorline = true
vim.opt.scrolloff = 8
vim.opt.sidescrolloff = 8

-- Splits (open right and below)
vim.opt.splitright = true
vim.opt.splitbelow = true

-- Persistence
vim.opt.undofile = true
vim.opt.swapfile = false

-- Clipboard (system clipboard integration)
vim.opt.clipboard = "unnamedplus"

-- Mouse
vim.opt.mouse = "a"

-- Faster updates
vim.opt.updatetime = 250
vim.opt.timeoutlen = 300

-- Whitespace visualization
vim.opt.list = true
vim.opt.listchars = { tab = "» ", trail = "·", nbsp = "␣" }

-- =============================================================================
-- Basic Keymaps (before plugins)
-- =============================================================================

local keymap = vim.keymap.set

-- Clear search highlight
keymap("n", "<Esc>", "<cmd>nohlsearch<CR>")

-- Window navigation: Ctrl+H/J/K/L (matches wezterm, tmux)
keymap("n", "<C-h>", "<C-w>h", { desc = "Move to left window" })
keymap("n", "<C-j>", "<C-w>j", { desc = "Move to lower window" })
keymap("n", "<C-k>", "<C-w>k", { desc = "Move to upper window" })
keymap("n", "<C-l>", "<C-w>l", { desc = "Move to right window" })

-- Buffer navigation: Ctrl+N/P (matching mjr's init.vim preference)
keymap("n", "<C-n>", "<cmd>bnext<CR>", { desc = "Next buffer" })
keymap("n", "<C-p>", "<cmd>bprevious<CR>", { desc = "Previous buffer" })

-- Close buffer without closing window
keymap("n", "<leader>bd", "<cmd>bdelete<CR>", { desc = "Delete buffer" })

-- Quick save
keymap("n", "<leader>w", "<cmd>w<CR>", { desc = "Save" })

-- Better indenting (stay in visual mode)
keymap("v", "<", "<gv")
keymap("v", ">", ">gv")

-- Move lines up/down
keymap("v", "J", ":m '>+1<CR>gv=gv", { desc = "Move line down" })
keymap("v", "K", ":m '<-2<CR>gv=gv", { desc = "Move line up" })

-- Keep cursor centered when scrolling
keymap("n", "<C-d>", "<C-d>zz")
keymap("n", "<C-u>", "<C-u>zz")

-- Yank whole file (matching mjr's yp)
keymap("n", "yp", ":%y+<CR>", { desc = "Yank entire file" })

-- =============================================================================
-- Plugin Specifications
-- =============================================================================

require("lazy").setup({
  spec = {
    { import = "plugins" },
  },
  defaults = {
    lazy = false,
    version = false,
  },
  install = { colorscheme = { "solarized", "habamax" } },
  checker = { enabled = false },
  performance = {
    rtp = {
      disabled_plugins = {
        "gzip", "tarPlugin", "tohtml", "tutor", "zipPlugin",
      },
    },
  },
})

-- =============================================================================
-- Colorscheme (after plugins load)
-- =============================================================================

vim.cmd.colorscheme("solarized")
