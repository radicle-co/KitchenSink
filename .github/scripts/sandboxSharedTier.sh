#!/usr/bin/env bash
#
# Delete the SHARED sandbox tier's reclaimable stacks — the on-demand half of ADR-0028.
#
# ⚠️  READ THIS BEFORE EDITING. Every other teardown in this repository is safe because it only ever matches
# `pr-{N}` (ADR-0005, `prScope.sh`). This script is the single exception: it deletes stacks whose names end
# in `-sandbox`, which is precisely the shape `prScope.sh` exists to protect. Nothing about the NAME makes
# an operation here safe, so safety is an explicit, pinned ALLOWLIST of two exact stack names and a refusal
# for anything else — asserted by `packages/tools/repoGuards/__tests__/sandboxSharedTier.test.ts`, which fires
# the predicate at the shared database, the network stack, the webhooks and both prod stacks.
#
# ## Why these two, and why nothing else
#
# ADR-0028 made previews on-demand but left a residual floor: the sandbox ALB (~$16.43/mo) plus its two
# public IPv4 addresses (~$7.30/mo), billed around the clock for an environment that exists a few hours a
# week. An ALB cannot be stopped, only deleted — so unlike the RDS instance and the NAT instance, which the
# scheduler Lambda stops and starts, the ALB has to be destroyed and rebuilt.
#
# CloudFormation refuses to delete a stack whose exports are imported, and `kitchensink-alb-sandbox` has
# exactly ONE importer left now that the per-PR stacks are reaped: `kitchensink-identity-service-sandbox`
# (it imports SharedAlbHttpsListenerArn, SharedAlbDnsName and SharedAlbCanonicalHostedZoneId to attach its
# host rule and its A-record). So the identity service comes out first, or neither comes out at all.
#
# ⚠️ `kitchensink-identity-schema-sandbox` joins the list as the OWNER'S RULING (2026-09-06), not because
# anything forces it: it holds one Lambda, imports only the persistent network/data exports, publishes no
# export anybody imports, and costs nothing while idle — so it blocks no deletion and reclaiming it saves
# no money. It comes out WITH the tier for uniformity with the per-PR schema stacks, which are reaped by
# tag like every other `pr-{N}` resource. Its place in the order is free for the same reason: nothing
# imports it, so it cannot deadlock in either position.
#
# ⛔ What is NOT in the list, and must never be added:
#   - `kitchensink-data-sandbox`     — the RDS instance and every per-PR logical database (ADR-0006). The
#                                      scheduler STOPS this; deleting it destroys data.
#   - `kitchensink-network-sandbox`  — the VPC, the NAT instance and the shared security groups.
#   - `kitchensink-identity-webhooks-sandbox` — Lambdas + API Gateway, no ALB dependency, and the `e2e-web`
#                                      Playwright suite's Clerk fixture blocks on this webhook backfilling
#                                      `external_id`. Deleting it breaks CI on every branch.
#   - anything `-prod`.
#
# ## The order is a MIRROR and must not be "simplified"
#
# Create (sandboxUp.yml → sandbox-identity-deploy.yml): ALB first, then the identity service that imports
# it. Delete: identity service first, then the ALB. Reversing either half deadlocks on export-in-use, and a
# failure in the first step ABORTS before the second rather than leaving an ALB whose importer is gone —
# the same shape as ADR-0005's preview-domain pair, for the same reason.
#
#   sandboxSharedTier.sh order                     # pure: the delete order, one stack per line
#   sandboxSharedTier.sh may-delete NAME           # pure: exit 0 = in the allowlist, 1 = refused, 2 = misuse
#   sandboxSharedTier.sh live-tokens < names       # pure: the `pr-{N}` tokens that still own a stack
#   sandboxSharedTier.sh down [region]             # delete the allowlist, in order, idempotently
#   sandboxSharedTier.sh release-if-idle [region]  # `down`, but only when no preview is left or being started
#   sandboxSharedTier.sh release-in-progress [region]  # 0 = clear, 3 = a release is under way, 1 = cannot tell
#   sandboxSharedTier.sh anchor                    # pure: the stack whose absence means the tier is released
#   sandboxSharedTier.sh standing [region]         # 0 = the anchor stack stands, 3 = released, 1 = cannot tell
#
# ## When the tier is released (ADR-0060)
#
# Sandbox Down runs `release-if-idle` after tearing its PR down, so the LAST preview to go takes the ALB and the
# identity service with it; the manual reconciler runs the same verb. ONE definition of "idle", for both.
#
# ⛔ The idle question is asked again before EVERY delete, not once: the deletes take minutes, and a Sandbox Up pressed
# inside that window used to find the ALB still standing, build on it, and have it deleted underneath. The other half
# is `release-in-progress`, which Sandbox Up asks BEFORE it starts and which refuses while a release is under way. Each
# side sees the other (a running Up is `busy` here; a running Down or a stack mid-delete is `in progress` there), so
# neither can begin after the other has passed its own check.
set -uo pipefail


# ⛔ THE ALLOWLIST, in DELETE order (importer before exporter). This is the security boundary of this
# script. Adding a name here is a decision about destroying shared infrastructure, not a refactor.
SHARED_TIER_DELETE_ORDER=(
    'kitchensink-identity-service-sandbox'
    'kitchensink-identity-schema-sandbox'
    'kitchensink-alb-sandbox'
)

# The stack whose absence MEANS the tier has been released: the ALB, the exporter every other entry imports from, so it
# is the last to be deleted and the first to be built. A pull-request deploy reads it to decide that the tier is not
# its to rebuild (ADR-0060: only Sandbox Up starts it).
SHARED_TIER_ANCHOR='kitchensink-alb-sandbox'

# shared_tier_anchor
#
# Print the anchor stack's name. Pure.
shared_tier_anchor() {
    printf '%s\n' "$SHARED_TIER_ANCHOR"
}

# shared_tier_standing <region>
#
# Does the shared tier stand? Exit 0 = the anchor stack exists and is not on its way out, 3 = it does not (absent, or
# deleting), 1 = the lookup failed. "Could not tell" is never 0 and never 3: a throttled call must neither start a
# rebuild nor claim the tier is gone.
#
# @sideEffect Calls CloudFormation.
shared_tier_standing() {
    local region="$1" out status=0

    out=$(aws cloudformation describe-stacks --region "$region" --stack-name "$SHARED_TIER_ANCHOR" \
        --query 'Stacks[0].StackStatus' --output text 2>&1) || status=$?

    if [ "$status" -ne 0 ]; then
        case "$out" in
            *'does not exist'*)
                echo "${SHARED_TIER_ANCHOR}: absent"
                return 3
                ;;
            *)
                echo "could not read ${SHARED_TIER_ANCHOR}: ${out}" >&2
                return 1
                ;;
        esac
    fi

    case "$out" in
        DELETE_*)
            echo "${SHARED_TIER_ANCHOR}: ${out}"
            return 3
            ;;
        *) return 0 ;;
    esac
}

# shared_tier_order
#
# Print the delete order, one stack per line. Pure — no AWS calls, so the mirror can be asserted directly.
shared_tier_order() {
    printf '%s\n' "${SHARED_TIER_DELETE_ORDER[@]}"
}

# shared_tier_may_delete <stackName>
#
# Exit 0 if <stackName> is one of the two reclaimable shared-tier stacks, 1 otherwise, 2 on misuse.
# EXACT equality, never a prefix or a glob: `kitchensink-alb-sandbox-old` is not `kitchensink-alb-sandbox`,
# and a prefix match here would eventually claim something nobody meant to hand it.
shared_tier_may_delete() {
    local candidate="${1-}"
    [ -z "$candidate" ] && return 2

    local allowed
    for allowed in "${SHARED_TIER_DELETE_ORDER[@]}"; do
        [ "$candidate" = "$allowed" ] && return 0
    done

    return 1
}

# shared_tier_live_tokens
#
# Pure. Read stack names on stdin; print each `pr-{N}` that names a `kitchensink-<app>-pr-<N>` stack, once, sorted.
# Anchored: a name that merely CONTAINS a token (`…-pr-91-old`), the shared tier, production and the other
# application in this account all yield nothing.
shared_tier_live_tokens() {
    sed -nE 's/^kitchensink-[a-z-]+-(pr-[0-9]+)$/\1/p' | sort -u
}

# shared_tier_busy
#
# Print the workflows that are queued or running and could be standing a preview up, and exit 0 if any is, 1 if
# none. The set starts from every workflow that asks `sandboxWake.sh` whether the tier is up (the preview and
# identity deploys, and Sandbox Up), and then walks UP through every workflow that calls one of those with `uses:`,
# transitively. ⛔ The walk is the point: a CALLED workflow's runs belong to its caller, so GitHub lists nothing
# for `sandboxPreview.yml` while `ci-pr.yml` → `_ci.yml` → `sandboxPreview.yml` is creating a preview. A workflow
# GitHub cannot be asked about counts as BUSY: "could not tell" must never read as "nothing is running". The
# calling workflow (`$GITHUB_WORKFLOW_REF`) is not counted against itself.
#
# @sideEffect Reads `.github/workflows` and calls the GitHub API.
shared_tier_busy() {
    local self='' ref="${GITHUB_WORKFLOW_REF:-}" file base caller state count busy=''
    local -a queue=()
    local -A seen=()
    # `owner/repo/.github/workflows/<file>.yml@refs/heads/<branch>` — the branch can hold `/`, so cut at `@` first.
    [ -n "$ref" ] && self=$(basename "${ref%%@*}")

    for file in $(grep -l 'sandboxWake\.sh' .github/workflows/*.yml 2>/dev/null) .github/workflows/sandboxUp.yml; do
        base=$(basename "$file")
        [ -n "${seen[$base]:-}" ] && continue
        seen[$base]=1
        queue+=("$base")
    done

    while [ "${#queue[@]}" -gt 0 ]; do
        base="${queue[0]}"
        queue=("${queue[@]:1}")
        for caller in $(grep -lE "uses:[[:space:]]*\./\.github/workflows/${base//./\\.}([[:space:]]|$)" .github/workflows/*.yml 2>/dev/null); do
            caller=$(basename "$caller")
            [ -n "${seen[$caller]:-}" ] && continue
            seen[$caller]=1
            queue+=("$caller")
        done
    done

    for file in $(printf '%s\n' "${!seen[@]}" | sort); do
        [ "$file" = "${self:-<none>}" ] && continue
        for state in in_progress queued pending waiting requested; do
            if ! count=$(gh run list --workflow "$file" --status "$state" --limit 1 --json databaseId --jq 'length' 2>/dev/null); then
                busy="${busy} ${file}(unknown)"
                continue
            fi
            [ "${count:-0}" != '0' ] && busy="${busy} ${file}(${state})"
        done
    done

    if [ -n "${busy// /}" ]; then
        echo "busy:${busy}"
        return 0
    fi

    return 1
}

# shared_tier_release_if_idle <region>
#
# Release the shared tier only when NO preview is left and nothing is standing one up; otherwise say why it stays.
# Exit 0 when it released or rightly kept it, 1 when it could not tell or a delete failed.
#
# @sideEffect Lists and may delete CloudFormation stacks; calls the GitHub API.
shared_tier_release_if_idle() {
    local region="$1" names live why

    # Every status but DELETE_COMPLETE: a stack mid-CREATE is a preview being stood up and a stack mid-DELETE still
    # holds its import, so both count as "still there". The resting-state list the deploy gates use would read a
    # preview Sandbox Up is creating right now as absent. (A projection filter, not an index, so pagination is safe.)
    if ! names=$(aws cloudformation list-stacks --region "$region" \
        --query "StackSummaries[?StackStatus!='DELETE_COMPLETE'].StackName" --output text); then
        echo "::error::sandbox-shared-tier: could not list stacks — refusing to conclude no preview is left" >&2
        return 1
    fi

    live=$(printf '%s\n' "$names" | tr '\t' '\n' | shared_tier_live_tokens | tr '\n' ' ')
    if [ -n "${live// /}" ]; then
        echo "[shared-tier] kept: previews still own stacks — ${live}"
        return 0
    fi

    if why=$(shared_tier_busy); then
        echo "::notice::[shared-tier] kept: something may be standing a preview up (${why}); the next Sandbox Down or a manual reconcile releases it."
        return 0
    fi

    echo '[shared-tier] no preview is left and nothing is starting one — releasing the shared tier'
    shared_tier_down "$region" recheck-busy
}

# shared_tier_release_in_progress <region>
#
# Is the shared tier being released right now? Exit 0 = no (clear to start), 3 = yes (names why on stdout),
# 1 = could not tell. "Could not tell" is never 0: a lookup that fails must not read as "nothing is being deleted".
# A release is either a shared-tier stack mid-delete, or a workflow that deletes them (Sandbox Down, the manual
# reconciler) queued or running.
#
# @sideEffect Calls CloudFormation and the GitHub API; deletes nothing.
shared_tier_release_in_progress() {
    local region="$1" stack status workflow state count why='' unknown=''

    for stack in "${SHARED_TIER_DELETE_ORDER[@]}"; do
        # Only CloudFormation's own "does not exist" is an answer (an absent stack is not being deleted). Anything else
        # (throttling, expired credentials) says nothing about the stack, so it is UNKNOWN, never "clear".
        if status=$(aws cloudformation describe-stacks --region "$region" --stack-name "$stack" \
            --query 'Stacks[0].StackStatus' --output text 2>&1); then
            if [ "$status" = 'DELETE_IN_PROGRESS' ]; then
                why="${why} ${stack}(DELETE_IN_PROGRESS)"
            fi
        elif [[ "$status" != *'does not exist'* ]]; then
            unknown="${unknown} ${stack}"
        fi
    done

    # Every state in which a run exists but has not finished: a Sandbox Down that is still queued behind a concurrency
    # group is `pending`/`waiting`/`requested`, and is about to delete the tier all the same.
    for workflow in sandboxDown.yml sandboxReconcile.yml; do
        for state in in_progress queued pending waiting requested; do
            if ! count=$(gh run list --workflow "$workflow" --status "$state" --limit 1 --json databaseId --jq 'length' 2>/dev/null); then
                unknown="${unknown} ${workflow}"
                continue
            fi
            if [ "${count:-0}" != '0' ]; then
                why="${why} ${workflow}(${state})"
            fi
        done
    done

    if [ -n "${why// /}" ]; then
        echo "release in progress:${why}"
        return 3
    fi
    if [ -n "${unknown// /}" ]; then
        echo "could not tell whether a release is in progress (the lookup failed for:${unknown})" >&2
        return 1
    fi

    return 0
}

# shared_tier_down <region> [recheck-busy]
#
# With `recheck-busy`, ask `shared_tier_busy` again before EACH delete and stop (success, tier kept) the moment
# something is standing a preview up. Without it the reconciler's `down` verb deletes unconditionally, as before.
#
# Delete both stacks in mirror order. An absent stack is a SUCCESS (idempotent — the reconciler runs hourly
# and must converge, not alternate between green and red). A real failure aborts before the next stack.
#
# @sideEffect Deletes CloudFormation stacks.
shared_tier_down() {
    local region="$1" recheck="${2:-}" stack status why

    for stack in "${SHARED_TIER_DELETE_ORDER[@]}"; do
        # Belt and braces: the loop already reads the allowlist, but the predicate is what a future edit
        # will be tested against, so it is the thing that authorises.
        if ! shared_tier_may_delete "$stack"; then
            echo "::error::sandbox-shared-tier: refusing to delete '${stack}' — not in the allowlist" >&2
            return 1
        fi

        status=$(aws cloudformation describe-stacks --region "$region" --stack-name "$stack" \
            --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo ABSENT)

        if [ "$status" = 'ABSENT' ] || [ "$status" = 'None' ]; then
            echo "[shared-tier] ${stack}: already absent"
            continue
        fi

        if [ "$recheck" = 'recheck-busy' ] && why=$(shared_tier_busy); then
            echo "::notice::[shared-tier] kept from ${stack} on: something started a preview while the tier was being released (${why}); the next Sandbox Down or a manual reconcile releases the rest."
            return 0
        fi

        echo "[shared-tier] ${stack}: deleting (was ${status})"
        if ! aws cloudformation delete-stack --region "$region" --stack-name "$stack"; then
            echo "::error::sandbox-shared-tier: delete-stack failed for ${stack} — NOT continuing to the next stack" >&2
            return 1
        fi
        if ! aws cloudformation wait stack-delete-complete --region "$region" --stack-name "$stack" 2>/dev/null; then
            # The waiter also returns non-zero when the stack is simply gone by the time it polls, so the
            # verdict is re-read rather than trusted from the exit status.
            status=$(aws cloudformation describe-stacks --region "$region" --stack-name "$stack" \
                --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo ABSENT)
            if [ "$status" != 'ABSENT' ] && [ "$status" != 'None' ]; then
                echo "::error::sandbox-shared-tier: ${stack} did not delete (status ${status}) — NOT continuing, so the ALB keeps its importer" >&2
                return 1
            fi
        fi
        echo "[shared-tier] ${stack}: deleted"
    done

    return 0
}

# Sourced (`. sandboxSharedTier.sh`) exposes the functions; executed dispatches a verb.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    case "${1-}" in
        order) shared_tier_order ;;
        anchor) shared_tier_anchor ;;
        standing) shared_tier_standing "${2:-${REGION:-us-east-1}}" ;;
        may-delete) shared_tier_may_delete "${2-}" ;;
        live-tokens) shared_tier_live_tokens ;;
        down) shared_tier_down "${2:-${REGION:-us-east-1}}" ;;
        release-if-idle) shared_tier_release_if_idle "${2:-${REGION:-us-east-1}}" ;;
        release-in-progress) shared_tier_release_in_progress "${2:-${REGION:-us-east-1}}" ;;
        *)
            echo 'usage: sandboxSharedTier.sh {order|anchor|standing [region]|may-delete <stack>|live-tokens|down [region]|release-if-idle [region]|release-in-progress [region]}' >&2
            exit 2
            ;;
    esac
fi
