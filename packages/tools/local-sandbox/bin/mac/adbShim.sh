#!/usr/bin/env bash
# Stands in for `adb` on the WSL runner and runs the real one on the Mac, where the emulators are. There is no remote adb
# server: Maestro's `adb forward` binds on the server's host, so everything that touches the device runs on the Mac.
# Every argument is shell-escaped with `printf %q`. The lane serial travels as the remote environment variable
# ANDROID_SERIAL (adb reads it natively), never as `-s`, so a command that names its own `-s` still wins.
# A terminal is allocated ONLY for a streaming logcat: killing the local reader then hangs up the Mac process, so no
# `adb logcat` is left running there. Every other call has no terminal.
#   KS_MAC_HOST, KS_MAC_SSH_CONFIG   as for xcrunShim.sh
#   KS_MAC_ANDROID_ENV               absolute Mac path of the file that puts the SDK on PATH (~/ksAndroid/env.sh)
#   ANDROID_SERIAL                   the lane's emulator serial, e.g. emulator-5560 (optional)
set -euo pipefail
: "${KS_MAC_HOST:?KS_MAC_HOST is not set; the Mac to drive is never guessed}"
: "${KS_MAC_SSH_CONFIG:?KS_MAC_SSH_CONFIG is not set}"
: "${KS_MAC_ANDROID_ENV:?KS_MAC_ANDROID_ENV is not set}"

if [[ -n "${ANDROID_SERIAL:-}" && ! "${ANDROID_SERIAL}" =~ ^emulator-[0-9]{4}$ ]]; then
    echo "adbShim: ANDROID_SERIAL '${ANDROID_SERIAL}' is not an emulator serial" >&2
    exit 1
fi

# A logcat that is not a one-shot (-d dump, -c clear, -g/-G size) streams until it is killed.
streaming=0
for arg in "$@"; do
    [ "$arg" = logcat ] && streaming=1
done
for arg in "$@"; do
    case "$arg" in -d | -c | -g | -G | -S | --clear) streaming=0 ;; esac
done

remote=". $(printf '%q' "$KS_MAC_ANDROID_ENV") && "
[ -z "${ANDROID_SERIAL:-}" ] || remote+="ANDROID_SERIAL=$(printf '%q' "$ANDROID_SERIAL") "
remote+="exec adb $(printf '%q ' "$@")"

tty=()
[ "$streaming" -eq 0 ] || tty=(-tt)
exec ssh -F "$KS_MAC_SSH_CONFIG" "${tty[@]}" "$KS_MAC_HOST" "$remote"
