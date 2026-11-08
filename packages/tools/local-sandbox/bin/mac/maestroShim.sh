#!/usr/bin/env bash
# Stands in for `maestro` on the WSL runner and runs Maestro on the Mac, from the lane's own synced tree and HOME.
# Every argument is shell-escaped with `printf %q`. Only a flow path (an argument ending `.yaml` that sits under a
# `.maestro/` folder, and is not a KEY=value) is rewritten, to be relative to the Mac tree's `mobile/` folder. Nothing is read from a manifest
# here: the runner passes fixture values as `-e KEY=value` and they travel as arguments.
#   KS_MAC_HOST, KS_MAC_SSH_CONFIG   as for xcrunShim.sh
#   KS_MAC_TREE         absolute Mac path of the synced tree; it holds `mobile/.maestro`
#   KS_MAC_LANE_HOME    absolute Mac path of this lane's HOME (Maestro keeps its driver state there)
#   KS_MAC_JAVA_HOME    absolute Mac path of the JDK
#   KS_MAC_MAESTRO_BIN  absolute Mac path of the `maestro` executable
#   KS_MAC_ANDROID_HOME optional, absolute Mac path of the Android SDK (an Android lane): Maestro there then finds adb
set -euo pipefail
: "${KS_MAC_HOST:?KS_MAC_HOST is not set; the Mac to drive is never guessed}"
: "${KS_MAC_SSH_CONFIG:?KS_MAC_SSH_CONFIG is not set}"
: "${KS_MAC_TREE:?KS_MAC_TREE is not set}"
: "${KS_MAC_LANE_HOME:?KS_MAC_LANE_HOME is not set; lanes must not share a Maestro HOME}"
: "${KS_MAC_JAVA_HOME:?KS_MAC_JAVA_HOME is not set}"
: "${KS_MAC_MAESTRO_BIN:?KS_MAC_MAESTRO_BIN is not set}"

if [ -n "${KS_MAC_ANDROID_HOME:-}" ] && [[ ! "$KS_MAC_ANDROID_HOME" =~ ^[A-Za-z0-9._/@%+=:,-]+$ ]]; then
    echo "maestroShim: KS_MAC_ANDROID_HOME '$KS_MAC_ANDROID_HOME' is not a plain path" >&2
    exit 1
fi

args=()
for arg in "$@"; do
    case "$arg" in
        *.yaml)
            if [[ "$arg" == *"/.maestro/"* && "$arg" != *=* ]]; then
                arg=".maestro/${arg##*/.maestro/}"
            fi
            ;;
    esac
    args+=("$arg")
done

remote="cd $(printf '%q' "$KS_MAC_TREE/mobile") && "
if [ -n "${KS_MAC_ANDROID_HOME:-}" ]; then
    sdk="$(printf '%q' "$KS_MAC_ANDROID_HOME")"
    remote+="export ANDROID_HOME=$sdk ANDROID_SDK_ROOT=$sdk PATH=$(printf '%q' "$KS_MAC_ANDROID_HOME/platform-tools"):\"\$PATH\" && "
fi
remote+="exec env"
remote+=" HOME=$(printf '%q' "$KS_MAC_LANE_HOME") MAESTRO_OPTS=$(printf '%q' "-Duser.home=$KS_MAC_LANE_HOME")"
remote+=" JAVA_HOME=$(printf '%q' "$KS_MAC_JAVA_HOME") MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_DRIVER_STARTUP_TIMEOUT=300000"
remote+=" $(printf '%q' "$KS_MAC_MAESTRO_BIN") $(printf '%q ' "${args[@]}")"
exec ssh -F "$KS_MAC_SSH_CONFIG" "$KS_MAC_HOST" "$remote"
