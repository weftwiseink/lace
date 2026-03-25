# Chezmoi installation step

echo "lace-fundamentals: Installing chezmoi..."
if command -v chezmoi >/dev/null 2>&1; then
    echo "lace-fundamentals: chezmoi already installed, skipping."
else
    sh -c "$(curl -fsLS get.chezmoi.io)" -- -b /usr/local/bin
    echo "lace-fundamentals: chezmoi installed at $(chezmoi --version)."
fi
