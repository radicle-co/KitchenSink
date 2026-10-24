#!/usr/bin/env bash
#
# Drop a PR's logical databases (ADR-0006) through the PLATFORM REAPER (ADR-0031) — now, or once the sandbox is up.
#
# ⚠️  DELIBERATE — read docs/architecture/decisions/0060-sandbox-starts-only-by-hand.md before changing this.
#
#   perPrDatabaseDrop.sh drop  <pr-N> <region>   # invoke the reaper for ONE PR, now
#   perPrDatabaseDrop.sh defer <pr-N> <region>   # the sandbox is down: record the drop as OWED
#   perPrDatabaseDrop.sh drain <region>          # the sandbox is up: pay every owed drop
#
# Exit 0 on success, 1 on failure, 2 on misuse.
#
# ## Why a drop can be OWED
#
# The reaper is an in-VPC Lambda against the shared sandbox database, and nothing may start that database for it: the
# sandbox starts only when Sandbox Up is pressed (owner ruling 2026-10-12). A PR usually closes while the sandbox is
# stopped, so its teardown cannot drop its databases then. Skipping is right. FORGETTING is a leak, because the
# teardown goes on to delete the PR's stacks and nothing would ever name that PR again.
#
# So the teardown that skips the drop RECORDS it (`defer`), in SSM under `OWED_PREFIX`, and `drain` pays every recorded
# drop when the tier is up — at the start of every Sandbox Up, and in Sandbox Down. ⛔ Recorded, never inferred:
# deriving "orphans" from what the database holds would be the "orphaned-looking sweep" ADR-0005 forbids. `drain` only
# ever drops a PR some teardown already decided to destroy.
#
# ⛔ The reaper is the ONE authority for how a per-PR database is dropped (`dropDatabaseAuthority.test.ts`). This file
# is the one place that INVOKES it, for the teardown and for the drain alike.
set -uo pipefail

PER_PR_DB_DROP_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./prScope.sh
source "$PER_PR_DB_DROP_SCRIPT_DIR/prScope.sh"
# shellcheck source=./sandboxSharedTier.sh
source "$PER_PR_DB_DROP_SCRIPT_DIR/sandboxSharedTier.sh"

# Where an owed drop is recorded: one parameter per PR, named by its token, valued with when it was deferred.
OWED_PREFIX='/kitchensink/sandbox/owed-per-pr-database-drops'

# per_pr_db_drop <pr-N> <region>
#
# Invoke the platform reaper for one PR. 0 = dropped (or nothing was there), 1 = not dropped.
#
# The persistent platform stage every `pr-{N}` preview rides (ADR-0006) is the reaper's home. Not derived from the
# token: a preview never has a platform of its own, and prod has no per-PR databases at all, so there is exactly one
# possible value. Overridable only so an integration harness can point at a fixture.
#
# @sideEffect Calls CloudFormation and Lambda; drops databases.
per_pr_db_drop() {
    local pr="$1" region="$2" reaper_stack="${TEARDOWN_DATA_STACK:-kitchensink-data-sandbox}" reaper_fn
    local result invoke err status=0

    reaper_fn=$(aws cloudformation describe-stacks --region "$region" --stack-name "$reaper_stack" \
        --query "Stacks[0].Outputs[?OutputKey=='PerPrDatabaseReaperFunctionName'].OutputValue | [0]" \
        --output text 2>/dev/null) || reaper_fn=""

    if [ -z "$reaper_fn" ] || [ "$reaper_fn" = "None" ]; then
        # NOT a silent skip. An absent reaper means the platform stack has not deployed ADR-0031 yet, or the output
        # was renamed — and either way this PR's logical databases are being left on the shared instance.
        echo "::error::$reaper_stack publishes no PerPrDatabaseReaperFunctionName (ADR-0031), so $pr's per-PR logical databases cannot be dropped and will be left behind. Deploy the global infra app, then re-run this teardown."

        return 1
    fi

    result=$(mktemp --suffix=.json)
    invoke=$(mktemp --suffix=.json)
    err=$(mktemp)
    if aws lambda invoke --region "$region" --function-name "$reaper_fn" \
        --payload "{\"action\":\"drop\",\"pr\":\"$pr\"}" --cli-binary-format raw-in-base64-out \
        "$result" >"$invoke" 2>"$err"; then
        # ⛔ `aws lambda invoke` EXITS 0 WHEN THE FUNCTION THREW — the throw is reported in its stdout, which is what
        # this greps. Reading the exit status alone reports a successful drop for a database still there.
        if grep -q '"FunctionError"' "$invoke"; then
            echo "::error::per-PR DB drop for $pr returned a FunctionError — the databases were NOT dropped and will be left behind. Inspect $reaper_fn logs."
            status=1
        else
            # The result carries BOTH what was dropped and a whole-instance census, so a run that reclaimed nothing
            # still says what is out there.
            echo "[db-drop] $reaper_fn result: $(cat "$result")"
        fi
    else
        # ⚠️ PRINT THE REASON. This branch used to send stderr to /dev/null, which cost a real diagnosis on 2026-08-27:
        # the invoke was failing with `Unknown options: --cli-binary-format` because the operator's shell resolved
        # AWS CLI **v1**, where that flag does not exist.
        echo "::error::could not invoke $reaper_fn to drop $pr's per-PR databases — they will be left behind"
        status=1
        sed 's/^/  [db-drop] /' "$err" >&2
        if grep -q 'cli-binary-format' "$err" 2>/dev/null; then
            echo "::error::this shell's \`aws\` is CLI v1 (\`--cli-binary-format\` is v2-only). Re-run with AWS CLI v2." >&2
        fi
    fi
    rm -f "$result" "$invoke" "$err"

    return "$status"
}

# per_pr_db_drop_defer <pr-N> <region>
#
# Record that <pr-N>'s databases are owed a drop. 0 = recorded, 1 = NOT recorded (the leak this exists to prevent).
#
# @sideEffect Writes an SSM parameter.
per_pr_db_drop_defer() {
    local pr="$1" region="$2"

    if ! aws ssm put-parameter --region "$region" --name "${OWED_PREFIX}/${pr}" --type String --overwrite \
        --value "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >/dev/null; then
        echo "::error::could not record that $pr's per-PR databases are owed a drop — they will be left behind unseen. Drop them with \`perPrDatabaseDrop.sh drop $pr\` once the sandbox is up."

        return 1
    fi
    echo "[db-drop] $pr's per-PR databases are owed a drop; the next Sandbox Up drains it"
}

# per_pr_db_drop_drain <region>
#
# Pay every owed drop, while the sandbox is up. A PR that owns a stack again (somebody stood it back up) keeps its
# debt: dropping its databases now would take them from under a live preview, and its own next teardown settles it.
# A DOWN sandbox pays nothing and is not a failure. 0 = nothing left to pay that could be paid, 1 = a drop failed or a
# question could not be answered.
#
# @sideEffect Reads SSM, CloudFormation, RDS and EC2; invokes the reaper; deletes SSM parameters.
per_pr_db_drop_drain() {
    local region="$1" names owed live pr check_status=0 status=0

    if ! names=$(aws ssm get-parameters-by-path --region "$region" --path "$OWED_PREFIX" \
        --query 'Parameters[].Name' --output text); then
        echo "::error::could not read the owed per-PR database drops — nothing was paid"

        return 1
    fi
    owed=$(printf '%s\n' "$names" | tr '\t' '\n' | sed -n "s#^${OWED_PREFIX}/##p" | sort -u)
    if [ -z "$owed" ]; then
        echo '[db-drop] no per-PR database drop is owed'

        return 0
    fi

    bash "$PER_PR_DB_DROP_SCRIPT_DIR/sandboxWake.sh" check "$region" || check_status=$?
    case "$check_status" in
        0) ;;
        3)
            echo "::notice::the shared sandbox is down, so the owed per-PR database drops wait for the next Sandbox Up: $(echo "$owed" | tr '\n' ' ')"

            return 0
            ;;
        *)
            echo "::error::could not tell whether the shared sandbox is up (exit $check_status) — no owed drop was paid"

            return 1
            ;;
    esac

    # Every status but DELETE_COMPLETE, for the reason `release-if-idle` gives: a stack mid-create is a preview being
    # stood up right now.
    if ! live=$(aws cloudformation list-stacks --region "$region" \
        --query "StackSummaries[?StackStatus!='DELETE_COMPLETE'].StackName" --output text); then
        echo "::error::could not list stacks — refusing to drop a database whose PR may be live"

        return 1
    fi
    live=$(printf '%s\n' "$live" | tr '\t' '\n' | shared_tier_live_tokens)

    while IFS= read -r pr; do
        [ -n "$pr" ] || continue
        if ! pr_scope_is_token "$pr"; then
            echo "::error::an owed drop is recorded under '${pr}', which is not a PR token — refusing it"
            status=1
            continue
        fi
        if printf '%s\n' "$live" | grep -qxF "$pr"; then
            echo "[db-drop] $pr owns a stack again — its drop stays owed until its own teardown"
            continue
        fi
        if per_pr_db_drop "$pr" "$region"; then
            if ! aws ssm delete-parameter --region "$region" --name "${OWED_PREFIX}/${pr}" >/dev/null; then
                echo "::warning::dropped $pr's per-PR databases but could not clear the record; the next drain drops nothing and clears it"
            fi
        else
            status=1
        fi
    done <<<"$owed"

    return "$status"
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    case "${1-}" in
        drop | defer)
            if ! pr_scope_is_token "${2-}" || [ -z "${3-}" ]; then
                echo "usage: perPrDatabaseDrop.sh $1 <pr-N> <region>  (got '${2-}')" >&2
                exit 2
            fi
            if [ "$1" = drop ]; then
                per_pr_db_drop "$2" "$3"
            else
                per_pr_db_drop_defer "$2" "$3"
            fi
            ;;
        drain)
            if [ -z "${2-}" ]; then
                echo 'usage: perPrDatabaseDrop.sh drain <region>' >&2
                exit 2
            fi
            per_pr_db_drop_drain "$2"
            ;;
        *)
            echo 'usage: perPrDatabaseDrop.sh {drop <pr-N> <region> | defer <pr-N> <region> | drain <region>}' >&2
            exit 2
            ;;
    esac
fi
