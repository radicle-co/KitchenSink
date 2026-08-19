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
# It never stops anything, never disables the nightly schedule, and never touches ECS or the NAT instance.
# Waking on demand for a real deploy is the point; keeping the tier awake is not (ADR-0007's cost intent
# stands). Callers gate it on their own "am I actually deploying?" decision, so an unchanged PR that skips
# its deploy does not wake the database.
#
# Usage — as a CLI:
#     db-wake.sh classify           <status>     # pure: ready | wake | wait | fatal
#     db-wake.sh is-sandbox-instance <identifier> # pure: exit 0 = yes, 1 = no, 2 = misuse
#     db-wake.sh ensure             <region>     # impure: discover, wake, wait — bounded
#
# Exit status: 0 = the sandbox database is available, 1 = it is not (annotated with `::error::`),
# 2 = misuse. Tuning knobs `DB_WAKE_TIMEOUT_SECONDS` / `DB_WAKE_POLL_SECONDS` exist ONLY so the suites can
# drive the real loop without sleeping for it.
#
# Regression-tested for real — the tests execute THIS file rather than re-implementing it — by
# packages/infra/global/__tests__/dbWake.test.ts, tests/dbWake.integration.test.ts, and
# __tests__/sandboxDbWakeWiring.test.ts (which asserts every sandbox deploy step is preceded by it).
set -uo pipefail

# The ONLY identifier prefix this script may act on. Derived from `DataStack`'s stack name
# (`kitchensink-data-{stage}`) plus the `{stackName}-{logicalId}-{hash}` identifier CDK generates when no
# explicit `instanceIdentifier` is given — e.g. `kitchensink-data-sandbox-databaseb269d8bb-p76w6xmz1xlk`.
DB_WAKE_SANDBOX_PREFIX='kitchensink-data-sandbox'

# How long to wait for a woken instance, in seconds. A stopped `db.t4g.micro` reaches `available` in
# roughly 3–7 minutes; 15 gives that comfortable headroom while keeping the failure BOUNDED. An unbounded
# wait would convert a fast, legible failure into a job that burns the runner's whole 6-hour limit.
DB_WAKE_DEFAULT_TIMEOUT_SECONDS=900

# Seconds between polls. Long enough not to hammer the RDS API across concurrent workflows, short enough
# that the deploy starts promptly once the instance is up.
DB_WAKE_DEFAULT_POLL_SECONDS=15

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
        echo "::error::db-wake refused '${identifier}' — not the shared sandbox database. Nothing was started."
        return 1
    fi

    deadline=$(($(date +%s) + timeout))

    while true; do
        status=$(db_wake_status "$region" "$identifier")
        class=$(db_wake_classify "$status")
        echo "[db-wake] ${identifier} → ${status} (${class})"

        case "$class" in
            ready)
                echo "[db-wake] ${identifier} is available — the migration Trigger can reach it."

                return 0
                ;;
            fatal)
                echo "::error::sandbox database ${identifier} is '${status}' — terminal or unrecognised, so a deploy would run its migration Trigger against an unusable instance. Fix the instance (or teach db-wake.sh this status) before redeploying."

                return 1
                ;;
            wake)
                echo "[db-wake] ${identifier} is stopped — issuing StartDBInstance."
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

# db_wake_ensure <region>
#
# THE entry point. Discover the sandbox database, refuse anything that is not it, and bring it to
# `available` within the bound.
#
# @sideEffect Calls the RDS API and may start the sandbox instance.
db_wake_ensure() {
    local region="${1-}"

    if [ "$#" -ne 1 ] || [ -z "$region" ]; then
        echo 'usage: db-wake.sh ensure <region>   (there is deliberately NO instance argument — see the header)' >&2

        return 2
    fi

    local timeout="${DB_WAKE_TIMEOUT_SECONDS:-$DB_WAKE_DEFAULT_TIMEOUT_SECONDS}"
    local poll="${DB_WAKE_POLL_SECONDS:-$DB_WAKE_DEFAULT_POLL_SECONDS}"

    if ! [[ $timeout =~ ^[0-9]+$ ]] || ! [[ $poll =~ ^[0-9]+$ ]]; then
        echo "db-wake: DB_WAKE_TIMEOUT_SECONDS/DB_WAKE_POLL_SECONDS must be whole seconds, got '${timeout}'/'${poll}'" >&2

        return 2
    fi

    local discovered
    discovered=$(db_wake_discover "$region") || {
        echo "::error::db-wake could not list RDS instances in ${region}. Refusing to deploy blind: a stopped sandbox database wedges the stack in UPDATE_ROLLBACK_FAILED (ADR-0007 × ADR-0022)."

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
        echo "::error::db-wake discovered non-sandbox DB instance(s) [${refused[*]}] under the sandbox prefix filter. Nothing was started. This account also holds the PRODUCTION database, so a scope surprise is refused rather than worked around."

        return 1
    fi

    if [ "${#valid[@]}" -eq 0 ]; then
        echo "::error::db-wake found no DB instance named '${DB_WAKE_SANDBOX_PREFIX}*' in ${region}. Either the shared sandbox database is gone or its identifier changed — both need a human, and deploying past it wedges the stack."

        return 1
    fi

    local failed=0
    for identifier in "${valid[@]}"; do
        db_wake_instance "$region" "$identifier" "$timeout" "$poll" || failed=1
    done

    return "$failed"
}

# CLI dispatch — only when executed directly, never when sourced.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    case "${1-}" in
        classify)
            db_wake_classify "${2-}"
            ;;
        is-sandbox-instance)
            db_wake_is_sandbox_instance "${2-}"
            ;;
        ensure)
            shift
            db_wake_ensure "$@"
            ;;
        *)
            echo 'usage: db-wake.sh classify <status> | is-sandbox-instance <identifier> | ensure <region>' >&2
            exit 2
            ;;
    esac
fi
