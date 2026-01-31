-- LSP Configuration (neovim 0.11+ native vim.lsp.config API)
return {
  -- Mason: LSP server installer
  {
    "mason-org/mason.nvim",
    opts = {},
  },

  -- Mason-lspconfig: bridges mason and lspconfig
  {
    "mason-org/mason-lspconfig.nvim",
    dependencies = { "mason-org/mason.nvim" },
    opts = {
      ensure_installed = {
        "ts_ls",        -- TypeScript/JavaScript
        "lua_ls",       -- Lua
        "cssls",        -- CSS
        "html",         -- HTML
        "jsonls",       -- JSON
      },
    },
  },

  -- LSP configuration using native neovim 0.11+ API
  {
    "neovim/nvim-lspconfig",
    dependencies = {
      "mason-org/mason.nvim",
      "mason-org/mason-lspconfig.nvim",
    },
    config = function()
      -- Set up keymaps when LSP attaches to buffer
      vim.api.nvim_create_autocmd("LspAttach", {
        callback = function(args)
          local bufnr = args.buf
          local map = function(keys, func, desc)
            vim.keymap.set("n", keys, func, { buffer = bufnr, desc = "LSP: " .. desc })
          end

          -- Navigation
          map("gd", vim.lsp.buf.definition, "Go to definition")
          map("gD", vim.lsp.buf.declaration, "Go to declaration")
          map("gr", vim.lsp.buf.references, "Go to references")
          map("gi", vim.lsp.buf.implementation, "Go to implementation")
          map("gt", vim.lsp.buf.type_definition, "Go to type definition")

          -- Information
          map("K", vim.lsp.buf.hover, "Hover documentation")
          map("<C-k>", vim.lsp.buf.signature_help, "Signature help")

          -- Actions
          map("<leader>rn", vim.lsp.buf.rename, "Rename symbol")
          map("<leader>ca", vim.lsp.buf.code_action, "Code action")
          map("<leader>f", function() vim.lsp.buf.format({ async = true }) end, "Format buffer")

          -- Diagnostics (matching mjr's ge/gE pattern)
          map("ge", vim.diagnostic.goto_next, "Next diagnostic")
          map("gE", vim.diagnostic.goto_prev, "Previous diagnostic")
          map("<leader>e", vim.diagnostic.open_float, "Show diagnostic")
          map("<leader>q", vim.diagnostic.setloclist, "Diagnostic list")
        end,
      })

      -- Configure LSP servers using native vim.lsp.config (neovim 0.11+)
      vim.lsp.config.ts_ls = {
        settings = {
          typescript = {
            inlayHints = {
              includeInlayParameterNameHints = "all",
              includeInlayFunctionParameterTypeHints = true,
              includeInlayVariableTypeHints = true,
            },
          },
        },
      }

      vim.lsp.config.lua_ls = {
        settings = {
          Lua = {
            runtime = { version = "LuaJIT" },
            workspace = {
              checkThirdParty = false,
              library = { vim.env.VIMRUNTIME },
            },
            diagnostics = {
              globals = { "vim", "wezterm" },
            },
          },
        },
      }

      vim.lsp.config.cssls = {}
      vim.lsp.config.html = {}
      vim.lsp.config.jsonls = {}

      -- Enable all configured servers
      vim.lsp.enable({ "ts_ls", "lua_ls", "cssls", "html", "jsonls" })
    end,
  },

  -- Autocompletion
  {
    "hrsh7th/nvim-cmp",
    event = "InsertEnter",
    dependencies = {
      "hrsh7th/cmp-nvim-lsp",
      "hrsh7th/cmp-buffer",
      "hrsh7th/cmp-path",
      "L3MON4D3/LuaSnip",
      "saadparwaiz1/cmp_luasnip",
    },
    config = function()
      local cmp = require("cmp")
      local luasnip = require("luasnip")

      cmp.setup({
        snippet = {
          expand = function(args)
            luasnip.lsp_expand(args.body)
          end,
        },
        mapping = cmp.mapping.preset.insert({
          ["<C-n>"] = cmp.mapping.select_next_item(),
          ["<C-p>"] = cmp.mapping.select_prev_item(),
          -- NOTE: <C-Space> removed - now used for telescope file finder in normal mode
          -- Tab handles completion triggering (see below)
          ["<C-e>"] = cmp.mapping.abort(),
          ["<CR>"] = cmp.mapping.confirm({ select = true }),
          -- TODO(mjr/nvim-dx): Inserting a literal tab mid-line requires a different key with this setup.
          --   VSCode and other editors handle this gracefully (e.g., detecting "tab-like" contexts vs
          --   completion contexts). Research how they distinguish these cases - possibly by checking
          --   if cursor follows an identifier character vs whitespace/operators.
          ["<Tab>"] = cmp.mapping(function(fallback)
            if cmp.visible() then
              cmp.select_next_item()
            elseif luasnip.expand_or_jumpable() then
              luasnip.expand_or_jump()
            else
              local col = vim.fn.col(".") - 1
              if col == 0 or vim.fn.getline("."):sub(col, col):match("%s") then
                fallback() -- Insert actual tab at line start or after whitespace
              else
                cmp.complete() -- Trigger completion mid-identifier
              end
            end
          end, { "i", "s" }),
        }),
        sources = cmp.config.sources({
          { name = "nvim_lsp" },
          { name = "luasnip" },
        }, {
          { name = "buffer" },
          { name = "path" },
        }),
      })
    end,
  },
}
