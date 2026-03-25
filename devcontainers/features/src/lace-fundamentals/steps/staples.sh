# Core utilities (staples) step
# Ensures fundamental CLI tools are present regardless of base image.

echo "lace-fundamentals: Checking core utilities..."

# Detect package manager
if command -v apt-get >/dev/null 2>&1; then
    PKG_INSTALL="apt-get update && apt-get install -y --no-install-recommends"
    PKG_CLEANUP="rm -rf /var/lib/apt/lists/*"
elif command -v apk >/dev/null 2>&1; then
    PKG_INSTALL="apk add --no-cache"
    PKG_CLEANUP=":"
else
    echo "lace-fundamentals: WARNING: Unknown package manager, skipping staples."
    return 0 2>/dev/null || exit 0
fi

# Core utilities that should always be present.
# These are commonly assumed by scripts and developer workflows.
STAPLES="curl jq less"

MISSING=""
for tool in $STAPLES; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        MISSING="$MISSING $tool"
    fi
done

if [ -n "$MISSING" ]; then
    echo "lace-fundamentals: Installing missing staples:$MISSING"
    eval "$PKG_INSTALL $MISSING"
    eval "$PKG_CLEANUP"
else
    echo "lace-fundamentals: All core utilities present."
fi
