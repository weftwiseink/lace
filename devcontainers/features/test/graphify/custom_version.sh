#!/bin/bash
set -e

source dev-container-features-test-lib

check "graphify on PATH" command -v graphify
check "graphify --version reports the custom pin 0.9.60" bash -c 'graphify --version | grep -q "0.9.60"'

reportResults
