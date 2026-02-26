#!/bin/bash
set -e

source dev-container-features-test-lib

check "portless installed" command -v portless
check "portless version" portless --version
check "entrypoint exists" test -f /usr/local/share/portless-feature/entrypoint.sh
check "no PORTLESS_PORT baked in /etc/environment" bash -c '! grep -q PORTLESS_PORT /etc/environment 2>/dev/null'
check "no /etc/profile.d/portless-lace.sh" bash -c '! test -f /etc/profile.d/portless-lace.sh'

reportResults
