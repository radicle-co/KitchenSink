#!/usr/bin/env bash
#
# The scheduled reaper's discovery and decision: which previews have outlived their day.
#
# ⚠️  DELIBERATE — read docs/architecture/decisions/0028-on-demand-sandbox.md and the header of
#     .github/workflows/sandboxReap.yml before changing this. The workflow owns WHEN a sweep runs; this file
#     owns WHO a sweep reaps; `sandboxDown.yml` owns HOW.
#
# ## Where the facts come from
#
# Nothing here maintains state. A preview's lifecycle is read from the two systems that already hold it:
#
#   - **CloudFormation** says what EXISTS. A `kitchensink-<service>-pr-{N}` stack existing IS "this PR has a
#     sandbox"; its `LastUpdatedTime` IS "when was it last deployed". Neither can be forgotten, and no deploy
#     can erase them.
#   - **GitHub** (`gh pr view`) says whether the pull request is still open.
#
# ## ⛔ THIS FILE CANNOT DESTROY PRODUCTION
#
# It never names a target. It derives `{N}` from a stack name matching `kitchensink-*-pr-{N}`, re-validates the
# token with `pr_scope_is_token`, and hands the DIGITS to `sandboxDown.yml`, which builds `pr-{N}` itself.
# Production and the shared sandbox tier carry no `pr-{N}` in their names, so they are never candidates. It
# never calls the teardown script directly — `sandboxReclamationReachability.test.ts` pins the set of jobs that
# may. See `sandboxDestroyTargetSafety.test.ts` for the three layers.
#
# ## Shape
#
# The decisions are PURE — text or values in, verdict out, no AWS, no `gh`, no clock — and are regression-tested
# by executing this file in packages/infra/global/__tests__/sandboxReap.test.ts. All I/O lives in
# `sandbox_reap_evaluate`, which tests/sandboxReap.integration.test.ts drives against stubbed `aws`, `gh` and
# `date`.
#
# Usage — as a CLI:
#     sandboxReap.sh tokens          < <list-stacks text output>      # pure: pr-{N} tokens, one per line
#     sandboxReap.sh latest-deploy   < <describe-stacks time rows>    # pure: the newest instant
#     sandboxReap.sh due-by          <nowEpoch>                       # pure: the look-ahead instant
#     sandboxReap.sh decide          <prState> <expired:true|false>   # pure: action= and reason=
#     sandboxReap.sh evaluate        <ref>                            # impure: the whole sweep
#
# Exit status: 0 = success, 1 = the sweep ran but something in it failed, 2 = misuse (never read as "nothing to
# reap").
set -uo pipefail

SANDBOX_REAP_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=./prScope.sh
source "${SANDBOX_REAP_SCRIPT_DIR}/prScope.sh"
# shellcheck source=./cfnRestingStates.sh
source "${SANDBOX_REAP_SCRIPT_DIR}/cfnRestingStates.sh"

# ⛔ REAP WHAT IS ABOUT TO EXPIRE, NOT ONLY WHAT ALREADY HAS — so the sweep lands BEFORE the nightly shutdown
# rather than 17 minutes after it.
#
# A preview's deadline is midnight America/New_York, and ADR-0007's scheduler stops the sandbox RDS and the NAT
# at exactly 00:00 ET. Reaping strictly on "now > deadline" puts the first eligible sweep at 00:17 — seventeen
# minutes into the shutdown — and the teardown needs that database to drop the per-PR logical databases
# (ADR-0006), so it wakes the RDS and the NAT straight back up. Measured on a real run: ~5 minutes waiting for
# `available`. Midnight is also the hour when a day's previews all come due, so it is the most likely sweep and
# the worst one to run.
#
# The look-ahead makes the 23:17 ET sweep claim everything due at 00:00, while the tier is still up. ⚠️ The
# cost, stated: a preview dies up to one sweep early — at 23:17 rather than 00:00. Against a deadline that is
# already "midnight of the day you last deployed", 43 minutes is immaterial; waking the whole shared tier to
# reclaim it is not.
#
# ⛔ NOT a pre-midnight cron. GitHub's `schedule:` is UTC-only with no timezone support, so a fixed 03:47 UTC
# drifts an hour against ET twice a year — the scheduler dodges this by using EventBridge with
# `America/New_York`, which Actions cannot do. Staying hourly is what makes this DST-proof: whichever hour
# midnight falls in, some sweep precedes it.
SANDBOX_REAP_LOOKAHEAD_SECONDS=4500

# sandbox_reap_tokens
#
# Read `list-stacks --output text` on stdin; print every distinct `pr-{N}` token that owns at least one stack,
# one per line. Pure.
#
# ⚠️ Discovery is by stack NAME, not by tag. A tag is written by a deploy and can be stripped by one; the name is
# fixed at creation and is the only identifier a half-failed deploy cannot lose.
sandbox_reap_tokens() {
    tr '\t' '\n' | sed -nE 's/^kitchensink-[a-z-]+-(pr-[0-9]+)$/\1/p' | sort -u
}

# sandbox_reap_latest_deploy
#
# Read `describe-stacks` `[LastUpdatedTime, CreationTime]` rows on stdin; print the most recent instant. Pure.
#
# The most recent deploy across ALL of a preview's stacks: a preview is one thing even though it is six stacks,
# and its schema stack is often days older than its service — taking the oldest would reap a preview that was
# deployed to an hour ago.
#
# ⚠️ Exits non-zero when every instant is `None` (a never-updated stack reports `LastUpdatedTime` as `None`):
# `grep -v` exits 1 when it filters everything out, and under `pipefail` that is indistinguishable from the
# describe failing — the caller skips the preview either way, which is the point.
sandbox_reap_latest_deploy() {
    tr '\t' '\n' | grep -v '^None$' | sort -r | head -1
}

# sandbox_reap_due_by <nowEpoch>
#
# Print the instant a sweep at <nowEpoch> judges deadlines against: now plus the look-ahead. Misuse exits 2
# without printing an instant. Pure.
sandbox_reap_due_by() {
    local now="${1-}"

    if ! [[ $now =~ ^[0-9]+$ ]]; then
        echo "sandbox-reap: <nowEpoch> must be a non-negative integer, got '${now}'" >&2
        return 2
    fi

    echo "$((now + SANDBOX_REAP_LOOKAHEAD_SECONDS))"
}

# sandbox_reap_decide <prState> <expired>
#
# Reap or keep one preview. Prints exactly two lines — `action=reap|keep` and `reason=closed|expired|live`. Pure.
#
# <prState> is GitHub's pull-request state (`OPEN`, `CLOSED`, `MERGED`) or `UNKNOWN` when `gh` could not say. It
# is free-form on purpose: anything but an exact `CLOSED`/`MERGED` is NOT a closure, so a failed or surprising
# answer can only ever fall back to the clock. <expired> is `sandboxLifetime.sh is-expired`'s verdict.
#
# An OPEN pull request is not protection from the deadline — it is what makes the deadline "midnight of your
# last deploy" rather than "never". A CLOSED one is reaped regardless of the clock: its on-close cleanup either
# already ran, or failed, and this is the retry.
#
# Misuse exits 2 WITHOUT printing a verdict.
sandbox_reap_decide() {
    if [ "$#" -ne 2 ]; then
        echo "usage: sandboxReap.sh decide <prState> <expired:true|false>" >&2
        return 2
    fi

    local state="$1" expired="$2"

    case "$expired" in true | false) ;; *)
        echo "sandbox-reap: <expired> must be 'true' or 'false', got '${expired}'" >&2
        return 2
        ;;
    esac

    if [ "$state" = 'CLOSED' ] || [ "$state" = 'MERGED' ]; then
        printf 'action=reap\nreason=closed\n'
    elif [ "$expired" = 'true' ]; then
        printf 'action=reap\nreason=expired\n'
    else
        printf 'action=keep\nreason=live\n'
    fi
}

# sandbox_reap_list_stacks
#
# Print the name of every stack in a resting state, as `list-stacks --output text` does.
#
# ⛔ The SAME status list the teardown sweeps (`cfnRestingStates.sh`), FAILED variants included: a preview
# wedged in `UPDATE_ROLLBACK_FAILED` is exactly what a reaper exists to retry, and a narrower list makes it
# invisible behind "nothing to reap".
#
# @sideEffect Calls the CloudFormation API.
sandbox_reap_list_stacks() {
    aws cloudformation list-stacks \
        --stack-status-filter "${CFN_RESTING_STATES[@]}" \
        --query 'StackSummaries[].StackName' --output text
}

# sandbox_reap_stack_times <token>
#
# Print `LastUpdatedTime<TAB>CreationTime` for every stack whose name ends in `-<token>`.
#
# ⚠️ <token> is interpolated into a JMESPath expression, which the AWS CLI cannot parameterise. It is safe for a
# stated reason rather than by luck: this function refuses anything `pr_scope_is_token` does not accept, so what
# reaches the query is `^pr-[0-9]+$` and can carry no backtick, quote or bracket. ⛔ Do not remove that check on
# the grounds that the caller already validated — this function is callable on its own.
#
# @sideEffect Calls the CloudFormation API.
sandbox_reap_stack_times() {
    local token="${1-}"

    if ! pr_scope_is_token "$token"; then
        echo "sandbox-reap: refusing to query stacks for '${token}', which is not a pr-{N} token" >&2
        return 2
    fi

    aws cloudformation describe-stacks \
        --query "Stacks[?ends_with(StackName, \`-${token}\`)].[LastUpdatedTime, CreationTime]" \
        --output text 2>/dev/null
}

# sandbox_reap_pr_state <number>
#
# Print the pull request's state, or `UNKNOWN` when GitHub cannot say. `UNKNOWN` is never a closure (see
# `sandbox_reap_decide`), so this fallback can only defer a reap to the clock, never cause one.
#
# @sideEffect Calls the GitHub API.
sandbox_reap_pr_state() {
    gh pr view "$1" --json state --jq '.state' 2>/dev/null || echo UNKNOWN
}

# sandbox_reap_dispatch <number> <ref>
#
# Press `Sandbox Down` for PR <number>, on <ref>.
#
# ⛔ DIGITS are handed over, never a token and never a stage. `sandboxDown.yml` builds `pr-{N}` from them
# itself, which is what makes "destroy production" not a value this dispatch can express.
#
# ⛔ `--ref` IS REQUIRED, and its absence is not a style detail. `gh workflow run` with no ref targets the
# DEFAULT BRANCH, and a branch-only workflow does not exist there — GitHub answers `HTTP 422: Workflow does not
# have 'workflow_dispatch' trigger`, which names the wrong cause and sends the reader looking at triggers that
# are perfectly correct. Measured on this reaper's first real run: it identified pr-91, judged it expired, and
# could not press the button. Dispatching the sweep's own ref is also the right semantics once the file is on
# main: the teardown that reclaims a preview is the one from the same commit as the reaper deciding to reclaim
# it.
#
# @sideEffect Dispatches a GitHub Actions workflow.
sandbox_reap_dispatch() {
    local number="${1-}" ref="${2-}"

    if ! [[ $number =~ ^[0-9]+$ ]] || [ -z "$ref" ]; then
        echo "sandbox-reap: dispatch needs a PR number and a ref, got '${number}' '${ref}'" >&2
        return 2
    fi

    gh workflow run sandboxDown.yml --ref "$ref" -f pr="$number"
}

# sandbox_reap_evaluate <ref>
#
# The whole sweep: discover every preview, decide each, and press `Sandbox Down` on those that are finished.
# Exits 1 when anything failed — a preview that could not be judged or dispatched — and 0 otherwise.
#
# ⛔ EVERY PER-PREVIEW FAILURE STAYS PER-PREVIEW. Each fallible step inside the loop is guarded and `continue`s,
# so one PR's bad luck decides nothing about the others; it only marks the run failed. That is also why this is
# ONE workflow step: `sandboxReclamationReachability.test.ts` analyzer 1 exists because a prerequisite step that
# aborts takes the reclamation with it.
#
# @sideEffect Calls CloudFormation and GitHub, dispatches workflows, reads the clock, writes stdout/stderr.
sandbox_reap_evaluate() {
    local ref="${1-}"

    if [ -z "$ref" ]; then
        echo "usage: sandboxReap.sh evaluate <ref>  (the ref Sandbox Down is dispatched on)" >&2
        return 2
    fi

    local now due_by
    now=$(date +%s) || {
        echo "::error::could not read the clock — this run reaped nothing and proved nothing" >&2
        return 1
    }
    due_by=$(sandbox_reap_due_by "$now") || {
        echo "::error::could not compute the look-ahead from '${now}' — this run reaped nothing" >&2
        return 1
    }

    local stacks tokens
    stacks=$(sandbox_reap_list_stacks) || {
        echo "::error::could not list stacks — this run reaped nothing and proved nothing" >&2
        return 1
    }
    tokens=$(printf '%s' "$stacks" | sandbox_reap_tokens) || {
        echo "::error::could not read the stack list — this run reaped nothing and proved nothing" >&2
        return 1
    }

    if [ -z "$tokens" ]; then
        echo "no per-PR previews exist — nothing to reap."
        return 0
    fi

    local failed=0 dispatched=0 kept=0
    local token number last last_epoch deadline expired state verdict action reason

    for token in $tokens; do
        # Belt: the extraction can only produce a pr-{N}, but the thing downstream of this loop DELETES
        # INFRASTRUCTURE, so the token is validated rather than trusted.
        if ! pr_scope_is_token "$token"; then
            echo "::error::refusing to act on '${token}', which is not a pr-{N} token" >&2
            failed=1
            continue
        fi
        number="${token#pr-}"

        last=$(sandbox_reap_stack_times "$token" | sandbox_reap_latest_deploy) || {
            echo "::warning::${token}: could not read its stacks — skipping this preview, the others still run"
            failed=1
            continue
        }

        if [ -z "$last" ]; then
            echo "::warning::${token}: could not read a deploy time — skipping it rather than guessing"
            failed=1
            continue
        fi
        last_epoch=$(date -u -d "$last" +%s 2>/dev/null) || {
            echo "::warning::${token}: unparseable deploy time '${last}' — skipping"
            failed=1
            continue
        }

        # ⚠️ The SAME pure clock the whole lifecycle uses, fed a deploy time. This file does no timezone
        # arithmetic of its own and so cannot disagree with `sandboxLifetime.sh`.
        deadline=$(bash "${SANDBOX_REAP_SCRIPT_DIR}/sandboxLifetime.sh" expires-at "$last_epoch" |
            sed -n 's/^expiresAt=//p') || {
            echo "::warning::${token}: could not compute a deadline — skipping this preview"
            failed=1
            continue
        }
        # ⚠️ `$due_by`, not `$now` — see SANDBOX_REAP_LOOKAHEAD_SECONDS. The clock itself is still
        # `sandboxLifetime.sh`'s; only the instant it is asked about moves.
        expired=$(bash "${SANDBOX_REAP_SCRIPT_DIR}/sandboxLifetime.sh" is-expired "$deadline" "$due_by" |
            sed -n 's/^expired=//p') || {
            echo "::warning::${token}: could not compare its deadline — skipping this preview"
            failed=1
            continue
        }

        state=$(sandbox_reap_pr_state "$number")

        verdict=$(sandbox_reap_decide "$state" "$expired") || {
            echo "::warning::${token}: no verdict for state '${state}', expired '${expired}' — skipping this preview"
            failed=1
            continue
        }

        action=$(printf '%s\n' "$verdict" | sed -n 's/^action=//p')
        reason=$(printf '%s\n' "$verdict" | sed -n 's/^reason=//p')

        # Exhaustive over the verdicts `sandbox_reap_decide` prints; anything else is skipped, never reaped.
        case "${action}:${reason}" in
            reap:closed)
                echo "${token}: PR #${number} is ${state} — reaping"
                ;;
            reap:expired)
                echo "${token}: last deployed ${last}, due at $(date -u -d "@${deadline}" +%FT%TZ) — reaping"
                ;;
            keep:live)
                echo "${token}: last deployed ${last}, live until $(date -u -d "@${deadline}" +%FT%TZ)"
                kept=$((kept + 1))
                continue
                ;;
            *)
                echo "::warning::${token}: unrecognised verdict '${action}:${reason}' — skipping this preview"
                failed=1
                continue
                ;;
        esac

        # ⚠️ THIS COUNTS A DISPATCH, NOT A RECLAMATION, and the wording below says so. The teardown runs in
        # ANOTHER workflow: `gh workflow run` returns the moment the dispatch is accepted, so this loop cannot
        # know whether the preview was actually reclaimed — `Sandbox Down` may still fail on a stuck stack or a
        # missing secret. Reporting "reaped 1" for a request that was merely made is green-having-done-nothing,
        # one indirection out.
        #
        # ⛔ Do NOT "fix" it by waiting: each teardown wakes the shared RDS and takes minutes, so watching them
        # serially would make an hourly sweep outlast its own interval. The dispatched runs report their own
        # outcome, and a preview that survives a failed teardown is picked up by the NEXT sweep — which is what
        # makes the loop a reconciler rather than a one-shot.
        if sandbox_reap_dispatch "$number" "$ref"; then
            dispatched=$((dispatched + 1))
        else
            echo "::error::could not dispatch Sandbox Down for #${number} — ${token} is still live" >&2
            failed=1
        fi
    done

    echo "dispatched ${dispatched} teardown(s), kept ${kept} — a dispatch is a REQUEST; each Sandbox Down run reports whether it reclaimed anything"
    return "$failed"
}

# Sourced by tests for the functions; executed by CI for the subcommands.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    case "${1-}" in
        tokens)
            sandbox_reap_tokens
            ;;
        latest-deploy)
            sandbox_reap_latest_deploy
            ;;
        due-by)
            shift
            sandbox_reap_due_by "$@"
            ;;
        decide)
            shift
            sandbox_reap_decide "$@"
            ;;
        evaluate)
            shift
            sandbox_reap_evaluate "$@"
            ;;
        *)
            echo "usage: sandboxReap.sh {tokens|latest-deploy|due-by <now>|decide <prState> <expired>|evaluate <ref>}" >&2
            exit 2
            ;;
    esac
fi
