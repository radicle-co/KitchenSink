#!/usr/bin/env bash
#
# Tear down every ephemeral sandbox resource for ONE per-PR preview (PR = pr-{N}).
#
# Scoped strictly to pr-{N} by NAME (a delimiter-aware prefix, so pr-1 never matches pr-15) OR by an
# `Environment` TAG whose value is one this PR can own — `pr-{N}-sandbox`, or the bare `pr-{N}` resources
# tagged before the scheme changed. The shared persistent infra — global (network/data/domain/alb/global),
# the identity service + webhooks, and the RDS cluster — is named `*-sandbox`/`*-prod` and tagged with its
# TIER (`sandbox` or `production`), which no token can claim because a token carries digits and neither tier
# word does (ADR-0005). This is the single source of truth used by BOTH the on-close cleanup job and the
# scheduled reaper, so the two cannot drift.
#
# Usage: teardownSandboxPr.sh <pr-N> [region]
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

PR="${1:?usage: teardownSandboxPr.sh <pr-N> [region]}"
REGION="${2:-${REGION:-us-east-1}}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

# The scope predicates are the security boundary of this script, so they live in ONE sourceable file
# with a regression suite (packages/tools/repoGuards/__tests__/prScope.test.ts) instead of inline here.
# shellcheck source=./prScope.sh
. "$SCRIPT_DIR/prScope.sh"
# The CloudFormation statuses that mean "still exists", shared with every other sweep so the reaper cannot
# discover a narrower set than the teardown reclaims.
# shellcheck source=./cfnRestingStates.sh
. "$SCRIPT_DIR/cfnRestingStates.sh"
# The statuses that mean "a deploy is still running", which §0a waits out before anything is discovered.
# shellcheck source=./cfnInProgressStates.sh
. "$SCRIPT_DIR/cfnInProgressStates.sh"

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
# The TAG half of the match, and a DIFFERENT rule from the name half: a tag value comes from the closed set
# the CDK apps emit (`pr-{N}-sandbox` now, `pr-{N}` before the scheme changed), so it is matched by equality
# against that set, never by the name prefix rule. Both sites below read it from `prScope.sh` so the
# per-stack read and the account-wide sweep cannot come to disagree about what belongs to this PR.
environment_tag_belongs() { pr_scope_environment_tag_belongs "$PR" "$1"; }
ENVIRONMENT_TAG_VALUES="$(pr_scope_environment_tag_values "$PR")"

# Every CloudFormation stack belonging to this PR, as `name<TAB>Environment-tag` lines.
#
# ⚠️ This used to be SHARED with section 1, which discovered a per-PR database's drop door from the outputs
# of the PR's own stacks — so the two HAD to agree about what this PR owned, or a stack section 2 deleted but
# section 1 never looked at leaked its database along with its only door. ADR-0031's reaper needs no stack at
# all, so that coupling is gone and this discovery now serves section 2 alone.
#
# The status filter includes the FAILED/stuck resting states, so a per-PR stack that failed or hung at close
# time is still found rather than leaked. Two independent matches, either sufficient: `belongs` catches a
# stack NAMED for the PR (`pr-{N}` / `pr-{N}-…`); the suffix-named feature stacks
# (`kitchensink-{service}-pr-{N}`) are caught by the App-level `Environment` tag and NOT by `belongs`,
# which is a PREFIX rule — deliberately, because broadening it to match a suffix would put every
# `kitchensink-*` name one typo away from a per-PR teardown.
#
# Takes the status set to look in (resting, or in-progress) and returns non-zero when the LIST call itself failed, so
# a failed lookup is never read as "this PR owns nothing".
#
# @sideEffect Calls the CloudFormation API.
discover_pr_stacks() {
    local stack envtag names
    names=$(aws cloudformation list-stacks --region "$REGION" \
        --stack-status-filter "$@" \
        --query 'StackSummaries[].StackName' --output text 2>/dev/null) || return 1
    for stack in $names; do
        envtag=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$stack" \
            --query "Stacks[0].Tags[?Key=='Environment'].Value | [0]" --output text 2>/dev/null)
        if belongs "$stack" || environment_tag_belongs "$envtag"; then
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
            echo "::error::refusing to delete the PERSISTENT GitHub Environment '$gh_env' — the scope predicate let it through, which is a bug in prScope.sh"
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

## 0a. WAIT OUT the PR's in-flight deploys, then discover. A PR can close while its deploy is still running, and a
##     deploy that is still running creates the PR's logical database (the schema stack's migration) AFTER a drop that
##     ran too early. Discovery by RESTING state alone did not see that stack at all, so the teardown reported success
##     over a database that outlived it (ADR-0005, ADR-0061). So this waits, bounded, for every `*_IN_PROGRESS` stack
##     of this PR to settle, and only then discovers the stacks to delete and lets §1 drop.
##
##     On timeout (or a lookup that cannot be made) the drop is NOT attempted: it is recorded as OWED (§1) and the run
##     fails. Not dropping is the only safe reading of "the deploy may still create it", and the next Sandbox Up pays
##     the debt. Nothing aborts: everything that needs no database is still reclaimed.
##
##     `TEARDOWN_SETTLE_TIMEOUT_SECONDS` (default 1800) / `TEARDOWN_SETTLE_POLL_SECONDS` (default 15).
settle_timed_out=0
settle_deadline=$((SECONDS + ${TEARDOWN_SETTLE_TIMEOUT_SECONDS:-1800}))
while :; do
    if ! in_flight=$(discover_pr_stacks "${CFN_IN_PROGRESS_STATES[@]}"); then
        echo "::error::could not list $PR's in-flight CloudFormation stacks — a deploy may still be creating its database, so the drop is deferred rather than attempted"
        settle_timed_out=1
        teardown_failed=1
        break
    fi
    if [ -z "$in_flight" ]; then
        break
    fi
    if [ "$SECONDS" -ge "$settle_deadline" ]; then
        echo "::error::$PR still has stacks mid-deploy after ${TEARDOWN_SETTLE_TIMEOUT_SECONDS:-1800}s ($(cut -f1 <<<"$in_flight" | tr '\n' ' ')) — a deploy that finishes later creates its database after any drop made now. The drop is deferred as OWED and this run fails; re-run the teardown once the deploy has settled."
        settle_timed_out=1
        teardown_failed=1
        break
    fi
    echo "[settle] $PR has stacks mid-deploy ($(cut -f1 <<<"$in_flight" | tr '\n' ' ')) — waiting"
    sleep "${TEARDOWN_SETTLE_POLL_SECONDS:-15}"
done

# ⚠️ Discovered AFTER sections 0 and 0b, never before them. Those two reclaim the preview's public address
# — the security-critical half, and a subdomain-takeover vector if it is left behind — and section 0's own
# comment is explicit that nothing may be queued ahead of it. A bounded discovery call is not a stack delete,
# but the ordering rule is about what may PRECEDE the DNS reclaim, not about how long each thing takes.
if ! PR_STACKS=$(discover_pr_stacks "${CFN_RESTING_STATES[@]}"); then
    echo "::error::could not list CloudFormation stacks — $PR's stacks cannot be found and will be left behind"
    PR_STACKS=''
    teardown_failed=1
fi

## 0c. CHECK the shared sandbox database and NAT, so section 1 knows whether it can talk to them.
##
##     ⛔ REWRITTEN 2026-10-12 (owner ruling: the sandbox starts only by hand; "no automatic or scheduled tasks
##     or jobs ... There should not be a wake of CI push"). This section used to WAKE the tier, because the
##     per-PR drop below invokes an in-VPC Lambda and a reconciler run at :17 reached it seventeen minutes
##     after the 00:00 stop. Nothing in CI starts the sandbox any more, so it now LOOKS (`sandboxWake.sh check`,
##     describe calls only) and the drop runs only when the tier is up.
##
##     • DOWN (exit 3) is a SKIP, not a failure — "a job that needs the sandbox SKIPS when it is down. It never
##       fails for that reason." The drop is DEFERRED, not forgotten: §1 records it as owed, and the next Sandbox
##       Up pays it (`perPrDatabaseDrop.sh drain`). Only a record that cannot be written fails the run.
##     • A check that cannot ANSWER (exit 1: API failure, nothing discovered, a non-sandbox identifier) is an
##       error, recorded in `teardown_failed`. The drop is still attempted, as before: it is harmless if the
##       tier is in fact down and useful if it is up.
##
##     ⛔ NON-FATAL, deliberately. `sandboxReclamationReachability.test.ts` invariant 1 exists because a
##     PREREQUISITE STEP was once allowed to abort the teardown — the 2026-07-28 incident, where a hosted-zone
##     lookup failed and took nine PRs' worth of reclamation with it. Stacks, ECR repos and log groups need no
##     database whatsoever, so a check that fails costs the DATABASE drop and nothing else. The failure is
##     recorded and the run goes red at the end; it does not skip the rest.
##
##     `check` takes a region and no instance identifier on purpose — see that script's header. It refuses
##     outright if anything but the sandbox instance answers the prefix filter, which is the right posture in
##     an account that also holds the production database.
sandbox_tier_down=0
check_status=0
bash "$SCRIPT_DIR/sandboxWake.sh" check "$REGION" || check_status=$?
case "$check_status" in
    0)
        echo "[sandbox-check] shared sandbox database and NAT are up"
        ;;
    3)
        sandbox_tier_down=1
        echo "::notice::the shared sandbox is down (it starts only by hand), so $PR's per-PR logical databases cannot be dropped now. The drop is recorded as OWED and the next Sandbox Up pays it (perPrDatabaseDrop.sh). Everything that needs no database is still reclaimed."
        ;;
    *)
        echo "::error::could not check the shared sandbox tier (exit $check_status) — the per-PR logical databases below may not be droppable (the reaper is in-VPC too) and may be left behind. Everything that does not need a database is still reclaimed."
        teardown_failed=1
        ;;
esac

## 1. Per-PR logical databases (ADR-0006) — reclaimed by the PLATFORM REAPER (ADR-0031).
##
##    ⛔ REPOINTED 2026-09-04, and the shape it replaced was not merely inelegant — it was incomplete in a
##    way nothing could see. This section used to discover a drop door on each of the PR's OWN stacks (any
##    output matching `^[A-Za-z]+MigrationFunctionName$`) and invoke it with `{"action":"drop"}`. That covers
##    the normal path and only the normal path, because the door lives INSIDE the stack whose database it
##    drops:
##
##      • a stack already deleted, or resting in DELETE_FAILED / UPDATE_ROLLBACK_FAILED, publishes no
##        outputs — so its database had no door at all, and survived every sweep; and
##      • the databases stranded during the period when `RecipeMigrationFunctionName` existed and nothing
##        ever invoked it are unreachable by construction, their stacks long gone.
##
##    `PerPrDatabaseReaperFunction` lives in `DataStack`, beside the instance itself, so it outlives every
##    service stack and needs none of them to exist. It takes a `pr-{N}` token and nothing else, discovers
##    its own targets from `pg_database`, and is authorised by an exact-suffix scope predicate that it
##    RE-ASSERTS at the point of destruction — `packages/infra/global/src/db-reaper/perPrDatabaseScope.ts`,
##    the same belt-and-braces §0b applies before deleting a GitHub Environment. It is deployed at non-prod
##    stages only and refuses at runtime if `STAGE` is `prod`.
##
##    ⛔ THIS DISSOLVES THE ORDERING CONSTRAINT against §2 — the reaper is not torn down with the PR — but the
##    call stays HERE, ahead of the stack deletes, on a different argument: §2 waits for each delete and a
##    wedged stack can eat the whole run. The ordering is now a preference, not a precondition.
##
##    ⛔ A FAILED DROP IS AN ERROR, not a warning (owner ruling, 2026-09-03). It used to warn, while §0c's
##    tier check — which exists for no purpose other than making this drop possible — failed the run. The
##    severities disagreed, and backwards. Both are errors now. Neither ABORTS: they set `teardown_failed`
##    and the run goes red at the end, so everything that needs no database is still reclaimed
##    (`sandboxReclamationReachability.test.ts` invariant 1).
##
##    The per-service `action: 'drop'` doors are DELETED (ADR-0039): the reaper is the ONE authority for
##    "how a per-PR database is dropped", and `dropDatabaseAuthority.test.ts` fails if a second appears.

# ⛔ The reaper invocation lives ONCE, in `perPrDatabaseDrop.sh`, because the deferred drop (ADR-0060) pays the same
# debt later through the same door. A down tier DEFERS: the PR is recorded as owing its drop, since the stacks below
# are about to be deleted and nothing would ever name this PR again. An unrecorded skip is the leak; it fails.
if [ "$settle_timed_out" -eq 1 ]; then
    # §0a said a deploy may still create this PR's database; dropping now would miss it. Record, never skip silently.
    if ! bash "$SCRIPT_DIR/perPrDatabaseDrop.sh" defer "$PR" "$REGION"; then
        teardown_failed=1
    fi
elif [ "$sandbox_tier_down" -eq 1 ]; then
    if ! bash "$SCRIPT_DIR/perPrDatabaseDrop.sh" defer "$PR" "$REGION"; then
        teardown_failed=1
    fi
elif ! bash "$SCRIPT_DIR/perPrDatabaseDrop.sh" drop "$PR" "$REGION"; then
    teardown_failed=1
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
##     anyway must still be reclaimed. See .github/scripts/ecsQuiesce.sh and its integration suite.
if bash "$SCRIPT_DIR/ecsQuiesce.sh" "$PR" "$REGION"; then
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

## 3. Tag sweep — anything else carrying one of this PR's Environment values that the stacks did not own.
##    The `Values=` list is an OR of EXACT values (the API matches no prefixes), and it is printed by
##    `prScope.sh` rather than spelled here: a literal `Values=$PR` is what silently matched nothing the
##    moment the CDK apps started emitting `pr-{N}-sandbox`, and a sweep that matches nothing reports success.
for arn in $(aws resourcegroupstaggingapi get-resources --region "$REGION" \
    --tag-filters "Key=Environment,Values=$ENVIRONMENT_TAG_VALUES" \
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
