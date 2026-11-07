#!/usr/bin/env bash
# Runs ON the Mac. Owns the lane Simulators, which are named `ks-maestro-lane-<k>` and nothing else is touched.
#   laneHost.sh ensure <k>      print the UDID of lane k's Simulator, creating it when none carries the name
#   laneHost.sh boot <udid>     boot and wait until it is usable
#   laneHost.sh erase <udid>    shut down and erase (a clean app state for the next run)
#   laneHost.sh install <udid> <app>
#   laneHost.sh facts           cpu count, memory bytes, load average and vm_stat, for the lane planner
#   laneHost.sh cleanup         delete every lane Simulator
# KS_SIM_DEVICE_TYPE and KS_SIM_RUNTIME choose what `ensure` creates.
set -euo pipefail

DEVICE_TYPE="${KS_SIM_DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-17}"
RUNTIME="${KS_SIM_RUNTIME:-com.apple.CoreSimulator.SimRuntime.iOS-26-5}"
NAME_PREFIX='ks-maestro-lane-'

die() {
    echo "laneHost: $*" >&2
    exit 1
}

# udid_by_name <name>   prints the UDID, or nothing
udid_by_name() {
    xcrun simctl list -j devices | jq -r --arg n "$1" '[.devices[][] | select(.name == $n) | .udid] | first // empty'
}

case "${1:-}" in
    ensure)
        [[ "${2:-}" =~ ^[1-9][0-9]*$ ]] || die "ensure needs a positive lane number, got '${2:-}'"
        name="${NAME_PREFIX}$2"
        udid="$(udid_by_name "$name")"
        [ -n "$udid" ] || udid="$(xcrun simctl create "$name" "$DEVICE_TYPE" "$RUNTIME")"
        echo "$udid"
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
        xcrun simctl install "${2:?udid}" "${3:?app}"
        ;;
    facts)
        echo "ncpu $(sysctl -n hw.ncpu)"
        echo "memsize $(sysctl -n hw.memsize)"
        echo "loadavg $(sysctl -n vm.loadavg)"
        vm_stat
        ;;
    cleanup)
        xcrun simctl list -j devices |
            jq -r --arg p "$NAME_PREFIX" '.devices[][] | select(.name | startswith($p)) | .udid' |
            while read -r udid; do
                xcrun simctl shutdown "$udid" || true
                xcrun simctl delete "$udid"
            done
        ;;
    *)
        die "unknown command '${1:-}'"
        ;;
esac
