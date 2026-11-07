#!/usr/bin/env bash
# Stands in for `xcrun` on the WSL runner and runs the real one on the Mac, over the lane's ssh config.
# Every argument is shell-escaped with `printf %q`, so a value with spaces or quotes reaches the Mac whole.
#   KS_MAC_HOST         ssh host (name or user@address)
#   KS_MAC_SSH_CONFIG   ssh config file with the run's ControlMaster settings (`ssh -F`)
set -euo pipefail
: "${KS_MAC_HOST:?KS_MAC_HOST is not set; the Mac to drive is never guessed}"
: "${KS_MAC_SSH_CONFIG:?KS_MAC_SSH_CONFIG is not set}"
exec ssh -F "$KS_MAC_SSH_CONFIG" "$KS_MAC_HOST" "xcrun $(printf '%q ' "$@")"
