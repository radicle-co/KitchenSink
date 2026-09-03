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

# Every CloudFormation stack belonging to this PR, as `name<TAB>Environment-tag` lines.
#
# ⛔ Computed ONCE, and shared by section 1 (drop the per-PR databases) and section 2 (delete the stacks),
# because the two MUST agree about what this PR owns. A stack section 2 deletes but section 1 never looked at
# is a per-PR database that leaks with its only drop door — which is the class of defect that produced the
# recipe leak in the first place, just arrived at from the other side.
#
# The status filter includes the FAILED/stuck resting states, so a per-PR stack that failed or hung at close
# time is still found rather than leaked. Two independent matches, either sufficient: `belongs` catches a
# stack NAMED for the PR (`pr-{N}` / `pr-{N}-…`); the suffix-named feature stacks
# (`kitchensink-{service}-pr-{N}`) are caught by the App-level `Environment=pr-{N}` tag and NOT by `belongs`,
# which is a PREFIX rule — deliberately, because broadening it to match a suffix would put every
# `kitchensink-*` name one typo away from a per-PR teardown.
#
# @sideEffect Calls the CloudFormation API.
discover_pr_stacks() {
    local stack envtag
    for stack in $(aws cloudformation list-stacks --region "$REGION" \
        --stack-status-filter \
        CREATE_COMPLETE CREATE_FAILED \
        ROLLBACK_COMPLETE ROLLBACK_FAILED \
        UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE UPDATE_ROLLBACK_FAILED \
        IMPORT_COMPLETE IMPORT_ROLLBACK_COMPLETE IMPORT_ROLLBACK_FAILED \
        DELETE_FAILED \
        --query 'StackSummaries[].StackName' --output text 2>/dev/null); do
        envtag=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$stack" \
            --query "Stacks[0].Tags[?Key=='Environment'].Value | [0]" --output text 2>/dev/null)
        if belongs "$stack" || [ "$envtag" = "$PR" ]; then
            printf '%s\t%s\n' "$stack" "$envtag"
        fi
    done
}

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

# ⚠️ Discovered AFTER sections 0 and 0b, never before them. Those two reclaim the preview's public address
# — the security-critical half, and a subdomain-takeover vector if it is left behind — and section 0's own
# comment is explicit that nothing may be queued ahead of it. A bounded discovery call is not a stack delete,
# but the ordering rule is about what may PRECEDE the DNS reclaim, not about how long each thing takes.
PR_STACKS=$(discover_pr_stacks)

## 0c. WAKE the shared sandbox database and NAT, so section 1 has something to talk to.
##
##     ⚠️ This is not belt-and-braces; without it section 1 CANNOT work at its most common trigger time.
##     A preview expires at 00:00 America/New_York, `SandboxSchedulerStack`'s STOP schedule fires at 00:00
##     America/New_York, and `sandbox-reconcile.yml` runs at :17 — so the reconciler reaches this script
##     seventeen minutes after the database it needs was stopped, and the drop below is an invocation of an
##     in-VPC Lambda against a stopped instance. `grep -rn 'sandbox-wake' .github/workflows` returned only
##     deploy paths: neither reclamation job ever woke the tier.
##
##     ⛔ NON-FATAL, deliberately. `sandboxReclamationReachability.test.ts` invariant 1 exists because a
##     PREREQUISITE STEP was once allowed to abort the teardown — the 2026-07-28 incident, where a hosted-zone
##     lookup failed and took nine PRs' worth of reclamation with it. Stacks, ECR repos and log groups need no
##     database whatsoever, so a wake that cannot complete must cost the DATABASE drop and nothing else. The
##     failure is recorded and the run goes red at the end; it does not skip the rest.
##
##     `ensure` takes a region and no instance identifier on purpose — see that script's header. It refuses
##     outright if anything but the sandbox instance answers the prefix filter, which is the right posture in
##     an account that also holds the production database.
if bash "$SCRIPT_DIR/sandbox-wake.sh" ensure "$REGION"; then
    echo "[wake] shared sandbox database and NAT are up"
else
    echo "::error::could not wake the shared sandbox tier — the per-PR logical databases below cannot be dropped and will be left behind. Everything that does not need a database is still reclaimed."
    teardown_failed=1
fi

## 1. Per-PR logical databases (ADR-0006) — drop BEFORE the stacks are deleted, because each service's
##    in-VPC migration-runner Lambda is the only thing that can reach the PRIVATE_ISOLATED RDS and it is
##    torn down with its stack in section 2. Every handler refuses to drop its shared base database.
##
##    ⛔ A FAILED DROP IS AN ERROR, not a warning (owner ruling, 2026-09-03). It used to warn, while §0c's
##    wake — which exists for no purpose other than making this drop possible — failed the run. The severities
##    disagreed, and backwards: the outcome the wake is a MEANS TO could fail on its own and the run still
##    reported green with a database left behind. Both are errors now. Neither ABORTS: they set
##    `teardown_failed` and the run goes red at the end, so everything that needs no database is still
##    reclaimed (`sandboxReclamationReachability.test.ts` invariant 1).
##
##    ⛔ DISCOVERED, NEVER LISTED — and this section was a LIST until 2026-09-03.
##
##    It hardcoded `kitchensink-food-service-$PR` and `FoodMigrationFunctionName`, so it dropped food's
##    database and food's alone. `RecipeServiceStack` has exported `RecipeMigrationFunctionName` since it
##    shipped, and `recipe-service`'s migrate handler implements `action: 'drop'` with the same base-name
##    refusal food's has — and nothing ever called it. Every reaped recipe preview left
##    `kitchensink_recipes_pr_{N}` behind, silently: the script reported success for dropping what it was
##    told to drop, the stack deleted cleanly, and the database is not a CloudFormation resource so nothing
##    in the console showed it. A third service would have inherited the same fate on day one.
##
##    So the doors are selected by SHAPE from the PR's own stacks. The pattern is published here, once, and
##    read by `packages/infra/global/__tests__/perPrDatabaseDropDoors.test.ts`, which discovers BOTH sides
##    from the CDK tree — every stack deriving a per-stage database name, and every migration-runner output —
##    and asserts that this script names none of them individually. A copy of a list cannot detect that the
##    list is incomplete.
# drop-door-pattern: ^[A-Za-z]+MigrationFunctionName$
DROP_DOOR_PATTERN='^[A-Za-z]+MigrationFunctionName$'

drop_doors_count=0
while IFS=$'\t' read -r stack envtag; do
    [ -n "$stack" ] || continue

    # Every output this stack publishes, then filtered in SHELL against the anchored pattern above. The
    # filter is not pushed into `--query`: JMESPath has no anchored match, so the authority for "what a drop
    # door looks like" would end up split between a suffix test here and a regex in the guard.
    outputs=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$stack" \
        --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output text 2>/dev/null) || outputs=""

    while IFS=$'\t' read -r key value; do
        [ -n "$key" ] && [ "$key" != "None" ] || continue
        [[ $key =~ $DROP_DOOR_PATTERN ]] || continue
        [ -n "$value" ] && [ "$value" != "None" ] || continue

        drop_doors_count=$((drop_doors_count + 1))
        echo "[db-drop] $stack (Environment=$envtag) publishes $key — invoking $value with {action:drop}"

        if aws lambda invoke --region "$REGION" --function-name "$value" \
            --payload '{"action":"drop"}' --cli-binary-format raw-in-base64-out \
            /tmp/db-drop-result.json >/tmp/db-drop-invoke.json 2>/tmp/db-drop-invoke.err; then
            # ⛔ `aws lambda invoke` EXITS 0 WHEN THE FUNCTION THREW — the throw is reported in its stdout,
            # which is what this greps. Reading the exit status alone reports a successful drop for a
            # database that is still there.
            if grep -q '"FunctionError"' /tmp/db-drop-invoke.json; then
                echo "::error::per-PR DB drop via $key for $PR returned a FunctionError — the database was NOT dropped and will be left behind. Inspect $value logs."
                teardown_failed=1
            else
                echo "[db-drop] $key result: $(cat /tmp/db-drop-result.json)"
            fi
        else
            # ⚠️ PRINT THE REASON. This branch used to send stderr to /dev/null and say only "drop it
            # manually", which cost a real diagnosis on 2026-08-27: the invoke was failing with
            # `Unknown options: --cli-binary-format` because the operator's shell resolved AWS CLI **v1**,
            # where that flag does not exist. The message named the database and the function but not the one
            # fact that identified the cause in seconds. The per-PR database leaked, silently, and the reason
            # was three characters of redirection away.
            #
            # This is the LAST chance to drop it: the migration runner is torn down with its stack in
            # section 2, and it is the only thing that can reach the PRIVATE_ISOLATED RDS. Once it is gone
            # the database can only be removed by deploying that service at that stage again.
            echo "::error::could not invoke $value to drop $PR's per-PR database via $key — it will be left behind"
            teardown_failed=1
            sed 's/^/  [db-drop] /' /tmp/db-drop-invoke.err >&2 || true
            if grep -q 'cli-binary-format' /tmp/db-drop-invoke.err 2>/dev/null; then
                echo "::error::this shell's \`aws\` is CLI v1 (\`--cli-binary-format\` is v2-only). Re-run with AWS CLI v2 — the drop is not retried after the stack is deleted." >&2
            fi
        fi
    done <<<"$outputs"
done <<<"$PR_STACKS"

# The Null Object case, kept: most PRs never deploy a service that owns a logical database, and a run that
# says nothing about that reads as a run that skipped the step.
if [ "$drop_doors_count" -eq 0 ]; then
    echo "No migration-runner outputs across $PR's stacks — no per-PR database to drop."
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

## 2. CloudFormation stacks — the SAME set section 1 read its drop doors from (see `discover_pr_stacks`),
##    so the two cannot disagree about what belongs to this PR.
while IFS=$'\t' read -r s envtag; do
    [ -n "$s" ] || continue
    echo "[stack] delete $s (Environment=$envtag)"
    aws cloudformation delete-stack --region "$REGION" --stack-name "$s"
    aws cloudformation wait stack-delete-complete --region "$REGION" --stack-name "$s" 2>/dev/null ||
        echo "::warning::stack $s did not finish deleting in time — check it"
done <<<"$PR_STACKS"

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
