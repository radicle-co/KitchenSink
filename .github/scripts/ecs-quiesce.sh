#!/usr/bin/env bash
#
# Drain a per-PR preview's ECS services and tasks BEFORE its stacks are deleted.
#
# ⚠️  THIS IS AN ORDERING FIX, NOT A RETRY. Retrying the same delete cannot work: the delete fails on a
# precondition that only draining removes, so a retry loop fails for exactly as long as the reference stands.
#
# ## The defect
#
# Deleting a per-PR service stack fails on its ECS cluster:
#
#     FoodServiceClusterDC51C960  AWS::ECS::ClusterCapacityProviderAssociations  DELETE_FAILED
#       "The specified capacity provider is in use and cannot be removed."
#       (Service: AmazonECS; Status Code: 400; Error Code: ResourceInUseException)
#
# CloudFormation deletes the ECS *service* before the association, but `DeleteService` returns while the
# service is still DRAINING its tasks. CloudFormation moves on, reaches the association a moment later, and
# ECS still considers the FARGATE_SPOT capacity provider referenced — so the association, and therefore the
# cluster, and therefore the stack, fail to delete. The stack lands in `DELETE_FAILED` with the cluster and
# its Container Insights still in place.
#
# ## Why this only ever bites non-prod (ADR-0008)
#
# ADR-0008 runs non-prod Fargate tasks on `FARGATE_SPOT` to cut cost. Binding a service to a capacity
# provider requires the cluster to advertise it, so the CDK sets `enableFargateCapacityProviders: useSpot`
# (`food-service-stack.ts`, `recipe-service-stack.ts`, `identity-service-stack.ts`) — which emits an
# `AWS::ECS::ClusterCapacityProviderAssociations` resource **only when `useSpot` is true**. Verified against
# the live account: `kitchensink-food-service-prod` has no such resource, `kitchensink-food-service-pr-81`
# does. So the cost lever introduced a teardown defect that exists exclusively in the stages that get torn
# down, and prod — which is never deleted — is the only stage that cannot hit it. That is why this went
# unnoticed: the code path that breaks is the one no prod deploy exercises.
#
# ## What this does
#
# For every ECS cluster tagged `Environment=pr-{N}`: delete each service with `--force` (which scales it to
# zero and removes the reference outright), stop any standalone task (the food change-refresh `RunTask` also
# binds FARGATE_SPOT), then WAIT for both to finish using the AWS CLI's own waiters rather than a hand-rolled
# poll. Only then may the caller delete the stacks. CloudFormation tolerates the services already being gone
# — `DeleteService` on an absent service is a successful delete — so this removes a failure mode without
# taking ownership of anything away from CloudFormation.
#
# ## Scope
#
# Clusters are discovered ONLY by an exact `Environment=pr-{N}` tag match — the same authority that already
# licenses `teardown-sandbox-pr.sh` to delete whole stacks, so this widens nothing. The `pr-{N}` token is
# validated through the shared `pr-scope.sh` guard first, and the shared persistent tier is tagged
# `Environment=global`, so it can never be selected. Note that the per-PR cluster NAME
# (`kitchensink-{service}-pr-{N}-…Cluster…`) is deliberately NOT used for matching: `pr_scope_belongs` is a
# prefix rule and would not match it, and loosening that rule is exactly what ADR-0005 forbids.
#
# Usage:
#     ecs-quiesce.sh <pr-N> [region]
#
# Exit status: 0 = every discovered cluster is drained (including the common case of none), 1 = at least one
# drain step failed (the caller should treat the teardown as incomplete), 2 = misuse.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./pr-scope.sh
. "$SCRIPT_DIR/pr-scope.sh"

# ecs_quiesce_clusters <pr> <region>
#
# Print the ARN of every ECS cluster tagged `Environment=<pr>`, one per line. Empty output is a legitimate
# and common answer (a PR that deployed no service at all).
#
# @sideEffect calls the AWS resource-groups tagging API
ecs_quiesce_clusters() {
    local pr="$1" region="$2"

    aws resourcegroupstaggingapi get-resources --region "$region" \
        --tag-filters "Key=Environment,Values=$pr" \
        --resource-type-filters ecs:cluster \
        --query 'ResourceTagMappingList[].ResourceARN' --output text 2>/dev/null |
        tr '\t' '\n' | grep ':cluster/' || true
}

# ecs_quiesce_cluster <cluster-arn> <region>
#
# Remove every reference to the cluster's capacity providers: delete its services (forced), stop its
# standalone tasks, and wait for both to settle. Returns non-zero if any step failed.
#
# @sideEffect deletes ECS services and stops ECS tasks in the given cluster
ecs_quiesce_cluster() {
    local cluster="$1" region="$2"
    local failed=0
    local services tasks svc task

    services=$(aws ecs list-services --region "$region" --cluster "$cluster" \
        --query 'serviceArns[]' --output text 2>/dev/null | tr '\t' '\n' | grep -v '^$' || true)

    for svc in $services; do
        echo "[ecs-quiesce] delete service ${svc##*/} (force)"
        aws ecs delete-service --region "$region" --cluster "$cluster" --service "$svc" --force >/dev/null ||
            {
                echo "::warning::could not delete ECS service $svc"
                failed=1
            }
    done

    # Standalone tasks are NOT owned by a service — the food change-refresh RunTask is one, and it binds
    # FARGATE_SPOT too, so a task left running holds the association exactly as a service does.
    tasks=$(aws ecs list-tasks --region "$region" --cluster "$cluster" \
        --query 'taskArns[]' --output text 2>/dev/null | tr '\t' '\n' | grep -v '^$' || true)

    for task in $tasks; do
        echo "[ecs-quiesce] stop task ${task##*/}"
        aws ecs stop-task --region "$region" --cluster "$cluster" --task "$task" \
            --reason 'per-PR sandbox teardown' >/dev/null || {
            echo "::warning::could not stop ECS task $task"
            failed=1
        }
    done

    # The CLI's own waiters, deliberately, instead of a hand-rolled poll loop: they already encode the
    # correct terminal states and back-off. Without this wait the whole exercise is pointless — the
    # delete/stop calls above are asynchronous, and returning early reproduces the very race being fixed.
    if [ -n "$services" ]; then
        echo "[ecs-quiesce] waiting for services to become inactive"
        # shellcheck disable=SC2086  # word splitting is intended: one --services arg per ARN
        aws ecs wait services-inactive --region "$region" --cluster "$cluster" --services $services || {
            echo "::warning::timed out waiting for services in $cluster to drain"
            failed=1
        }
    fi

    if [ -n "$tasks" ]; then
        echo "[ecs-quiesce] waiting for tasks to stop"
        # shellcheck disable=SC2086  # word splitting is intended: one --tasks arg per ARN
        aws ecs wait tasks-stopped --region "$region" --cluster "$cluster" --tasks $tasks || {
            echo "::warning::timed out waiting for tasks in $cluster to stop"
            failed=1
        }
    fi

    return "$failed"
}

# ecs_quiesce_pr <pr> <region>
#
# Drain every cluster belonging to <pr>. Non-zero if any cluster failed to drain.
#
# @sideEffect deletes ECS services and stops ECS tasks across the PR's clusters
ecs_quiesce_pr() {
    local pr="$1" region="$2"
    local failed=0 found=0 cluster

    for cluster in $(ecs_quiesce_clusters "$pr" "$region"); do
        found=1
        echo "[ecs-quiesce] draining ${cluster##*/}"
        ecs_quiesce_cluster "$cluster" "$region" || failed=1
    done

    if [ "$found" -eq 0 ]; then
        echo "[ecs-quiesce] no ECS clusters tagged Environment=$pr — nothing to drain."
    fi

    return "$failed"
}

# CLI dispatch — only when executed directly, never when sourced.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    PR="${1:?usage: ecs-quiesce.sh <pr-N> [region]}"
    REGION="${2:-${REGION:-us-east-1}}"

    if ! pr_scope_is_token "$PR"; then
        echo "refusing to quiesce a non pr-{N} token: '$PR'" >&2
        exit 2
    fi

    ecs_quiesce_pr "$PR" "$REGION"
fi
