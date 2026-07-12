#!/usr/bin/env bash
#
# Tear down every ephemeral sandbox resource for ONE per-PR preview (PR = pr-{N}).
#
# Scoped strictly to pr-{N} by name OR Environment=pr-{N} tag, with a delimiter-aware match
# (pr-1 never matches pr-15). The shared persistent infra — global (network/data/domain/alb/global),
# the identity service + webhooks, and the RDS cluster — is named `*-sandbox`/`*-prod` and tagged
# `Environment=global`, so it never matches and is never touched (ADR-0005). This is the single source
# of truth used by BOTH the on-close cleanup job and the scheduled reaper, so the two cannot drift.
#
# Usage: teardown-sandbox-pr.sh <pr-N> [region]
set -uo pipefail

PR="${1:?usage: teardown-sandbox-pr.sh <pr-N> [region]}"
REGION="${2:-${REGION:-us-east-1}}"

# Hard guard: only ever operate on a pr-{N} token. Anything else (a bare stage name, a typo, an empty
# arg) is refused so this can never be pointed at shared infra.
case "$PR" in
    pr-[0-9]*) ;;
    *)
        echo "refusing to tear down a non pr-{N} token: '$PR'" >&2
        exit 2
        ;;
esac

echo "Tearing down ephemeral resources for: $PR (region $REGION)"

# belongs <name>: true iff <name> is exactly $PR or starts with "$PR-" (the trailing dash stops
# pr-1 from matching pr-15 / pr-100).
belongs() { case "$1" in "$PR" | "$PR"-*) return 0 ;; *) return 1 ;; esac; }
# path_belongs: same, but also matches a "$PR" / "$PR-" segment inside a path (e.g. an auto-created
# /aws/ecs/containerinsights/$PR-cluster.../performance log group).
path_belongs() {
    belongs "$1" && return 0
    case "$1" in *"/$PR" | *"/$PR-"* | *"/$PR/"*) return 0 ;; *) return 1 ;; esac
}

## 0. Per-PR food logical DB (ADR-0006) — drop BEFORE the stack is deleted, because the in-VPC
##    migration-runner Lambda is the only thing that can reach the PRIVATE_ISOLATED RDS and it is torn
##    down with the food stack below. The handler refuses to drop the shared base `kitchensink_food`.
##    Skipped when this PR never deployed a food service (the common case).
STACK="kitchensink-food-service-$PR"
FN=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='FoodMigrationFunctionName'].OutputValue | [0]" \
    --output text 2>/dev/null) || FN=""
if [ -n "$FN" ] && [ "$FN" != "None" ]; then
    echo "[food-db] invoking $FN with {action:drop} to drop kitchensink_food_${PR//-/_}"
    if aws lambda invoke --region "$REGION" --function-name "$FN" \
        --payload '{"action":"drop"}' --cli-binary-format raw-in-base64-out \
        /tmp/food-drop-result.json >/tmp/food-drop-invoke.json 2>/dev/null; then
        if grep -q '"FunctionError"' /tmp/food-drop-invoke.json; then
            echo "::warning::food DB drop for $PR returned a FunctionError — inspect $FN logs"
        else
            echo "[food-db] drop result: $(cat /tmp/food-drop-result.json)"
        fi
    else
        echo "::warning::could not invoke $FN to drop the per-PR food DB — drop it manually"
    fi
else
    echo "No food migration function for $PR (stack $STACK absent) — nothing to drop."
fi

## 1. CloudFormation stacks — name matches $PR OR Environment=$PR tag. The status filter includes the
##    FAILED/stuck resting states (CREATE_FAILED, ROLLBACK_FAILED, …) so a per-PR stack that failed or
##    hung at close time is still torn down instead of leaking.
for s in $(aws cloudformation list-stacks --region "$REGION" \
    --stack-status-filter \
    CREATE_COMPLETE CREATE_FAILED \
    ROLLBACK_COMPLETE ROLLBACK_FAILED \
    UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE UPDATE_ROLLBACK_FAILED \
    IMPORT_COMPLETE IMPORT_ROLLBACK_COMPLETE IMPORT_ROLLBACK_FAILED \
    DELETE_FAILED \
    --query 'StackSummaries[].StackName' --output text 2>/dev/null); do
    envtag=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$s" \
        --query "Stacks[0].Tags[?Key=='Environment'].Value | [0]" --output text 2>/dev/null)
    # Feature stacks use the suffix kitchensink-{service}-pr-{N} (caught by belongs) and are tagged
    # Environment=pr-{N} (caught by the tag). Either match is sufficient.
    if belongs "$s" || [ "$envtag" = "$PR" ]; then
        echo "[stack] delete $s (Environment=$envtag)"
        aws cloudformation delete-stack --region "$REGION" --stack-name "$s"
        aws cloudformation wait stack-delete-complete --region "$REGION" --stack-name "$s" 2>/dev/null ||
            echo "::warning::stack $s did not finish deleting in time — check it"
    fi
done

## 2. Tag sweep — anything else tagged Environment=$PR the stacks did not own.
for arn in $(aws resourcegroupstaggingapi get-resources --region "$REGION" \
    --tag-filters "Key=Environment,Values=$PR" \
    --query 'ResourceTagMappingList[].ResourceARN' --output text 2>/dev/null); do
    case "$arn" in
        *:log-group:*)
            lg="${arn##*:log-group:}"
            lg="${lg%:\*}"
            echo "[logs/tag] delete $lg"
            aws logs delete-log-group --region "$REGION" --log-group-name "$lg" || true
            ;;
        *:repository/*)
            repo="${arn##*:repository/}"
            echo "[ecr/tag] delete $repo"
            aws ecr delete-repository --region "$REGION" --repository-name "$repo" --force || true
            ;;
        *) echo "::warning::tagged $PR but not auto-deleted (add a handler for its type): $arn" ;;
    esac
done

## 3. Name-prefix sweep — auto-created resources that could not be tagged.
for lg in $(aws logs describe-log-groups --region "$REGION" \
    --query 'logGroups[].logGroupName' --output text 2>/dev/null); do
    if path_belongs "$lg"; then
        echo "[logs/name] delete $lg"
        aws logs delete-log-group --region "$REGION" --log-group-name "$lg" || true
    fi
done
for repo in $(aws ecr describe-repositories --region "$REGION" \
    --query 'repositories[].repositoryName' --output text 2>/dev/null); do
    if belongs "$repo"; then
        echo "[ecr/name] delete $repo (force)"
        aws ecr delete-repository --region "$REGION" --repository-name "$repo" --force || true
    fi
done

echo "Cleanup for $PR complete."
