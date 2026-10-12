#!/usr/bin/env bash
#
# Is the SHARED SANDBOX up? A read-only status check for the sandbox database and NAT.
#
# ⛔ OWNER RULING 2026-10-12: THE SANDBOX STARTS ONLY BY HAND. This file used to WAKE it (`ensure` started a
# stopped RDS instance and a stopped NAT before a deploy or a test run). Nothing in CI may do that any more:
# "There should not be a wake of CI push. I never authorized that." The only start is the Sandbox Up workflow
# (docs/plans/2026-10-12-001-fix-sandbox-manual-start-plan.md, D2). The start subcommand and both start helpers
# are deleted, and `packages/infra/global/__tests__/sandboxWake.test.ts` fails if a start verb comes back, in
# code or in a comment. A job that needs the sandbox SKIPS when `check` says it is down; it never
# fails for that reason.
#
# ## What "up" means
#
# The database AND the NAT. ADR-0004 forbids interface endpoints, so every VPC-attached Lambda reaches Secrets
# Manager, SQS and Clerk through the sandbox NAT instance; a database that is `available` behind a stopped NAT
# still times out (measured 2026-08-23). The nightly stop (00:00 America/New_York) stops both.
#
# ## The headroom rule — the 2026-09-05 wedge
#
# A deploy that STARTS before the 00:00 ET stop and CROSSES it dies on `Cannot modify a stopped DB Instance` and
# leaves `kitchensink-data-sandbox` in UPDATE_ROLLBACK_FAILED. Run 33943032063: the gate said `available` at
# 23:52:52 ET, the scheduler stopped the instance at 00:00:07, CloudFormation's `ModifyDBInstance` died at
# 00:02:11. So "up" also means "will STILL be up when the caller finishes": within `required` seconds of the
# stop, `check` answers DOWN (exit 3) before it asks AWS anything. There is nothing to wait for any more, since
# nothing follows the boundary by waking the tier.
#
# ## ⛔ Why `check` takes no instance identifier
#
# The account holds exactly two DB instances, `kitchensink-data-prod-…` and `kitchensink-data-sandbox-…`, in the
# same region under the same credentials. Prod is never stopped, so reading it would report "up" for a sandbox
# that is down. `check` accepts a REGION and nothing else: it DISCOVERS instances and validates every one
# against `db_wake_is_sandbox_instance`, and a non-sandbox identifier in discovery is an ERROR for the whole
# run. Two independent guards, deliberately: the server-side `starts_with` filter narrows the query and the
# anchored client-side predicate is what authorises acting on a result — the same belt-and-braces shape as
# `prScope.sh`. The NAT half is the same, with `nat_wake_is_sandbox_nat`.
#
# Usage — as a CLI:
#     sandboxWake.sh classify            <status>      # pure: ready | down | wait | fatal   (RDS)
#     sandboxWake.sh classify-ec2        <state>       # pure: ready | down | wait | fatal   (EC2)
#     sandboxWake.sh is-sandbox-instance <identifier>  # pure: exit 0 = yes, 1 = no, 2 = misuse
#     sandboxWake.sh is-sandbox-nat      <nameTag>     # pure: exit 0 = yes, 1 = no, 2 = misuse
#     sandboxWake.sh next-stop           <epoch>       # pure: the next 00:00 ET stop, as an epoch second
#     sandboxWake.sh headroom            <epoch> <n>   # pure: clear | crossing
#     sandboxWake.sh check               <region>      # impure: discover and describe — never starts anything
#
# Exit status of `check`: 0 = up (database available, NAT running, enough headroom); 3 = DOWN — stopped,
# stopping, or inside the pre-midnight headroom; 1 = ERROR — anything that is not an answer (API failure,
# nothing discovered, a non-sandbox identifier, a terminal state, a resource stuck mid-start past the bound),
# annotated with `::error::`; 2 = misuse. ⚠️ GitHub runs `run:` steps under `bash -e`, so a caller must capture
# the status (`rc=0; bash … || rc=$?`) rather than let a 3 end the step. Tuning knobs
# `SANDBOX_WAKE_TIMEOUT_SECONDS`, `SANDBOX_WAKE_POLL_SECONDS` and `SANDBOX_WAKE_REQUIRED_HEADROOM_SECONDS` exist
# ONLY so the suites can drive the real loops without sleeping for them. ⛔ No workflow may set them —
# `sandboxWakeWiring.test.ts` asserts that, because a workflow that set the headroom to 0 would re-open the
# 2026-09-05 race behind a green check.
#
# Regression-tested for real — the tests execute THIS file rather than re-implementing it — by
# packages/infra/global/__tests__/sandboxWake.test.ts, tests/sandboxWake.integration.test.ts, and
# __tests__/sandboxWakeWiring.test.ts.
set -uo pipefail


# The ONLY identifier prefix this script may act on. Derived from `DataStack`'s stack name
# (`kitchensink-data-{stage}`) plus the `{stackName}-{logicalId}-{hash}` identifier CDK generates when no
# explicit `instanceIdentifier` is given — e.g. `kitchensink-data-sandbox-databaseb269d8bb-p76w6xmz1xlk`.
DB_WAKE_SANDBOX_PREFIX='kitchensink-data-sandbox'

# How long to wait for a resource that is STARTING (someone ran Sandbox Up), in seconds. A stopped `db.t4g.micro`
# reaches `available` in roughly 3–7 minutes; 15 gives comfortable headroom while keeping the wait BOUNDED. An
# unbounded wait would convert a fast answer into a job that burns the runner's whole 6-hour limit.
SANDBOX_WAKE_DEFAULT_TIMEOUT_SECONDS=900

# Seconds between polls. Long enough not to hammer the RDS API across concurrent workflows, short enough that
# the caller proceeds promptly once the resource is up.
SANDBOX_WAKE_DEFAULT_POLL_SECONDS=15

# The IANA zone the nightly stop is written in. `SandboxSchedulerStack` builds the stop cron with
# `TimeZone.AMERICA_NEW_YORK`, so the boundary this file reasons about must be resolved in the SAME zone —
# never by arithmetic on a UTC offset, which is wrong for half the year and wrong by a different amount on the
# two changeover nights.
SANDBOX_WAKE_SCHEDULE_TZ='America/New_York'

# The SHORTEST possible interval between two consecutive 00:00 stops: 22 hours, on the spring-forward night. A
# required headroom at or beyond it can never be satisfied on that night, so demanding one is a configuration
# error rather than a verdict — `sandbox_wake_headroom` refuses it as misuse.
SANDBOX_WAKE_MIN_SCHEDULE_PERIOD_SECONDS=79200

# How much run-way a caller needs on the far side of the check, in seconds. 45 minutes, sized on the LONGEST
# observed `sandbox-identity-deploy.yml` run (36m00s, run 33919685928 on 2026-09-04) plus margin. This is the
# number that turns "the database is up NOW" into "the database will STILL be up when you are done".
SANDBOX_WAKE_DEFAULT_REQUIRED_HEADROOM_SECONDS=2700

# sandbox_wake_next_stop <nowEpochSeconds>
#
# Echo the epoch second of the next ADR-0007 nightly stop — 00:00 `America/New_York` — STRICTLY AFTER
# <nowEpochSeconds>. Pure apart from reading the system tz database.
#
# ⛔ Resolved through `TZ=America/New_York date`, never by arithmetic. The naive forms are all wrong:
# `now - (now % 86400)` ignores the zone entirely; a fixed `-04:00` is an hour out for the winter half of
# the year; and "+ 86400" is wrong on BOTH changeover nights, in opposite directions — the interval between
# consecutive stops is 79200s across spring-forward and 90000s across fall-back. Those two are asserted.
#
# The calendar step is deliberately done on a BARE DATE in UTC (`<et-day> UTC +1 day`), so the day-rollover
# cannot itself be perturbed by a zone offset; only the final resolution of `00:00:00` is zone-aware, which
# is exactly where DST belongs.
#
# Note that "strictly after" falls out of the construction rather than needing a comparison: midnight of the
# CURRENT ET day is always at or before <nowEpochSeconds>, so the answer is always tomorrow's.
sandbox_wake_next_stop() {
    local now="${1-}"

    [[ $now =~ ^[0-9]+$ ]] || return 2

    local et_day next_day boundary

    et_day=$(TZ="$SANDBOX_WAKE_SCHEDULE_TZ" date -d "@${now}" '+%Y-%m-%d') || return 2
    next_day=$(date -u -d "${et_day} UTC +1 day" '+%Y-%m-%d') || return 2
    boundary=$(TZ="$SANDBOX_WAKE_SCHEDULE_TZ" date -d "${next_day} 00:00:00" '+%s') || return 2

    echo "$boundary"
}

# sandbox_wake_headroom <nowEpochSeconds> <requiredSeconds>
#
# ⛔ THE THIRD SAFETY BOUNDARY, and the one the other two cannot stand in for. Pure. Prints exactly one of:
#
#   clear     — the next nightly stop is at least <requiredSeconds> away; a caller starting now finishes
#               before it.
#   crossing  — the caller would still be running when the stop fires.
#
# ## Why this exists
#
# `db_wake_is_sandbox_instance` answers WHICH instance and `db_wake_classify` answers WHAT STATE it is in.
# Neither can answer HOW LONG that state will last, and on 2026-09-05 that gap wedged
# `kitchensink-data-sandbox`. Run 33943032063 of `sandbox-identity-deploy.yml` passed this file's gate at
# 03:52:52Z with `available (ready)` — a TRUE answer — the scheduler issued `StopDBInstance` at 04:00:07Z,
# and CloudFormation's `ModifyDBInstance` at 04:02:11Z died on `Cannot modify a stopped DB Instance`,
# failing the update and then the rollback: `UPDATE_ROLLBACK_FAILED`, on the SHARED tier every preview signs
# in against.
#
# ⚠️ Note what that failure is NOT. It is not ADR-0022's migration Trigger and it is not `connect ETIMEDOUT`
# — it is CloudFormation modifying the RDS resource in `DataStack`, which it enters on EVERY data-stack
# deploy. So the exposure needs no migration Trigger to exist, and a reader grepping for the known symptom
# finds nothing. Everything written before this incident — this file's header, ADR-0007's 2026-08-23 update,
# ADR-0028's cost section — frames the hazard as "a deploy that LANDS inside the window". This is a deploy
# that STARTS OUTSIDE it and CROSSES IN, which no amount of waking can fix, because at the moment of the
# check there is nothing to wake.
#
# The comparison is `>=`: a caller that fits EXACTLY proceeds.
#
# A <requiredSeconds> at or beyond `SANDBOX_WAKE_MIN_SCHEDULE_PERIOD_SECONDS` is refused as MISUSE rather
# than answered `crossing`. Waiting out the boundary could not satisfy it either, so it is a configuration
# error, and a gate that can never say `clear` would refuse every deploy at every hour — loudly wrong is
# better than that.
sandbox_wake_headroom() {
    local now="${1-}" required="${2-}" boundary

    [[ $now =~ ^[0-9]+$ ]] || return 2
    [[ $required =~ ^[0-9]+$ ]] || return 2

    if [ "$required" -ge "$SANDBOX_WAKE_MIN_SCHEDULE_PERIOD_SECONDS" ]; then
        echo "sandbox-wake: a required headroom of ${required}s can never be satisfied — consecutive 00:00 ${SANDBOX_WAKE_SCHEDULE_TZ} stops are as little as ${SANDBOX_WAKE_MIN_SCHEDULE_PERIOD_SECONDS}s apart (spring-forward)." >&2

        return 2
    fi

    boundary=$(sandbox_wake_next_stop "$now") || return 2

    if [ "$((boundary - now))" -ge "$required" ]; then
        echo 'clear'
    else
        echo 'crossing'
    fi
}

# db_wake_is_sandbox_instance <identifier>
#
# ⛔ THE SAFETY BOUNDARY. True iff <identifier> is the shared sandbox DB instance: exactly the prefix, or
# the prefix followed by `-` and a CDK suffix. Anchored at BOTH ends and restricted to the character set
# RDS actually uses (lowercase alphanumerics and `-`), so it refuses the live prod instance
# (`kitchensink-data-prod-…`), a suffix collision (`kitchensink-data-sandboxprod`,
# `kitchensink-data-sandbox2-…`), a prefix collision (`my-kitchensink-data-sandbox-…`), and any value
# carrying whitespace, a glob character or a path traversal — all of which would otherwise be spliced
# straight into an AWS CLI argument.
#
# Returns 2 (not "no") when handed nothing, so a caller that skipped its own guard fails loudly instead of
# silently matching.
db_wake_is_sandbox_instance() {
    local identifier="${1-}"
    [ -n "$identifier" ] || return 2

    [[ $identifier =~ ^${DB_WAKE_SANDBOX_PREFIX}(-[a-z0-9-]+)?$ ]]
}

# db_wake_classify <status>
#
# Map an RDS `DBInstanceStatus` onto the one verdict it implies. Pure. Prints exactly one of:
#
#   ready  — connectable now.
#   down   — `stopped` or `stopping`: the sandbox is not up. `stopping` is answered at once, not waited on —
#            it ends in `stopped`, and nothing here starts the instance again.
#   wait   — transient; poll again. Includes `starting` (someone ran Sandbox Up) and the internal `UNREADABLE`
#            token this script substitutes when a describe call fails, so a blip is retried rather than
#            treated as an answer.
#   fatal  — terminal, or unrecognised.
#
# An UNRECOGNISED status is `fatal` on purpose. Both alternatives end in an error; `fatal` ends it in seconds
# with the status named, whereas `wait` first burns the entire timeout to say the same thing.
db_wake_classify() {
    local status="${1-}"
    [ -n "$status" ] || return 2

    case "$status" in
        available)
            echo 'ready'
            ;;
        stopped | stopping)
            echo 'down'
            ;;
        starting | creating | rebooting | modifying | backing-up | maintenance | renaming | \
            resetting-master-credentials | storage-optimization | upgrading | \
            configuring-enhanced-monitoring | configuring-iam-database-auth | configuring-log-exports | \
            converting-to-vpc | moving-to-vpc | storage-config-upgrade | delete-precheck | UNREADABLE)
            echo 'wait'
            ;;
        # Listed rather than folded into the catch-all so the terminal set is documented where it is
        # decided; the verdict is identical to the unrecognised case below.
        deleting | failed | incompatible-* | inaccessible-encryption-credentials* | insufficient-capacity | \
            restore-error | storage-full)
            echo 'fatal'
            ;;
        *)
            echo 'fatal'
            ;;
    esac
}

# db_wake_discover <region>
#
# Print every DB instance identifier in <region> whose name starts with the sandbox prefix, one per line.
# Returns non-zero when the API call itself failed — which is deliberately distinguishable from "found
# nothing", because the two need different messages and both are fatal for different reasons.
#
# @sideEffect Calls the RDS API.
db_wake_discover() {
    local region="$1" raw exit_status

    raw=$(aws rds describe-db-instances --region "$region" \
        --query "DBInstances[?starts_with(DBInstanceIdentifier, '${DB_WAKE_SANDBOX_PREFIX}')].DBInstanceIdentifier" \
        --output text 2>/dev/null)
    exit_status=$?

    [ "$exit_status" -eq 0 ] || return 1
    [ "$raw" = 'None' ] && raw=''

    printf '%s' "$raw" | tr '\t ' '\n\n' | sed '/^$/d'

    return 0
}

# db_wake_status <region> <identifier>
#
# Echo the instance's current `DBInstanceStatus`, or the internal token `UNREADABLE` when the describe
# call fails or answers nothing. `UNREADABLE` classifies as `wait`, so a transient API error is retried
# rather than mistaken for a terminal state — and a PERMANENT one still ends at the bounded timeout with
# the token in the message.
#
# @sideEffect Calls the RDS API.
db_wake_status() {
    local region="$1" identifier="$2" status

    status=$(aws rds describe-db-instances --region "$region" --db-instance-identifier "$identifier" \
        --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null) || status=''

    if [ -z "$status" ] || [ "$status" = 'None' ]; then
        status='UNREADABLE'
    fi

    echo "$status"
}

# db_wake_probe_instance <region> <identifier> <timeoutSeconds> <pollSeconds>
#
# Judge ONE validated sandbox instance. Exit 0 = available, 3 = down, 1 = error. Re-asserts the sandbox
# predicate first, so the guard sits ON the read and not only at the caller: reading prod would report "up"
# for a sandbox that is down.
#
# @sideEffect Calls the RDS API.
db_wake_probe_instance() {
    local region="$1" identifier="$2" timeout="$3" poll="$4"
    local deadline status class

    if ! db_wake_is_sandbox_instance "$identifier"; then
        echo "::error::sandbox-check refused '${identifier}' — not the shared sandbox database."

        return 1
    fi

    deadline=$(($(date +%s) + timeout))

    while true; do
        status=$(db_wake_status "$region" "$identifier")
        class=$(db_wake_classify "$status")
        echo "[sandbox-check] ${identifier} → ${status} (${class})"

        case "$class" in
            ready)
                echo "[sandbox-check] ${identifier} is available."

                return 0
                ;;
            down)
                echo "[sandbox-check] ${identifier} is ${status} — the sandbox is down. Raise it with the Sandbox Up workflow."

                return 3
                ;;
            fatal)
                echo "::error::sandbox database ${identifier} is '${status}' — terminal or unrecognised, so the sandbox cannot be called up or down."

                return 1
                ;;
        esac

        if [ "$(date +%s)" -ge "$deadline" ]; then
            echo "::error::sandbox database ${identifier} did not settle within ${timeout}s (last status: ${status}). A resource stuck mid-transition is an anomaly, not an answer."

            return 1
        fi

        sleep "$poll"
    done
}

# nat_wake_is_sandbox_nat <nameTag>
#
# ⛔ THE SECOND SAFETY BOUNDARY. True iff <nameTag> names the SANDBOX NAT instance. Mirrors
# `selectSandboxNatInstances` in `lib/sandbox-scheduler/scheduler.ts` — the marker is a `sandbox` substring
# in the `Name` tag — with one tightening this side needs and the scheduler does not: a name that ALSO
# carries `prod` is refused outright. The scheduler can rely on prod's NAT simply not matching; a status
# check should refuse a name that reads both ways rather than resolve it.
#
# Case-insensitive, because the tag is human-authored and CDK's generated path form is mixed case.
#
# Returns 2 (not "no") when handed nothing, so a caller that skipped its own guard fails loudly.
nat_wake_is_sandbox_nat() {
    local name_tag="${1-}"
    [ "$#" -ge 1 ] || return 2

    local lowered
    lowered=$(printf '%s' "$name_tag" | tr '[:upper:]' '[:lower:]')

    [ -n "$lowered" ] || return 1
    case "$lowered" in
        *prod*) return 1 ;;
    esac
    case "$lowered" in
        *sandbox*) return 0 ;;
    esac

    return 1
}

# nat_wake_classify <state>
#
# Map an EC2 `InstanceState.Name` onto the one verdict it implies. Pure. Deliberately SEPARATE from
# `db_wake_classify`: `stopping` means the same thing in both vocabularies, but `available` is not an EC2 state
# and `running` is not an RDS one, so a single table would have to accept both and would therefore accept
# nonsense from either.
#
# `shutting-down` is `wait` rather than `fatal` on purpose — it resolves to `terminated`, which IS fatal, and
# arriving there by polling names the real state in the error message.
nat_wake_classify() {
    local state="${1-}"
    [ -n "$state" ] || return 2

    case "$state" in
        running)
            echo 'ready'
            ;;
        stopped | stopping)
            echo 'down'
            ;;
        pending | shutting-down | UNREADABLE)
            echo 'wait'
            ;;
        terminated)
            echo 'fatal'
            ;;
        *)
            echo 'fatal'
            ;;
    esac
}

# nat_wake_discover <region>
#
# Print `<instanceId><TAB><nameTag>` for every candidate NAT instance in <region>: source/destination check
# DISABLED (what makes an instance a NAT) and a `sandbox` marker in its `Name` tag. Terminated instances are
# excluded by the state filter, so a replaced NAT does not resurrect as a candidate.
#
# The server-side filter NARROWS; `nat_wake_is_sandbox_nat` is what AUTHORISES — the same belt-and-braces
# split as the RDS half. Non-zero when the API call itself failed, which is distinguishable from "found
# nothing" because the two need different messages.
#
# @sideEffect Calls the EC2 API.
nat_wake_discover() {
    local region="$1" raw exit_status

    raw=$(aws ec2 describe-instances --region "$region" \
        --filters 'Name=source-dest-check,Values=false' \
        'Name=tag:Name,Values=*sandbox*,*Sandbox*,*SANDBOX*' \
        'Name=instance-state-name,Values=pending,running,stopping,stopped' \
        --query 'Reservations[].Instances[].[InstanceId,Tags[?Key==`Name`]|[0].Value]' \
        --output text 2>/dev/null)
    exit_status=$?

    [ "$exit_status" -eq 0 ] || return 1

    printf '%s' "$raw" | sed '/^$/d'

    return 0
}

# nat_wake_state <region> <identifier>
#
# Echo the instance's current state name, or `UNREADABLE` when the describe call fails or answers nothing —
# which classifies as `wait`, so a transient API blip is retried rather than mistaken for terminal.
#
# @sideEffect Calls the EC2 API.
nat_wake_state() {
    local region="$1" identifier="$2" state

    state=$(aws ec2 describe-instances --region "$region" --instance-ids "$identifier" \
        --query 'Reservations[0].Instances[0].State.Name' --output text 2>/dev/null) || state=''

    if [ -z "$state" ] || [ "$state" = 'None' ]; then
        state='UNREADABLE'
    fi

    echo "$state"
}

# nat_wake_probe_instance <region> <identifier> <nameTag> <timeoutSeconds> <pollSeconds>
#
# Judge ONE validated sandbox NAT. Exit 0 = running, 3 = down, 1 = error. Re-asserts the predicate first.
#
# ⚠️ `running` is where this stops. A running instance has its ENI attached and the route table already points
# at it, so egress is there without a second signal to wait for.
#
# @sideEffect Calls the EC2 API.
nat_wake_probe_instance() {
    local region="$1" identifier="$2" name_tag="$3" timeout="$4" poll="$5"
    local deadline state class

    if ! nat_wake_is_sandbox_nat "$name_tag"; then
        echo "::error::sandbox-check refused NAT ${identifier} ('${name_tag}') — not the sandbox NAT."

        return 1
    fi

    deadline=$(($(date +%s) + timeout))

    while true; do
        state=$(nat_wake_state "$region" "$identifier")
        class=$(nat_wake_classify "$state")
        echo "[sandbox-check] NAT ${identifier} → ${state} (${class})"

        case "$class" in
            ready)
                echo "[sandbox-check] NAT ${identifier} is running."

                return 0
                ;;
            down)
                echo "[sandbox-check] NAT ${identifier} is ${state} — the sandbox is down. Raise it with the Sandbox Up workflow."

                return 3
                ;;
            fatal)
                echo "::error::sandbox NAT ${identifier} is '${state}' — terminal or unrecognised. Every VPC-attached Lambda egresses through it (ADR-0004: no interface endpoints)."

                return 1
                ;;
        esac

        if [ "$(date +%s)" -ge "$deadline" ]; then
            echo "::error::sandbox NAT ${identifier} did not settle within ${timeout}s (last state: ${state}). A resource stuck mid-transition is an anomaly, not an answer."

            return 1
        fi

        sleep "$poll"
    done
}

# nat_wake_check <region> <timeoutSeconds> <pollSeconds>
#
# Discover the sandbox NAT, refuse anything that is not it, and judge it. Exit 0 / 3 / 1 as above.
#
# @sideEffect Calls the EC2 API.
nat_wake_check() {
    local region="$1" timeout="$2" poll="$3"

    local discovered
    discovered=$(nat_wake_discover "$region") || {
        echo "::error::sandbox-check could not list EC2 instances in ${region}, so it cannot say whether the sandbox NAT is running."

        return 1
    }

    local ids=() names=() refused=() identifier name_tag
    while IFS=$'\t' read -r identifier name_tag; do
        [ -n "$identifier" ] || continue
        if nat_wake_is_sandbox_nat "$name_tag"; then
            ids+=("$identifier")
            names+=("$name_tag")
        else
            refused+=("${identifier} ('${name_tag}')")
        fi
    done <<<"$discovered"

    # ⛔ Same abort-the-whole-run rule as the RDS half. The server-side filter already narrowed to a `sandbox`
    # name tag, so a candidate the predicate rejects means the naming assumption no longer holds — and the
    # neighbouring NAT in this account is production's, which is always running.
    if [ "${#refused[@]}" -gt 0 ]; then
        echo "::error::sandbox-check discovered non-sandbox NAT instance(s) [${refused[*]}] under the sandbox tag filter. Reading prod's NAT would report a stopped sandbox as up."

        return 1
    fi

    if [ "${#ids[@]}" -eq 0 ]; then
        echo "::error::sandbox-check found no NAT instance with a 'sandbox' Name tag and source/dest check disabled in ${region}. Either the sandbox NAT is gone or its tag changed — both need a human."

        return 1
    fi

    local rc worst=0 index=0
    while [ "$index" -lt "${#ids[@]}" ]; do
        nat_wake_probe_instance "$region" "${ids[$index]}" "${names[$index]}" "$timeout" "$poll"
        rc=$?
        worst=$(sandbox_wake_worse "$worst" "$rc")
        index=$((index + 1))
    done

    return "$worst"
}

# sandbox_wake_worse <a> <b>
#
# Combine two `check` verdicts: an ERROR (1) outranks DOWN (3), which outranks UP (0). Pure. An error is not an
# answer, so it must not be hidden behind a "down" that happens to come from the neighbouring resource.
sandbox_wake_worse() {
    local a="$1" b="$2"

    if [ "$a" -eq 1 ] || [ "$b" -eq 1 ]; then
        echo 1
    elif [ "$a" -eq 3 ] || [ "$b" -eq 3 ]; then
        echo 3
    else
        echo 0
    fi
}

# sandbox_wake_check <region>
#
# THE entry point. Is the shared sandbox up? Discover the database and the NAT, refuse anything that is not the
# sandbox's, and judge both. Exit 0 = up, 3 = down (including the pre-midnight headroom), 1 = error, 2 = misuse.
#
# ⛔ READ-ONLY. It issues `describe` calls and nothing else (owner ruling 2026-10-12).
#
# @sideEffect Calls the RDS and EC2 APIs.
sandbox_wake_check() {
    local region="${1-}"

    if [ "$#" -ne 1 ] || [ -z "$region" ]; then
        echo 'usage: sandboxWake.sh check <region>   (there is deliberately NO instance argument — see the header)' >&2

        return 2
    fi

    local timeout="${SANDBOX_WAKE_TIMEOUT_SECONDS:-$SANDBOX_WAKE_DEFAULT_TIMEOUT_SECONDS}"
    local poll="${SANDBOX_WAKE_POLL_SECONDS:-$SANDBOX_WAKE_DEFAULT_POLL_SECONDS}"
    local required="${SANDBOX_WAKE_REQUIRED_HEADROOM_SECONDS:-$SANDBOX_WAKE_DEFAULT_REQUIRED_HEADROOM_SECONDS}"

    if ! [[ $timeout =~ ^[0-9]+$ ]] || ! [[ $poll =~ ^[0-9]+$ ]] || ! [[ $required =~ ^[0-9]+$ ]]; then
        echo "sandbox-check: SANDBOX_WAKE_TIMEOUT_SECONDS/SANDBOX_WAKE_POLL_SECONDS/SANDBOX_WAKE_REQUIRED_HEADROOM_SECONDS must be whole seconds, got '${timeout}'/'${poll}'/'${required}'" >&2

        return 2
    fi

    # ⛔ Range-checked HERE, before any API call. An unsatisfiable headroom is a configuration error, and a
    # configuration error should not cost a round trip to the RDS and EC2 APIs first.
    if [ "$required" -ge "$SANDBOX_WAKE_MIN_SCHEDULE_PERIOD_SECONDS" ]; then
        echo "sandbox-check: a required headroom of ${required}s can never be satisfied — consecutive 00:00 ${SANDBOX_WAKE_SCHEDULE_TZ} stops are as little as ${SANDBOX_WAKE_MIN_SCHEDULE_PERIOD_SECONDS}s apart (spring-forward)." >&2

        return 2
    fi

    # ⛔ THE HEADROOM RULE, BEFORE any describe. The answer to "will it still be up when the caller is done?" does
    # not depend on what RDS says now, and a caller inside the band must not proceed on a true-now answer
    # (2026-09-05). ⚠️ The status is PROPAGATED, not collapsed to 1: 2 means a mis-set knob, not a database.
    local now verdict
    now=$(date +%s)
    verdict=$(sandbox_wake_headroom "$now" "$required") || return 2

    if [ "$verdict" = 'crossing' ]; then
        echo "::notice::sandbox-check: fewer than ${required}s remain before the 00:00 ${SANDBOX_WAKE_SCHEDULE_TZ} nightly stop, so a caller starting now would be running when it fires. Treating the sandbox as DOWN."

        return 3
    fi

    local discovered
    discovered=$(db_wake_discover "$region") || {
        echo "::error::sandbox-check could not list RDS instances in ${region}, so it cannot say whether the sandbox database is up."

        return 1
    }

    local valid=() refused=() identifier
    while IFS= read -r identifier; do
        [ -n "$identifier" ] || continue
        if db_wake_is_sandbox_instance "$identifier"; then
            valid+=("$identifier")
        else
            refused+=("$identifier")
        fi
    done <<<"$discovered"

    # ⛔ Abort the WHOLE run. The server-side query already filters to the sandbox prefix, so an identifier
    # arriving here that the anchored predicate rejects means the naming assumption this script is built on no
    # longer holds — and the neighbouring instance in this account is production, which is always `available`.
    if [ "${#refused[@]}" -gt 0 ]; then
        echo "::error::sandbox-check discovered non-sandbox DB instance(s) [${refused[*]}] under the sandbox prefix filter. This account also holds the PRODUCTION database, so a scope surprise is refused rather than worked around."

        return 1
    fi

    if [ "${#valid[@]}" -eq 0 ]; then
        echo "::error::sandbox-check found no DB instance named '${DB_WAKE_SANDBOX_PREFIX}*' in ${region}. Either the shared sandbox database is gone or its identifier changed — both need a human."

        return 1
    fi

    # ⛔ BOTH halves run, even when the first one says down — an operator should learn both verdicts in one run.
    local rc worst=0
    for identifier in "${valid[@]}"; do
        db_wake_probe_instance "$region" "$identifier" "$timeout" "$poll"
        rc=$?
        worst=$(sandbox_wake_worse "$worst" "$rc")
    done

    nat_wake_check "$region" "$timeout" "$poll"
    rc=$?
    worst=$(sandbox_wake_worse "$worst" "$rc")

    case "$worst" in
        0) echo '[sandbox-check] the sandbox is up.' ;;
        3) echo '::notice::sandbox-check: the sandbox is down.' ;;
    esac

    return "$worst"
}

# CLI dispatch — only when executed directly, never when sourced.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    case "${1-}" in
        classify)
            db_wake_classify "${2-}"
            ;;
        next-stop)
            sandbox_wake_next_stop "${2-}"
            ;;
        headroom)
            sandbox_wake_headroom "${2-}" "${3-}"
            ;;
        classify-ec2)
            nat_wake_classify "${2-}"
            ;;
        is-sandbox-instance)
            db_wake_is_sandbox_instance "${2-}"
            ;;
        is-sandbox-nat)
            # ⚠️ `"$@"` minus the subcommand, NOT `"${2-}"`. The predicate distinguishes "no argument"
            # (misuse) from "the empty string" (a NAT with no Name tag, which is a refusal), and `${2-}`
            # would collapse the two into one.
            shift
            nat_wake_is_sandbox_nat "$@"
            ;;
        check)
            shift
            sandbox_wake_check "$@"
            ;;
        *)
            echo 'usage: sandboxWake.sh classify <status> | classify-ec2 <state> | is-sandbox-instance <identifier> | is-sandbox-nat <nameTag> | next-stop <epoch> | headroom <epoch> <requiredSeconds> | check <region>' >&2
            exit 2
            ;;
    esac
fi
