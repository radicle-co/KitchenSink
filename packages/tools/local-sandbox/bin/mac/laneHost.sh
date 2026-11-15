#!/usr/bin/env bash
# Runs ON the Mac. Owns the lane Simulators, which are named `ks-maestro-lane-<k>` (iPhone) or `ks-maestro-ipad-<k>`
# (iPad) and nothing else is touched. A class is `iphone` (the default) or `ipad`; a run uses one class for every lane.
#   laneHost.sh ensure <k> [iphone|ipad]   print the UDID of lane k's Simulator, creating it when none carries the name
#   laneHost.sh udid <k> [iphone|ipad]     print lane k's Simulator UDID, or nothing when it does not exist (creates nothing)
#   laneHost.sh boot <udid>     boot and wait until it is usable
#   laneHost.sh erase <udid>    shut down and erase (a clean app state for the next run)
#   laneHost.sh install <udid> <dir>   install the one .app bundle inside <dir>
#   laneHost.sh facts           cpu count, memory bytes, load average and the kernel's free percentage, for the lane planner
#   laneHost.sh cleanup         delete every lane Simulator of both classes
# KS_SIM_DEVICE_TYPE (iPhone), KS_SIM_IPAD_DEVICE_TYPE (iPad) and KS_SIM_RUNTIME choose what `ensure` creates.
set -euo pipefail

IPHONE_DEVICE_TYPE="${KS_SIM_DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-17}"
# 820 pt wide (iPad Air 11-inch, M3), as `xcrun simctl list devicetypes` prints it on the Mac.
IPAD_DEVICE_TYPE="${KS_SIM_IPAD_DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPad-Air-11-inch-M3}"
RUNTIME="${KS_SIM_RUNTIME:-com.apple.CoreSimulator.SimRuntime.iOS-26-5}"

die() {
    echo "laneHost: $*" >&2
    exit 1
}

# class_of <class>   sets NAME_PREFIX and DEVICE_TYPE for a class; any other word dies (it reaches a Simulator name)
class_of() {
    case "$1" in
        iphone)
            NAME_PREFIX='ks-maestro-lane-'
            DEVICE_TYPE="$IPHONE_DEVICE_TYPE"
            ;;
        ipad)
            NAME_PREFIX='ks-maestro-ipad-'
            DEVICE_TYPE="$IPAD_DEVICE_TYPE"
            ;;
        *) die "device class must be iphone or ipad, got '$1'" ;;
    esac
}

# udid_by_name <name>   prints the UDID, or nothing
udid_by_name() {
    xcrun simctl list -j devices | jq -r --arg n "$1" '[.devices[][] | select(.name == $n) | .udid] | first // empty'
}

case "${1:-}" in
    ensure)
        [[ "${2:-}" =~ ^[1-9][0-9]*$ ]] || die "ensure needs a positive lane number, got '${2:-}'"
        class_of "${3-iphone}"
        name="${NAME_PREFIX}$2"
        udid="$(udid_by_name "$name")"
        [ -n "$udid" ] || udid="$(xcrun simctl create "$name" "$DEVICE_TYPE" "$RUNTIME")"
        echo "$udid"
        ;;
    udid)
        [[ "${2:-}" =~ ^[1-9][0-9]*$ ]] || die "udid needs a positive lane number, got '${2:-}'"
        class_of "${3-iphone}"
        udid_by_name "${NAME_PREFIX}$2"
        ;;
    boot)
        xcrun simctl boot "${2:?udid}" || true # already booted is fine
        xcrun simctl bootstatus "$2" -b
        ;;
    erase)
        xcrun simctl shutdown "${2:?udid}" || true
        xcrun simctl erase "$2"
        ;;
    install)
        app="$(find "${3:?dir}" -maxdepth 1 -name '*.app' -type d | head -2)"
        [ -n "$app" ] && [ "$(printf '%s\n' "$app" | wc -l)" -eq 1 ] || die "expected exactly one .app in $3, found: ${app:-none}"
        xcrun simctl install "${2:?udid}" "$app"
        ;;
    facts)
        echo "ncpu $(sysctl -n hw.ncpu)"
        echo "memsize $(sysctl -n hw.memsize)"
        echo "loadavg $(sysctl -n vm.loadavg)"
        # The kernel's own measure of what is free or reclaimable (cache included), as its own line: `parseFreePercent`
        # (e2e-plan) reads it, the one memory rule. No line means a failed read, and `set -e` stops here.
        memory_pressure | grep 'System-wide memory free percentage'
        ;;
    cleanup)
        xcrun simctl list -j devices |
            jq -r '.devices[][] | select(.name | test("^ks-maestro-(lane|ipad)-[1-9][0-9]*$")) | .udid' |
            while read -r udid; do
                xcrun simctl shutdown "$udid" || true
                xcrun simctl delete "$udid"
            done
        ;;
    *)
        die "unknown command '${1:-}'"
        ;;
esac
