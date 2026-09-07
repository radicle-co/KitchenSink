#!/usr/bin/env bash
#
# Wake the SHARED SANDBOX database before a deploy that will migrate it.
#
# ⚠️  DELIBERATE — this exists because two accepted ADRs compose into a failure neither predicted.
#     Read docs/architecture/decisions/0007-sandbox-cost-controls.md and
#     docs/architecture/decisions/0022-in-stack-migration-trigger.md before changing it.
#
# ## The incident
#
# ADR-0007 stops the sandbox RDS instance nightly, 00:00–09:00 ET. ADR-0022 moved schema migrations INSIDE
# the deploy, as an `aws-cdk-lib/triggers` Trigger that every Lambda/ECS service in the stack is ordered
# behind. A deploy that lands inside that window therefore runs its migration Trigger against a STOPPED
# instance:
#
#     RecipeSchemaMigrations  Failed  connect ETIMEDOUT 10.1.4.241:5432
#
# …which fails the stack update — and then the ROLLBACK fails for exactly the same reason, because rolling
# the Trigger back re-invokes it. Observed 00:31 EDT on `kitchensink-recipe-service-pr-91`, which came to
# rest in `UPDATE_ROLLBACK_FAILED`. That state is NOT self-healing: every subsequent sandbox deploy failed
# on the wedge rather than on its own diff, until a human ran
# `continue-update-rollback --resources-to-skip RecipeSchemaMigrations`.
#
# `SandboxSchedulerStack` already holds BOTH `rds:StopDBInstance` and `rds:StartDBInstance`. What was
# missing was anything that woke the instance ON DEMAND. This is that.
#
# ## ⛔ Why `ensure` takes no instance identifier
#
# The account holds exactly two DB instances — `kitchensink-data-prod-…` and `kitchensink-data-sandbox-…`
# — in the same region, under the same credentials. Prod's is never stopped, so a wake that reached it
# could only ever be a mistake. `ensure` therefore accepts a REGION and nothing else: it DISCOVERS
# instances and validates every one against `db_wake_is_sandbox_instance`. There is no argument a caller
# could typo, no environment variable that redirects it, and a non-sandbox identifier appearing in
# discovery aborts the whole run WITHOUT issuing anything mutating. Two independent guards, deliberately:
# the server-side `starts_with` filter narrows the query, and the anchored client-side predicate is what
# actually authorises the call — the same belt-and-braces shape as `pr-scope.sh`.
#
# ## What it does NOT do
#
# It never stops anything, never disables the nightly schedule, and never touches ECS. Waking on demand for
# a real deploy is the point; keeping the tier awake is not (ADR-0007's cost intent stands). Callers gate it
# on their own "am I actually deploying?" decision, so an unchanged PR that skips its deploy wakes nothing.
#
# ECS is excluded for a reason rather than by omission: a sandbox deploy deploys its OWN service, and CDK
# restores the desired count as part of that. Nothing else needs it up before the deploy starts.
#
# ## The NAT half — the same incident, discovered the hard way a second time
#
# This script woke only the DATABASE until 2026-08-23, on the reasoning recorded above. That reasoning was
# incomplete. `SandboxSchedulerStack` stops the sandbox NAT INSTANCE on the same nightly schedule, and the
# sandbox VPC has NO interface endpoints — ADR-0004 forbids them on cost grounds ($14.60/month/stage against
# a $3-4/month NAT). Every VPC-attached Lambda therefore reaches Secrets Manager, SQS and the Clerk API
# through that one t4g.nano.
#
# So a deploy inside the window found an `available` database, a green wake gate, and still died:
#
#     {"errorType":"TimeoutError","trace":["AggregateError [ETIMEDOUT]:","at internalConnectMultiple"]}
#
# Note what is MISSING from that trace — an address. The 00:31 incident named `10.1.4.241:5432` because
# Postgres itself was unreachable; this one dies EARLIER, in the Secrets Manager fetch that resolves
# `DB_SECRET_ARN`, so it never gets far enough to name a host. Same window, same ADR pair, different
# resource. The gate now wakes both, which is why it is no longer called `db-wake.sh`.
#
# ## The HEADROOM half — the same window, a third time, with both gates GREEN
#
# The two sections above both describe a deploy that LANDS inside the window. On 2026-09-05 a deploy that
# started OUTSIDE it wedged `kitchensink-data-sandbox` anyway. Run 33943032063 of
# `sandbox-identity-deploy.yml`, measured on the account:
#
#     03:52:52Z (23:52:52 ET)  this gate reports `available (ready)` + NAT `running (ready)`  ← TRUE
#     04:00:07Z (00:00:07 ET)  the scheduler Lambda issues StopDBInstance
#     04:02:11Z (00:02:11 ET)  CloudFormation issues ModifyDBInstance on DatabaseB269D8BB
#     04:04:24Z (00:04:24 ET)  UPDATE_FAILED — "Cannot modify a stopped DB Instance"
#     04:07:05Z (00:07:05 ET)  the rollback re-issues the same modify → UPDATE_ROLLBACK_FAILED
#
# The gate was present, it ran, and it was RIGHT — nine minutes before the deploy needed the answer. That is
# a time-of-check-to-time-of-use race against the 00:00 boundary, and no amount of waking closes it, because
# at the moment of the check there is nothing to wake.
#
# ⚠️ Two things about this incident mislead a reader who knows the two above. The failing operation is NOT
# ADR-0022's migration Trigger — it is CloudFormation's own `ModifyDBInstance` on the RDS resource in
# `DataStack`, which is entered on EVERY data-stack deploy (verified across nine consecutive updates), so
# the exposure does not depend on a stack owning a Trigger at all. And the error string is different, so
# grepping for `connect ETIMEDOUT` finds nothing.
#
# `sandbox_wake_headroom` is the close: the gate now asserts that the instance will STILL be up when the
# caller finishes, and `sandbox_wake_await_boundary` waits out the boundary when it will not be. See those
# two functions for why waiting beats skipping and why "wake harder" is not an option.
#
# Usage — as a CLI:
#     sandbox-wake.sh classify            <status>      # pure: ready | wake | wait | fatal   (RDS)
#     sandbox-wake.sh classify-ec2        <state>       # pure: ready | wake | wait | fatal   (EC2)
#     sandbox-wake.sh is-sandbox-instance <identifier>  # pure: exit 0 = yes, 1 = no, 2 = misuse
#     sandbox-wake.sh is-sandbox-nat      <nameTag>     # pure: exit 0 = yes, 1 = no, 2 = misuse
#     sandbox-wake.sh next-stop           <epoch>       # pure: the next 00:00 ET stop, as an epoch second
#     sandbox-wake.sh headroom            <epoch> <n>   # pure: clear | crossing
#     sandbox-wake.sh ensure              <region>      # impure: discover, wake, wait — bounded, BOTH
#
# Exit status: 0 = the sandbox database is available AND will stay up long enough, 1 = it is not (annotated
# with `::error::`), 2 = misuse. Tuning knobs `SANDBOX_WAKE_TIMEOUT_SECONDS`, `SANDBOX_WAKE_POLL_SECONDS`,
# `SANDBOX_WAKE_REQUIRED_HEADROOM_SECONDS`, `SANDBOX_WAKE_STOP_SETTLE_SECONDS` and
# `SANDBOX_WAKE_MAX_BOUNDARY_WAIT_SECONDS` exist ONLY so the suites can drive the real loops without
# sleeping for them. ⛔ No workflow may set them — `sandboxWakeWiring.test.ts` asserts that, because a
# workflow that set the headroom to 0 would re-open the 2026-09-05 race behind a green gate.
#
# Regression-tested for real — the tests execute THIS file rather than re-implementing it — by
# packages/infra/global/__tests__/sandboxWake.test.ts, tests/sandboxWake.integration.test.ts, and
# __tests__/sandboxWakeWiring.test.ts (which asserts every sandbox deploy step is preceded by it).
set -uo pipefail

# The ONLY identifier prefix this script may act on. Derived from `DataStack`'s stack name
# (`kitchensink-data-{stage}`) plus the `{stackName}-{logicalId}-{hash}` identifier CDK generates when no
# explicit `instanceIdentifier` is given — e.g. `kitchensink-data-sandbox-databaseb269d8bb-p76w6xmz1xlk`.
DB_WAKE_SANDBOX_PREFIX='kitchensink-data-sandbox'

# How long to wait for a woken instance, in seconds. A stopped `db.t4g.micro` reaches `available` in
# roughly 3–7 minutes; 15 gives that comfortable headroom while keeping the failure BOUNDED. An unbounded
# wait would convert a fast, legible failure into a job that burns the runner's whole 6-hour limit.
SANDBOX_WAKE_DEFAULT_TIMEOUT_SECONDS=900

# Seconds between polls. Long enough not to hammer the RDS API across concurrent workflows, short enough
# that the deploy starts promptly once the instance is up.
SANDBOX_WAKE_DEFAULT_POLL_SECONDS=15

# The IANA zone ADR-0007's schedule is written in. `SandboxSchedulerStack` builds both crons with
# `TimeZone.AMERICA_NEW_YORK`, so the boundary this file reasons about must be resolved in the SAME zone —
# never by arithmetic on a UTC offset, which is wrong for half the year and wrong by a different amount on
# the two changeover nights.
SANDBOX_WAKE_SCHEDULE_TZ='America/New_York'

# The SHORTEST possible interval between two consecutive 00:00 ET stops: 22 hours, on the spring-forward
# night. A required headroom at or beyond it can never be satisfied on that night, so demanding one is a
# configuration error rather than a verdict — `sandbox_wake_headroom` refuses it as misuse.
SANDBOX_WAKE_MIN_SCHEDULE_PERIOD_SECONDS=79200

# How much run-way a caller needs on the far side of the gate, in seconds. 45 minutes, sized on the LONGEST
# observed `sandbox-identity-deploy.yml` run (36m00s, run 33919685928 on 2026-09-04) plus margin. This is
# the number that turns "the database is up NOW" into "the database will STILL be up when you are done".
SANDBOX_WAKE_DEFAULT_REQUIRED_HEADROOM_SECONDS=2700

# After the boundary passes, how long to keep watching for the nightly stop to actually land before giving
# up on seeing it. EventBridge Scheduler fires these schedules with NO flexible time window, and the stop
# was observed at 00:00:07 ET — 5 minutes is generous cover for jitter, and exhausting it is not an error
# (see `sandbox_wake_await_boundary`).
SANDBOX_WAKE_DEFAULT_STOP_SETTLE_SECONDS=300

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
# Map an RDS `DBInstanceStatus` onto the one action it implies. Pure. Prints exactly one of:
#
#   ready  — connectable now; proceed.
#   wake   — `stopped`, the ONLY status that may issue StartDBInstance.
#   wait   — transient; poll again. Includes `stopping` (the 00:31 race — StartDBInstance on a stopping
#            instance is rejected with InvalidDBInstanceState, so the correct move is to wait for
#            `stopped` and then wake it) and the internal `UNREADABLE` token this script substitutes when
#            a describe call fails, so a blip is retried rather than treated as terminal.
#   fatal  — terminal, or unrecognised.
#
# An UNRECOGNISED status is `fatal` on purpose. Both alternatives end the job red; `fatal` ends it in
# seconds with the status named, whereas `wait` first burns the entire timeout to say the same thing.
db_wake_classify() {
    local status="${1-}"
    [ -n "$status" ] || return 2

    case "$status" in
        available)
            echo 'ready'
            ;;
        stopped)
            echo 'wake'
            ;;
        starting | stopping | creating | rebooting | modifying | backing-up | maintenance | renaming | \
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

# db_wake_start <region> <identifier>
#
# Issue StartDBInstance. Non-zero (with the CLI's message on stdout) when AWS rejected it — which is an
# EXPECTED, tolerable outcome: two workflows can observe `stopped` simultaneously, and the loser gets
# `InvalidDBInstanceState` for an instance that is already coming up. The caller re-polls rather than
# failing; the loop, not this call, is the authority on whether the wake worked.
#
# @sideEffect Starts an RDS instance.
db_wake_start() {
    local region="$1" identifier="$2" output exit_status

    output=$(aws rds start-db-instance --region "$region" --db-instance-identifier "$identifier" 2>&1)
    exit_status=$?

    [ "$exit_status" -eq 0 ] || echo "$output"

    return "$exit_status"
}

# db_wake_instance <region> <identifier> <timeoutSeconds> <pollSeconds>
#
# Bring ONE validated sandbox instance to `available`, or fail loudly. Re-asserts the sandbox predicate
# first: this function issues the only mutating call in the file, so the guard sits ON it rather than
# only at the caller.
#
# @sideEffect Calls the RDS API and may start an instance.
db_wake_instance() {
    local region="$1" identifier="$2" timeout="$3" poll="$4"
    local deadline status class now last_error=''

    if ! db_wake_is_sandbox_instance "$identifier"; then
        echo "::error::sandbox-wake refused '${identifier}' — not the shared sandbox database. Nothing was started."
        return 1
    fi

    deadline=$(($(date +%s) + timeout))

    while true; do
        status=$(db_wake_status "$region" "$identifier")
        class=$(db_wake_classify "$status")
        echo "[sandbox-wake] ${identifier} → ${status} (${class})"

        case "$class" in
            ready)
                echo "[sandbox-wake] ${identifier} is available — the migration Trigger can reach it."

                return 0
                ;;
            fatal)
                echo "::error::sandbox database ${identifier} is '${status}' — terminal or unrecognised, so a deploy would run its migration Trigger against an unusable instance. Fix the instance (or teach sandbox-wake.sh this status) before redeploying."

                return 1
                ;;
            wake)
                echo "[sandbox-wake] ${identifier} is stopped — issuing StartDBInstance."
                if ! last_error=$(db_wake_start "$region" "$identifier"); then
                    # Expected under concurrency; the next poll observes the state whoever won produced.
                    echo "::notice::StartDBInstance for ${identifier} was rejected (${last_error}) — re-polling, another actor may already be starting it."
                fi
                ;;
        esac

        now=$(date +%s)
        if [ "$now" -ge "$deadline" ]; then
            echo "::error::sandbox database ${identifier} did not reach 'available' within ${timeout}s (last status: ${status}). Refusing to deploy: ADR-0022's in-stack migration Trigger would time out against it and wedge the stack in UPDATE_ROLLBACK_FAILED.${last_error:+ Last StartDBInstance error: ${last_error}}"

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
# carries `prod` is refused outright. The scheduler can rely on prod's NAT simply not matching; a gate that
# issues StartInstances from CI should refuse a name that reads both ways rather than resolve it.
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
# Map an EC2 `InstanceState.Name` onto the one action it implies. Pure. Deliberately SEPARATE from
# `db_wake_classify`: `stopping` means the same thing in both vocabularies, but `available` is not an EC2
# state and `running` is not an RDS one, so a single table would have to accept both and would therefore
# accept nonsense from either.
#
# `shutting-down` is `wait` rather than `fatal` on purpose — it resolves to `terminated`, which IS fatal, and
# arriving there by polling names the real state in the failure message.
nat_wake_classify() {
    local state="${1-}"
    [ -n "$state" ] || return 2

    case "$state" in
        running)
            echo 'ready'
            ;;
        stopped)
            echo 'wake'
            ;;
        pending | stopping | shutting-down | UNREADABLE)
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

# nat_wake_start <region> <identifier>
#
# Issue StartInstances. Non-zero (with the CLI's message on stdout) when AWS rejected it — expected under
# concurrency, exactly as in the RDS half: the loop, not this call, decides whether the wake worked.
#
# @sideEffect Starts an EC2 instance.
nat_wake_start() {
    local region="$1" identifier="$2" output exit_status

    output=$(aws ec2 start-instances --region "$region" --instance-ids "$identifier" 2>&1)
    exit_status=$?

    [ "$exit_status" -eq 0 ] || echo "$output"

    return "$exit_status"
}

# nat_wake_instance <region> <identifier> <nameTag> <timeoutSeconds> <pollSeconds>
#
# Bring ONE validated sandbox NAT to `running`, or fail loudly. Re-asserts the predicate first: this
# function issues the only mutating EC2 call in the file, so the guard sits ON it and not only at the caller.
#
# ⚠️ `running` is where this stops. A running instance has its ENI attached and the route table already
# points at it, so egress resumes without a second signal to wait for — there is no EC2 equivalent of RDS's
# post-start warm-up, and adding a fixed sleep would be a guess dressed as rigour.
#
# @sideEffect Calls the EC2 API and may start an instance.
nat_wake_instance() {
    local region="$1" identifier="$2" name_tag="$3" timeout="$4" poll="$5"
    local deadline state class now last_error=''

    if ! nat_wake_is_sandbox_nat "$name_tag"; then
        echo "::error::sandbox-wake refused NAT ${identifier} ('${name_tag}') — not the sandbox NAT. Nothing was started."

        return 1
    fi

    deadline=$(($(date +%s) + timeout))

    while true; do
        state=$(nat_wake_state "$region" "$identifier")
        class=$(nat_wake_classify "$state")
        echo "[sandbox-wake] NAT ${identifier} → ${state} (${class})"

        case "$class" in
            ready)
                echo "[sandbox-wake] NAT ${identifier} is running — VPC Lambdas can reach Secrets Manager, SQS and Clerk again."

                return 0
                ;;
            fatal)
                echo "::error::sandbox NAT ${identifier} is '${state}' — terminal or unrecognised. Every VPC-attached Lambda egresses through it (ADR-0004: no interface endpoints), so a deploy would time out in Secrets Manager before it ever reached Postgres."

                return 1
                ;;
            wake)
                echo "[sandbox-wake] NAT ${identifier} is stopped — issuing StartInstances."
                if ! last_error=$(nat_wake_start "$region" "$identifier"); then
                    echo "::notice::StartInstances for ${identifier} was rejected (${last_error}) — re-polling, another actor may already be starting it."
                fi
                ;;
        esac

        now=$(date +%s)
        if [ "$now" -ge "$deadline" ]; then
            echo "::error::sandbox NAT ${identifier} did not reach 'running' within ${timeout}s (last state: ${state}). Refusing to deploy: its VPC Lambdas would fail with ETIMEDOUT resolving DB_SECRET_ARN.${last_error:+ Last StartInstances error: ${last_error}}"

            return 1
        fi

        sleep "$poll"
    done
}

# nat_wake_ensure <region> <timeoutSeconds> <pollSeconds>
#
# Discover the sandbox NAT, refuse anything that is not it, and bring it to `running` within the bound.
#
# @sideEffect Calls the EC2 API and may start the sandbox NAT instance.
nat_wake_ensure() {
    local region="$1" timeout="$2" poll="$3"

    local discovered
    discovered=$(nat_wake_discover "$region") || {
        echo "::error::sandbox-wake could not list EC2 instances in ${region}. Refusing to deploy blind: a stopped sandbox NAT makes every VPC Lambda time out (ADR-0004 x ADR-0007)."

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

    # ⛔ Same abort-the-whole-run rule as the RDS half. The server-side filter already narrowed to a
    # `sandbox` name tag, so a candidate the predicate rejects means the naming assumption no longer holds —
    # and the neighbouring NAT in this account is production's.
    if [ "${#refused[@]}" -gt 0 ]; then
        echo "::error::sandbox-wake discovered non-sandbox NAT instance(s) [${refused[*]}] under the sandbox tag filter. Nothing was started."

        return 1
    fi

    if [ "${#ids[@]}" -eq 0 ]; then
        echo "::error::sandbox-wake found no NAT instance with a 'sandbox' Name tag and source/dest check disabled in ${region}. Either the sandbox NAT is gone or its tag changed — both need a human, and deploying past it fails every VPC Lambda with ETIMEDOUT."

        return 1
    fi

    local failed=0 index=0
    while [ "$index" -lt "${#ids[@]}" ]; do
        nat_wake_instance "$region" "${ids[$index]}" "${names[$index]}" "$timeout" "$poll" || failed=1
        index=$((index + 1))
    done

    return "$failed"
}

# sandbox_wake_await_boundary <region> <identifier> <requiredSeconds> <settleSeconds> <pollSeconds> <maxWaitSeconds>
#
# Make the caller's headroom TRUE rather than merely reporting that it is false.
#
# When `sandbox_wake_headroom` says `clear`, this returns immediately and nothing changes — the overwhelming
# majority of runs, at every hour except the ~45 minutes before 00:00 ET.
#
# When it says `crossing`, the run is in the band that wedged `kitchensink-data-sandbox`. There are only
# three things a gate can do there, and two of them are worse:
#
#   - SKIP the deploy. The shared sandbox identity tier is what every open preview signs in against, and
#     `sandbox-identity-deploy.yml` is the only thing that converges it to the PR's code. A skip is a silent
#     divergence between what the PR says and what sandbox runs, reported green — and if the PR merges
#     overnight, nothing ever redeploys it.
#   - WAKE harder. There is nothing to wake: the instance is `available` at the moment of the check. Waking
#     it does not stop the scheduler from stopping it eight minutes later.
#   - WAIT for the boundary — this. The stop lands, we watch it land, and the existing loop below then wakes
#     the instance with a full day of headroom in front of it.
#
# Waiting costs at most <requiredSeconds> of runner idle (45 minutes by default, against GitHub's 6-hour job
# limit) and it does NOT introduce a new category of spend: waking the tier inside the 00:00–09:00 window is
# already what this script does for any deploy that starts inside it, and ADR-0007's 2026-08-23 update
# sanctions exactly that. It converts "deploy at 23:52" into "deploy at 00:10 on a woken instance", which is
# a shape the account already pays for.
#
# ⛔ The wait is BOUNDED, for the same reason the instance wait is: an unbounded one turns a legible failure
# into a job that burns the runner's whole limit. Exhausting <maxWaitSeconds> without reaching the boundary
# means the headroom is STILL short, so the gate FAILS rather than falling through — proceeding is precisely
# the wedge.
#
# ⚠️ After the boundary we watch for the stop to LAND rather than sleeping a guessed interval. Not seeing it
# is NOT an error: if the scheduler is disabled or broken the instance simply stays `available`, and we are
# now on the far side of the boundary, so the next stop is a full day away either way. The distinction that
# matters is `UNREADABLE` — a failed describe is not evidence of a stop, so it does not end the watch.
#
# @sideEffect Sleeps, and calls the RDS API.
sandbox_wake_await_boundary() {
    local region="$1" identifier="$2" required="$3" settle="$4" poll="$5" max_wait="$6"
    local now boundary verdict deadline status remaining

    now=$(date +%s)
    verdict=$(sandbox_wake_headroom "$now" "$required") || return 2

    if [ "$verdict" = 'clear' ]; then
        return 0
    fi

    boundary=$(sandbox_wake_next_stop "$now") || return 2

    echo "::notice::sandbox-wake: only $((boundary - now))s remain before ADR-0007's 00:00 ${SANDBOX_WAKE_SCHEDULE_TZ} stop and the caller needs ${required}s. Waiting for the boundary rather than deploying across it — a deploy that crosses the stop dies on 'Cannot modify a stopped DB Instance' and wedges the stack in UPDATE_ROLLBACK_FAILED (observed 2026-09-05 on kitchensink-data-sandbox)."

    deadline=$(($(date +%s) + max_wait))

    while [ "$(date +%s)" -lt "$boundary" ]; do
        if [ "$(date +%s)" -ge "$deadline" ]; then
            echo "::error::sandbox-wake did not reach the 00:00 ${SANDBOX_WAKE_SCHEDULE_TZ} boundary within ${max_wait}s, so the caller still has less than ${required}s of headroom. Refusing to deploy across the nightly stop."

            return 1
        fi

        remaining=$((boundary - $(date +%s)))
        if [ "$remaining" -gt "$poll" ]; then
            remaining="$poll"
        fi
        if [ "$remaining" -gt 0 ]; then
            sleep "$remaining"
        fi
    done

    deadline=$(($(date +%s) + settle))

    while [ "$(date +%s)" -lt "$deadline" ]; do
        status=$(db_wake_status "$region" "$identifier")

        if [ "$status" != 'available' ] && [ "$status" != 'UNREADABLE' ]; then
            echo "[sandbox-wake] the nightly stop has landed (${identifier} → ${status}); the wake below now has a full day of headroom in front of it."

            return 0
        fi

        sleep "$poll"
    done

    echo "::notice::sandbox-wake watched ${identifier} for ${settle}s past the boundary and it never left 'available' — the nightly stop did not arrive. Proceeding anyway: the next one is now a full day away."

    return 0
}

# sandbox_wake_ensure <region>
#
# THE entry point. Discover the sandbox database, refuse anything that is not it, and bring it to
# `available` within the bound.
#
# @sideEffect Calls the RDS API and may start the sandbox instance.
sandbox_wake_ensure() {
    local region="${1-}"

    if [ "$#" -ne 1 ] || [ -z "$region" ]; then
        echo 'usage: sandbox-wake.sh ensure <region>   (there is deliberately NO instance argument — see the header)' >&2

        return 2
    fi

    local timeout="${SANDBOX_WAKE_TIMEOUT_SECONDS:-$SANDBOX_WAKE_DEFAULT_TIMEOUT_SECONDS}"
    local poll="${SANDBOX_WAKE_POLL_SECONDS:-$SANDBOX_WAKE_DEFAULT_POLL_SECONDS}"
    local required="${SANDBOX_WAKE_REQUIRED_HEADROOM_SECONDS:-$SANDBOX_WAKE_DEFAULT_REQUIRED_HEADROOM_SECONDS}"
    local settle="${SANDBOX_WAKE_STOP_SETTLE_SECONDS:-$SANDBOX_WAKE_DEFAULT_STOP_SETTLE_SECONDS}"
    # The longest legitimate boundary wait is the headroom the caller asked for — you can never need to wait
    # longer than the gap you demanded. Overridable so the suites can drive the real wait without sleeping
    # for it, exactly as the timeout/poll knobs above are.
    local max_wait="${SANDBOX_WAKE_MAX_BOUNDARY_WAIT_SECONDS:-$required}"

    if ! [[ $timeout =~ ^[0-9]+$ ]] || ! [[ $poll =~ ^[0-9]+$ ]]; then
        echo "sandbox-wake: SANDBOX_WAKE_TIMEOUT_SECONDS/SANDBOX_WAKE_POLL_SECONDS must be whole seconds, got '${timeout}'/'${poll}'" >&2

        return 2
    fi

    if ! [[ $required =~ ^[0-9]+$ ]] || ! [[ $settle =~ ^[0-9]+$ ]] || ! [[ $max_wait =~ ^[0-9]+$ ]]; then
        echo "sandbox-wake: SANDBOX_WAKE_REQUIRED_HEADROOM_SECONDS/SANDBOX_WAKE_STOP_SETTLE_SECONDS/SANDBOX_WAKE_MAX_BOUNDARY_WAIT_SECONDS must be whole seconds, got '${required}'/'${settle}'/'${max_wait}'" >&2

        return 2
    fi

    # ⛔ Range-checked HERE, before discovery, rather than only inside `sandbox_wake_headroom` further down.
    # An unsatisfiable headroom is a configuration error, and a configuration error should not cost a round
    # trip to the RDS and EC2 APIs first — the same reason the allocator in `packages/infra/alb` range-checks
    # its own output instead of letting the deploy discover it.
    if [ "$required" -ge "$SANDBOX_WAKE_MIN_SCHEDULE_PERIOD_SECONDS" ]; then
        echo "sandbox-wake: a required headroom of ${required}s can never be satisfied — consecutive 00:00 ${SANDBOX_WAKE_SCHEDULE_TZ} stops are as little as ${SANDBOX_WAKE_MIN_SCHEDULE_PERIOD_SECONDS}s apart (spring-forward)." >&2

        return 2
    fi

    local discovered
    discovered=$(db_wake_discover "$region") || {
        echo "::error::sandbox-wake could not list RDS instances in ${region}. Refusing to deploy blind: a stopped sandbox database wedges the stack in UPDATE_ROLLBACK_FAILED (ADR-0007 × ADR-0022)."

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

    # ⛔ Abort the WHOLE run, before anything mutating. The server-side query already filters to the
    # sandbox prefix, so an identifier arriving here that the anchored predicate rejects means the naming
    # assumption this script is built on no longer holds — and the neighbouring instance in this account is
    # production. Acting on "the ones that did pass" would be acting on a premise that just failed.
    if [ "${#refused[@]}" -gt 0 ]; then
        echo "::error::sandbox-wake discovered non-sandbox DB instance(s) [${refused[*]}] under the sandbox prefix filter. Nothing was started. This account also holds the PRODUCTION database, so a scope surprise is refused rather than worked around."

        return 1
    fi

    if [ "${#valid[@]}" -eq 0 ]; then
        echo "::error::sandbox-wake found no DB instance named '${DB_WAKE_SANDBOX_PREFIX}*' in ${region}. Either the shared sandbox database is gone or its identifier changed — both need a human, and deploying past it wedges the stack."

        return 1
    fi

    # ⛔ BEFORE the wake, not after it. The question this answers — "will the instance still be up when the
    # caller finishes?" — is the one the loop below structurally cannot answer, and it must be settled while
    # nothing has been started yet. `valid[0]` is the instance to watch: there is exactly one shared sandbox
    # database, and a second one appearing is already refused above.
    #
    # ⚠️ The status is PROPAGATED, not collapsed to 1. This file's contract reserves 2 for misuse, and
    # `|| return 1` would have reported a mis-set headroom knob as "the database is not available" — sending
    # the reader to RDS for a problem that is in the environment.
    local await_status
    sandbox_wake_await_boundary "$region" "${valid[0]}" "$required" "$settle" "$poll" "$max_wait"
    await_status=$?

    if [ "$await_status" -ne 0 ]; then
        return "$await_status"
    fi

    local failed=0
    for identifier in "${valid[@]}"; do
        db_wake_instance "$region" "$identifier" "$timeout" "$poll" || failed=1
    done

    # ⛔ BOTH halves run, even when the first one failed — `|| failed=1` rather than `&&`. A deploy needs the
    # database AND the NAT, so reporting only the first failure would send the operator back for a second
    # round trip to learn the second. One run, both verdicts.
    nat_wake_ensure "$region" "$timeout" "$poll" || failed=1

    return "$failed"
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
        ensure)
            shift
            sandbox_wake_ensure "$@"
            ;;
        *)
            echo 'usage: sandbox-wake.sh classify <status> | classify-ec2 <state> | is-sandbox-instance <identifier> | is-sandbox-nat <nameTag> | next-stop <epoch> | headroom <epoch> <requiredSeconds> | ensure <region>' >&2
            exit 2
            ;;
    esac
fi
