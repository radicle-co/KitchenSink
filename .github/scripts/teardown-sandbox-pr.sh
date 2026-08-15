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
#
# Environment (required for the LEGACY GitHub-Environment step, section 0b):
#   GH_ENVIRONMENT_ADMIN_TOKEN  a token with `Administration: write` on this repo — provisioned as the repo
#                               secret of the same name and passed in by `sandbox-deploy.yml`'s `cleanup`
#                               and `reap-abandoned` jobs. Deliberately NOT `github.token`/`GH_TOKEN`: the
#                               workflow token CANNOT delete an environment (`administration` is not a
#                               grantable `permissions:` key), so reusing that name would guarantee a 403 on
#                               every run. Unset (rotation, or a fork with no secret access) ⇒ the step warns
#                               and skips, because what it reclaims is metadata, not spend.
#   GITHUB_REPOSITORY           owner/repo; set automatically by GitHub Actions.
set -uo pipefail

PR="${1:?usage: teardown-sandbox-pr.sh <pr-N> [region]}"
REGION="${2:-${REGION:-us-east-1}}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

# The scope predicates are the security boundary of this script, so they live in ONE sourceable file
# with a regression suite (packages/infra/global/__tests__/prScope.test.ts) instead of inline here.
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

## 0b. The PR's LEGACY GitHub ENVIRONMENT — `sandbox-preview/pr-{N}`.
##
##     ⚠️ READ THE TENSE: this is a FINITE, DRAINING reclamation of names already on the repository, not a
##     steady-state sweep of an ongoing stream. `sandbox-web-preview.yml` created one of these per PR (via
##     the Deployments API, so the PR got a "View deployment" button aimed at the working preview URL) until
##     `c86f3e09`, which collapsed every preview onto the ONE shared `sandbox-preview` environment for
##     exactly the reason this block exists: no workflow can delete an environment at any permission level
##     (`administration` is not a grantable `permissions:` key), so a per-PR NAME could only ever accumulate.
##     No new `sandbox-preview/pr-{N}` is created any more. Do not build further machinery around this
##     block, and do not "generalize" it to other environment shapes — there are none.
##
##     Ledger, so the end state is checkable rather than folklore. Measured against the live API on
##     2026-08-11: 51 `sandbox-preview/pr-{N}` environments against 8 open PRs — 43 orphans, the same leak
##     class as the DELETE_FAILED stacks and the dangling CNAMEs, and invisible for the same reason (no cost
##     signal, and `transient_environment: true` does NOT make GitHub delete anything). The 43 were reclaimed
##     that day. The 8 survivors — `sandbox-preview/pr-{84,85,86,87,88,89,91,92}` — belong to PRs that were
##     still OPEN, and each drains here when its PR closes.
##
##     ⛔ WHEN THE LAST ONE IS GONE, DELETE THIS BLOCK. Re-verify with
##     `gh api --paginate repos/:owner/:repo/environments --jq '.environments[].name' | grep 'pr-'`; an empty
##     result means every legacy name has been reclaimed and this step is a permanent no-op. Leaving a
##     permanent no-op behind is how the next reader concludes per-PR environments are still being created.
##
##     EARLY, like section 0 and for the same reason: it needs no AWS credentials and costs one API call,
##     so it must not be queued behind a stack delete that can hang for an hour.
##
##     Scope: the environment list is enumerated and filtered through `pr_scope_environment_belongs`, which
##     demands EXACT equality with `sandbox-preview/$PR` and refuses the persistent `Production` / `Sandbox`
##     / `Preview` / `copilot` environments outright — re-asserted at the delete site below, because this
##     one call would remove `Production`'s required-reviewer rule and prod's whole deployment history.
##
##     ⚠️ It LISTS and matches rather than constructing the URL and treating 404 as "already gone". That is
##     the difference between idempotent and blind: the name contains a `/` that must reach the API as
##     `%2F`, and an UNENCODED path answers 404 exactly like an absent environment (measured), so a
##     404-means-success shortcut would report success forever while deleting nothing. Here, absent means
##     "no name in the list matched" and a listed environment that fails to delete is an error.
if [ -z "${GH_ENVIRONMENT_ADMIN_TOKEN:-}" ]; then
    # A WARNING, not an error, and the asymmetry with section 0 is deliberate: a dangling DNS record is a
    # subdomain-takeover vector, whereas a leaked environment costs nothing and exposes nothing — it is
    # clutter plus stale deployment history. Failing every PR-close run over it would train people to
    # ignore the red on the job whose real work is reclaiming billable compute, which is the failure mode
    # this script has already been rebuilt twice to remove.
    #
    # The secret IS provisioned, so reaching this branch means something changed: the token expired or was
    # rotated, or this is a run with no access to repository secrets. The blast radius is bounded — at most
    # the handful of legacy names in the ledger above — so the recovery is to delete the named environment by
    # hand and re-provision the token.
    echo "::warning::GH_ENVIRONMENT_ADMIN_TOKEN is unset (expired, rotated, or a run without secret access) — the legacy GitHub Environment 'sandbox-preview/$PR' will be left behind. github.token CANNOT delete an environment; this needs a token with Administration: write, stored as the GH_ENVIRONMENT_ADMIN_TOKEN repo secret. Delete it by hand: gh api --method DELETE repos/OWNER/REPO/environments/sandbox-preview%2F$PR"
elif [ -z "${GITHUB_REPOSITORY:-}" ]; then
    echo "::error::GITHUB_REPOSITORY is unset, so the GitHub Environment for $PR cannot be resolved — it will be left behind"
    teardown_failed=1
elif ! gh_envs=$(GH_TOKEN="$GH_ENVIRONMENT_ADMIN_TOKEN" gh api --paginate \
    "repos/${GITHUB_REPOSITORY}/environments" --jq '.environments[].name' 2>&1); then
    # `--paginate` is load-bearing: the default page size is 30 and there were 55 environments, so an
    # unpaginated list would silently stop reclaiming past the first page.
    echo "::error::could not list GitHub Environments for ${GITHUB_REPOSITORY} — 'sandbox-preview/$PR' may be left behind: ${gh_envs}"
    teardown_failed=1
else
    gh_env_deleted=0
    while IFS= read -r gh_env; do
        [ -n "$gh_env" ] || continue
        pr_scope_environment_belongs "$PR" "$gh_env" || continue
        # Second, independent assertion at the point of destruction — the same predicate, re-run on the
        # exact string about to be spliced into a DELETE. `pr_scope_environment_belongs` already refuses
        # these, so reaching here means the scope rule itself regressed, and that must fail loudly rather
        # than proceed.
        if pr_scope_is_protected_environment "$gh_env"; then
            echo "::error::refusing to delete the PERSISTENT GitHub Environment '$gh_env' — the scope predicate let it through, which is a bug in pr-scope.sh"
            teardown_failed=1
            continue
        fi
        if GH_TOKEN="$GH_ENVIRONMENT_ADMIN_TOKEN" gh api --silent --method DELETE \
            "repos/${GITHUB_REPOSITORY}/environments/${gh_env//\//%2F}"; then
            echo "[gh-env] deleted $gh_env"
            gh_env_deleted=$((gh_env_deleted + 1))
        else
            echo "::error::failed to delete the GitHub Environment '$gh_env' — a token with Administration: write is required; delete it by hand"
            teardown_failed=1
        fi
    done <<<"$gh_envs"
    if [ "$gh_env_deleted" -eq 0 ]; then
        echo "[gh-env] no 'sandbox-preview/$PR' environment to delete (already reclaimed)"
    fi
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

## 1b. Drain the PR's ECS services and tasks BEFORE any stack delete — an ORDERING fix, not a retry.
##
##     Without this, deleting a per-PR service stack fails on its own cluster:
##
##         AWS::ECS::ClusterCapacityProviderAssociations  DELETE_FAILED
##           "The specified capacity provider is in use and cannot be removed." (ResourceInUseException)
##
##     CloudFormation deletes the ECS service before the association, but `DeleteService` returns while the
##     tasks are still DRAINING, so the association delete lands while FARGATE_SPOT is still referenced and
##     the whole stack settles into DELETE_FAILED with its cluster intact. It is NOT fixable by retrying the
##     same delete — the precondition only clears once the reference is gone — and it is non-prod-only,
##     because ADR-0008's `enableFargateCapacityProviders: useSpot` emits that association ONLY for spot
##     stages. Measured: 9 stacks across PRs 73/77/78/79/80 sat in DELETE_FAILED on exactly this.
##
##     A failure here is recorded but does NOT skip the stack deletes below: a stack that deletes cleanly
##     anyway must still be reclaimed. See .github/scripts/ecs-quiesce.sh and its integration suite.
if bash "$SCRIPT_DIR/ecs-quiesce.sh" "$PR" "$REGION"; then
    echo "[ecs-quiesce] $PR drained"
else
    echo "::error::could not fully drain $PR's ECS services/tasks — a stack delete may fail on its cluster's capacity-provider association"
    teardown_failed=1
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
