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
# Usage — as a CLI:
#     sandbox-wake.sh classify            <status>      # pure: ready | wake | wait | fatal   (RDS)
#     sandbox-wake.sh classify-ec2        <state>       # pure: ready | wake | wait | fatal   (EC2)
#     sandbox-wake.sh is-sandbox-instance <identifier>  # pure: exit 0 = yes, 1 = no, 2 = misuse
#     sandbox-wake.sh is-sandbox-nat      <nameTag>     # pure: exit 0 = yes, 1 = no, 2 = misuse
#     sandbox-wake.sh ensure              <region>      # impure: discover, wake, wait — bounded, BOTH
#
# Exit status: 0 = the sandbox database is available, 1 = it is not (annotated with `::error::`),
# 2 = misuse. Tuning knobs `SANDBOX_WAKE_TIMEOUT_SECONDS` / `SANDBOX_WAKE_POLL_SECONDS` exist ONLY so the suites can
# drive the real loop without sleeping for it.
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

    if ! [[ $timeout =~ ^[0-9]+$ ]] || ! [[ $poll =~ ^[0-9]+$ ]]; then
        echo "sandbox-wake: SANDBOX_WAKE_TIMEOUT_SECONDS/SANDBOX_WAKE_POLL_SECONDS must be whole seconds, got '${timeout}'/'${poll}'" >&2

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
            echo 'usage: sandbox-wake.sh classify <status> | classify-ec2 <state> | is-sandbox-instance <identifier> | is-sandbox-nat <nameTag> | ensure <region>' >&2
            exit 2
            ;;
    esac
fi
