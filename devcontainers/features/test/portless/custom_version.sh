#!/bin/bash
set -e

source dev-container-features-test-lib

check "portless installed" command -v portless
check "portless version is 0.4.2" bash -c 'portless --version | grep -q "0.4.2"'

reportResults
