#!/usr/bin/env bash
# Runs ON the Mac. Owns the Android lane emulators there (ADR-0088 §5): nested emulators crash Windows, so Android lanes boot
# on the Mac and WSL only drives them over ssh. Every value is validated here before it reaches a command.
#
#   androidLaneHost.sh doctor <image>                      the SDK tools and the system image are present
#   androidLaneHost.sh ensure-avd <name> <image> [K=V...]  create the AVD once, then set each K=V in its config.ini
#   androidLaneHost.sh reap <name>                         kill an earlier run's emulators of this AVD (by pid file)
#   androidLaneHost.sh boot <name> <port>                  start a cold, read-only, windowless emulator; returns at once
#   androidLaneHost.sh install <serial> <apk>              adb install -r -t
#   androidLaneHost.sh reverse <serial> <dev:host>...      adb reverse tcp:dev tcp:host for each pair
#   androidLaneHost.sh stop <port>                         ask the emulator to quit, then make sure it did
# KS_ANDROID_ENV (default ~/ksAndroid/env.sh) puts the SDK and JDK on PATH. KS_ANDROID_GPU picks the emulator -gpu mode
# (default host: on the Mac, 25 Settings launches plus swipes used 15.8 CPU seconds with host and 57.5 with
# swiftshader_indirect, both booting in about 19 s; see ADR-0088 §5).
set -euo pipefail

ENV_FILE="${KS_ANDROID_ENV:-$HOME/ksAndroid/env.sh}"
if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    . "$ENV_FILE"
fi
LANES_DIR="$HOME/ksAndroid/lanes"
AVD_HOME="${ANDROID_AVD_HOME:-$HOME/ksAndroid/avd}"

die() {
    echo "androidLaneHost: $*" >&2
    exit 1
}

need() {
    [[ "$2" =~ $3 ]] || die "$1 '$2' is not allowed"
}

PLAIN='^[A-Za-z0-9._-]+$'
IMAGE_RE='^system-images;android-[0-9]+;[a-z_]+;[a-z0-9-]+$'
SERIAL_RE='^emulator-[0-9]{4}$'
APK_RE='^[A-Za-z0-9._/@%+=:,-]+\.apk$'
SETTING_RE='^[A-Za-z0-9._]+=[A-Za-z0-9._ /-]*$'

# port <n>: an emulator console port is even, in 5554..5680
port() {
    [[ "$1" =~ ^[0-9]{4}$ ]] || die "emulator port '$1' is not allowed"
    [ "$1" -ge 5554 ] && [ "$1" -le 5680 ] && [ $(($1 % 2)) -eq 0 ] || die "emulator port '$1' is not an even port in 5554..5680"
}

alive() { kill -0 "$1" 2>/dev/null; }

# stop_pid <pid>: TERM, then KILL after ten seconds
stop_pid() {
    local pid="$1" waited=0
    alive "$pid" || return 0
    kill -TERM "$pid" 2>/dev/null || true
    while alive "$pid" && [ "$waited" -lt 10 ]; do
        sleep 1
        waited=$((waited + 1))
    done
    ! alive "$pid" || kill -KILL "$pid" 2>/dev/null || true
}

case "${1:-}" in
    doctor)
        image="${2:?image}"
        need 'system image' "$image" "$IMAGE_RE"
        missing=()
        sdk="${ANDROID_HOME:?ANDROID_HOME is not set}"
        for dir in emulator platform-tools cmdline-tools/latest/bin "${image//;//}"; do
            [ -d "$sdk/$dir" ] || missing+=("$sdk/$dir")
        done
        for tool in adb emulator avdmanager; do
            command -v "$tool" >/dev/null 2>&1 || missing+=("$tool on PATH")
        done
        [ "${#missing[@]}" -eq 0 ] || die "the Android SDK is incomplete (system image $image): ${missing[*]}"
        ;;
    ensure-avd)
        name="${2:?name}" image="${3:?image}"
        shift 3
        need 'AVD name' "$name" "$PLAIN"
        need 'system image' "$image" "$IMAGE_RE"
        for setting in "$@"; do
            need 'AVD setting' "$setting" "$SETTING_RE"
        done
        config="$AVD_HOME/$name.avd/config.ini"
        if [ ! -f "$config" ]; then
            echo no | avdmanager create avd -n "$name" -k "$image" -d pixel_6 --force
        fi
        for setting in "$@"; do
            key="${setting%%=*}"
            # drop any existing line for the key (avdmanager writes `key=value`, hand-made files `key = value`), then set it
            grep -v -E "^${key//./\\.}[[:space:]]*=" "$config" >"$config.new" || true
            printf '%s\n' "$setting" >>"$config.new"
            mv "$config.new" "$config"
        done
        ;;
    reap)
        name="${2:?name}"
        need 'AVD name' "$name" "$PLAIN"
        mkdir -p "$LANES_DIR"
        for pidfile in "$LANES_DIR"/emulator-*.pid; do
            [ -f "$pidfile" ] || continue
            pid="$(cat "$pidfile")"
            # a recycled pid is somebody else's process: only an emulator of THIS AVD is ours to kill
            if [[ "$pid" =~ ^[0-9]+$ ]] && ps -p "$pid" -o args= 2>/dev/null | grep -q -F -- "-avd $name"; then
                stop_pid "$pid"
            fi
            rm -f "$pidfile"
        done
        ;;
    boot)
        name="${2:?name}" emu_port="${3:?port}"
        need 'AVD name' "$name" "$PLAIN"
        port "$emu_port"
        mkdir -p "$LANES_DIR"
        nohup emulator -avd "$name" -port "$emu_port" -no-window -no-audio -no-boot-anim -no-snapshot -read-only \
            -gpu "${KS_ANDROID_GPU:-host}" >"$LANES_DIR/emulator-$emu_port.log" 2>&1 &
        echo $! >"$LANES_DIR/emulator-$emu_port.pid"
        ;;
    install)
        need 'serial' "${2:?serial}" "$SERIAL_RE"
        need 'APK' "${3:?apk}" "$APK_RE"
        adb -s "$2" install -r -t "$3"
        ;;
    reverse)
        serial="${2:?serial}"
        need 'serial' "$serial" "$SERIAL_RE"
        shift 2
        for pair in "$@"; do
            need 'port pair' "$pair" '^[0-9]+:[0-9]+$'
            adb -s "$serial" reverse "tcp:${pair%%:*}" "tcp:${pair##*:}"
        done
        ;;
    stop)
        emu_port="${2:?port}"
        port "$emu_port"
        adb -s "emulator-$emu_port" emu kill >/dev/null 2>&1 || true
        pidfile="$LANES_DIR/emulator-$emu_port.pid"
        if [ -f "$pidfile" ]; then
            pid="$(cat "$pidfile")"
            [[ "$pid" =~ ^[0-9]+$ ]] && stop_pid "$pid"
            rm -f "$pidfile"
        fi
        ;;
    *)
        die "unknown command '${1:-}'"
        ;;
esac
