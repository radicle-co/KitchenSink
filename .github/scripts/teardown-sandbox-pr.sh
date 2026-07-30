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
#
# Environment (required for the preview-domain step, section 0):
#   PREVIEW_ZONE            e.g. sandbox.commise.app
#   PREVIEW_HOSTED_ZONE_ID  the Route 53 zone holding it
#   VERCEL_TOKEN / VERCEL_PROJECT_ID / VERCEL_TEAM_ID
set -uo pipefail

PR="${1:?usage: teardown-sandbox-pr.sh <pr-N> [region]}"
REGION="${2:-${REGION:-us-east-1}}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

# The scope predicates are the security boundary of this script, so they live in ONE sourceable file
# with a regression suite (packages/infra/global/__tests__/pr-scope.test.ts) instead of inline here.
# shellcheck source=./pr-scope.sh
. "$SCRIPT_DIR/pr-scope.sh"

# Hard guard: only ever operate on an exact pr-{N} token. Anything else (a bare stage name, a typo, an
# empty arg, a glob) is refused so this can never be pointed at shared infra.
if ! pr_scope_is_token "$PR"; then
    echo "refusing to tear down a non pr-{N} token: '$PR'" >&2
    exit 2
fi

echo "Tearing down ephemeral resources for: $PR (region $REGION)"

# Non-zero when any step failed in a way that can leave a resource behind. Individual steps do NOT abort
# the run (a stuck stack must not block the rest of the teardown); the status is reported at the end.
teardown_failed=0

belongs() { pr_scope_belongs "$PR" "$1"; }
path_belongs() { pr_scope_path_belongs "$PR" "$1"; }

## 0. The preview's PUBLIC ADDRESS — the Route 53 record `$PR.$PREVIEW_ZONE` and the Vercel
##    project-domain binding that claims it (ADR-0001 "Update (2026-07-28)"). Neither is a
##    CloudFormation resource, so nothing below would ever have removed them: the CNAME survived the PR
##    and kept pointing at `cname.vercel-dns.com` after the Vercel claim lapsed, which is a
##    subdomain-takeover vector (anyone can then re-claim the hostname on their own Vercel account).
##
##    FIRST, deliberately: every step below can take many minutes and a stack delete can hang outright,
##    so the security-critical removal must not be queued behind them. The script itself deletes DNS
##    before releasing the Vercel domain, so an interrupted run can only leave the SAFE half-state.
##
##    Scope: it constructs `$PR.$PREVIEW_ZONE` and refuses any host whose first label is not `pr-{N}`,
##    so the apex, the `*.sandbox` wildcard and the SHARED `identity.sandbox.…` host can never be
##    targets. An absent record/domain is a success (idempotent).
if [ -z "${PREVIEW_ZONE:-}" ] || [ -z "${PREVIEW_HOSTED_ZONE_ID:-}" ] ||
    [ -z "${VERCEL_TOKEN:-}" ] || [ -z "${VERCEL_PROJECT_ID:-}" ]; then
    echo "::error::preview-domain teardown is unconfigured (need PREVIEW_ZONE, PREVIEW_HOSTED_ZONE_ID, VERCEL_TOKEN, VERCEL_PROJECT_ID) — $PR's DNS record may be left dangling"
    teardown_failed=1
elif (cd "$REPO_ROOT" && PR_TOKEN="$PR" npx --no-install tsx packages/apps/commise/web/scripts/teardownPreviewDomain.ts); then
    echo "[preview-domain] $PR address removed"
else
    echo "::error::preview-domain teardown FAILED for $PR — the Route 53 record may still point at Vercel (subdomain-takeover vector); remove $PR.$PREVIEW_ZONE by hand"
    teardown_failed=1
fi

## 1. Per-PR food logical DB (ADR-0006) — drop BEFORE the stack is deleted, because the in-VPC
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

## 2. CloudFormation stacks — name matches $PR OR Environment=$PR tag. The status filter includes the
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
    # Two independent matches, either of which is sufficient. `belongs` catches a stack NAMED for the
    # PR (`pr-{N}` / `pr-{N}-…`); the suffix-named feature stacks (kitchensink-{service}-pr-{N}) are
    # caught by the App-level Environment=pr-{N} tag, NOT by `belongs` — it is a prefix rule, and
    # deliberately so: broadening it to match a suffix would put every `kitchensink-*` name one typo
    # away from a per-PR teardown.
    if belongs "$s" || [ "$envtag" = "$PR" ]; then
        echo "[stack] delete $s (Environment=$envtag)"
        aws cloudformation delete-stack --region "$REGION" --stack-name "$s"
        aws cloudformation wait stack-delete-complete --region "$REGION" --stack-name "$s" 2>/dev/null ||
            echo "::warning::stack $s did not finish deleting in time — check it"
    fi
done

## 3. Tag sweep — anything else tagged Environment=$PR the stacks did not own.
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

## 4. Name-prefix sweep — auto-created resources that could not be tagged.
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

if [ "$teardown_failed" -ne 0 ]; then
    echo "::error::Cleanup for $PR did NOT fully succeed — see the errors above."
    exit 1
fi

echo "Cleanup for $PR complete."
