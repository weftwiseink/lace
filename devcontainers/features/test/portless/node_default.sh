#!/bin/bash
set -e

source dev-container-features-test-lib

check "portless installed" command -v portless
check "portless version is non-empty" bash -c 'portless --version | grep -q .'
check "entrypoint is executable" test -x /usr/local/share/portless-feature/entrypoint.sh

reportResults
