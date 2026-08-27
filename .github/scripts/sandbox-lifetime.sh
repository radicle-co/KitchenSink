#!/usr/bin/env bash
#
# The on-demand sandbox's expiry clock.
#
# ⚠️  DELIBERATE — a sandbox started from the GitHub button is torn down at midnight
# America/New_York of the day it was started. The expiry is computed ONCE, here, at start, and stamped on
# every `pr-{N}` stack as an absolute `SandboxExpiresAt` epoch. The hourly reconciler then only ever asks
# "is now past this number". It never repeats this arithmetic, so it cannot disagree with the workflow that
# created the environment — the same reason `pr-scope.sh` owns exactly one copy of the pr-{N} matcher.
#
# ## Why `TZ=` and not a fixed offset
#
# America/New_York is UTC-4 for eight months a year and UTC-5 for the other four. `midnight_utc - 4h` is
# wrong in both directions across the two changeovers — a week of sandboxes dying an hour early each
# November, an hour late each March. Delegating to the tz database is the only version that does not need
# maintaining. `sandboxLifetime.test.ts` asserts both 2026 transitions.
#
# ## Why a minimum lifetime
#
# "Midnight of the day created", read literally, hands someone who presses the button at 23:50 a ten-minute
# environment — less time than the deploy that builds it. Under SANDBOX_MIN_LIFETIME_SECONDS the expiry
# rolls to the FOLLOWING midnight. That is a rule about how long a preview is useful, not a rounding
# convenience.
#
# Requires GNU coreutils `date` (the runners are ubuntu-latest; BSD/macOS `date` will not parse `@epoch`).
#
#   sandbox-lifetime.sh expires-at <startedEpoch>
#   sandbox-lifetime.sh is-expired <expiresAtEpoch> <nowEpoch>
#
# Exit status: 0 = a verdict was printed, 2 = misuse (never treat as "not expired").
set -uo pipefail

# The timezone the midnight boundary is measured in.
SANDBOX_TZ="${SANDBOX_TZ:-America/New_York}"

# Shortest useful preview life. Below this, expiry rolls to the next midnight.
SANDBOX_MIN_LIFETIME_SECONDS="${SANDBOX_MIN_LIFETIME_SECONDS:-7200}"

# sandbox_lifetime_is_epoch <value>
#
# True iff <value> is a non-negative integer. Pure.
sandbox_lifetime_is_epoch() {
    [[ ${1-} =~ ^[0-9]+$ ]]
}

# sandbox_lifetime_midnight_after <epoch> <daysAhead>
#
# Epoch of midnight in SANDBOX_TZ, <daysAhead> calendar days after the local day containing <epoch>.
#
# The calendar step runs on a BARE date with `date -u`, deliberately: adding "+1 day" to a string that
# already carries a time is parsed by GNU date as a UTC OFFSET, not a relative day. Stepping the calendar
# first and interpreting midnight second keeps the two operations from colliding.
sandbox_lifetime_midnight_after() {
    local epoch="$1" days="$2" day target
    day=$(TZ="$SANDBOX_TZ" date -d "@${epoch}" +%Y-%m-%d) || return 1
    target=$(date -u -d "${day} +${days} days" +%Y-%m-%d) || return 1
    TZ="$SANDBOX_TZ" date -d "${target} 00:00:00" +%s
}

# sandbox_lifetime_expires_at <startedEpoch>
#
# Prints `expiresAt=<epoch>` and `expiresAtIso=<UTC ISO>`. Pure apart from reading the tz database.
sandbox_lifetime_expires_at() {
    local started="${1-}" expiry

    if ! sandbox_lifetime_is_epoch "$started"; then
        echo "sandbox-lifetime: <startedEpoch> must be a non-negative integer, got '${started}'" >&2
        return 2
    fi

    expiry=$(sandbox_lifetime_midnight_after "$started" 1) || {
        echo "sandbox-lifetime: could not resolve midnight in ${SANDBOX_TZ}" >&2
        return 2
    }

    if [ $((expiry - started)) -lt "$SANDBOX_MIN_LIFETIME_SECONDS" ]; then
        expiry=$(sandbox_lifetime_midnight_after "$started" 2) || {
            echo "sandbox-lifetime: could not resolve the following midnight in ${SANDBOX_TZ}" >&2
            return 2
        }
    fi

    echo "expiresAt=${expiry}"
    echo "expiresAtIso=$(date -u -d "@${expiry}" +%Y-%m-%dT%H:%M:%SZ)"
}

# sandbox_lifetime_is_expired <expiresAtEpoch> <nowEpoch>
#
# Prints `expired=true|false`. Expiry is INCLUSIVE — at the stamped second the sandbox is over. Pure.
sandbox_lifetime_is_expired() {
    local expires="${1-}" now="${2-}"

    if ! sandbox_lifetime_is_epoch "$expires" || ! sandbox_lifetime_is_epoch "$now"; then
        echo "sandbox-lifetime: is-expired needs <expiresAtEpoch> <nowEpoch> as non-negative integers" >&2
        return 2
    fi

    if [ "$now" -ge "$expires" ]; then
        echo 'expired=true'
    else
        echo 'expired=false'
    fi
}

# Sourced by tests for the functions; executed by CI for the subcommands.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    case "${1-}" in
        expires-at)
            shift
            sandbox_lifetime_expires_at "$@"
            ;;
        is-expired)
            shift
            sandbox_lifetime_is_expired "$@"
            ;;
        *)
            echo "usage: sandbox-lifetime.sh {expires-at <startedEpoch>|is-expired <expiresAt> <now>}" >&2
            exit 2
            ;;
    esac
fi
