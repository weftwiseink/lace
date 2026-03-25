# Default shell configuration step

if [ -n "$DEFAULT_SHELL" ]; then
    if [ -x "$DEFAULT_SHELL" ]; then
        chsh -s "$DEFAULT_SHELL" "$_REMOTE_USER" 2>/dev/null || {
            echo "WARNING: Could not set default shell to $DEFAULT_SHELL via chsh."
            echo "         Falling back to SHELL env var (set in containerEnv)."
        }
        echo "lace-fundamentals: Default shell set to $DEFAULT_SHELL for $_REMOTE_USER."
    else
        echo "lace-fundamentals: Shell $DEFAULT_SHELL not found or not executable."
        echo "         The shell feature may not have been installed yet."
        echo "         Ensure the shell feature is listed before lace-fundamentals in feature order,"
        echo "         or use installsAfter to control ordering."
    fi
fi
