#!/usr/bin/env bash
#
# Delete the SHARED sandbox tier's two reclaimable stacks — the on-demand half of ADR-0028.
#
# ⚠️  READ THIS BEFORE EDITING. Every other teardown in this repository is safe because it only ever matches
# `pr-{N}` (ADR-0005, `pr-scope.sh`). This script is the single exception: it deletes stacks whose names end
# in `-sandbox`, which is precisely the shape `pr-scope.sh` exists to protect. Nothing about the NAME makes
# an operation here safe, so safety is an explicit, pinned ALLOWLIST of two exact stack names and a refusal
# for anything else — asserted by `packages/infra/global/__tests__/sandboxSharedTier.test.ts`, which fires
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
# Create (sandbox-up.yml → sandbox-identity-deploy.yml): ALB first, then the identity service that imports
# it. Delete: identity service first, then the ALB. Reversing either half deadlocks on export-in-use, and a
# failure in the first step ABORTS before the second rather than leaving an ALB whose importer is gone —
# the same shape as ADR-0005's preview-domain pair, for the same reason.
#
#   sandbox-shared-tier.sh order            # pure: the delete order, one stack per line
#   sandbox-shared-tier.sh may-delete NAME  # pure: exit 0 = in the allowlist, 1 = refused, 2 = misuse
#   sandbox-shared-tier.sh down [region]    # delete both, in order, idempotently
set -uo pipefail

# ⛔ THE ALLOWLIST, in DELETE order (importer before exporter). This is the security boundary of this
# script. Adding a name here is a decision about destroying shared infrastructure, not a refactor.
SHARED_TIER_DELETE_ORDER=(
    'kitchensink-identity-service-sandbox'
    'kitchensink-alb-sandbox'
)

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

# shared_tier_down <region>
#
# Delete both stacks in mirror order. An absent stack is a SUCCESS (idempotent — the reconciler runs hourly
# and must converge, not alternate between green and red). A real failure aborts before the next stack.
#
# @sideEffect Deletes CloudFormation stacks.
shared_tier_down() {
    local region="$1" stack status

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

# Sourced (`. sandbox-shared-tier.sh`) exposes the functions; executed dispatches a verb.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    case "${1-}" in
        order) shared_tier_order ;;
        may-delete) shared_tier_may_delete "${2-}" ;;
        down) shared_tier_down "${2:-${REGION:-us-east-1}}" ;;
        *)
            echo 'usage: sandbox-shared-tier.sh {order|may-delete <stack>|down [region]}' >&2
            exit 2
            ;;
    esac
fi
