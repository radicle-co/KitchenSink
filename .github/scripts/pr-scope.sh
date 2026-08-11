#!/usr/bin/env bash
#
# Pure scope predicates for per-PR sandbox teardown (ADR-0005). No I/O, no AWS calls, no side effects.
#
# ⛔ THIS FILE IS A SECURITY BOUNDARY. ADR-0005 tears a closed PR down with **no denylist**: the shared,
# PERSISTENT tier — `kitchensink-network/data/domain/alb/global-*`, the single shared sandbox identity
# service + webhooks that EVERY per-PR preview authenticates against, prod's identity service, and the
# RDS cluster behind them — is named `kitchensink-*` and tagged `Environment=global`. Nothing but the
# precision of the match below keeps a PR close away from those. Do not loosen these predicates, do not
# add a broader glob, and do not add a "delete anything orphaned" sweep.
#
# They live here, in one sourceable file, so the on-close cleanup and the daily reaper share ONE matcher
# that cannot drift — and so the rule can be regression-tested for real, by
# `packages/infra/global/__tests__/pr-scope.test.ts`, which executes this file rather than
# re-implementing it.
#
# Usage — source it:
#     . "$(dirname "${BASH_SOURCE[0]}")/pr-scope.sh"
#     pr_scope_is_token "$PR" || exit 2
#     pr_scope_belongs "$PR" "$stack_name"
#
# …or run it as a CLI, where the EXIT STATUS is the answer (0 = yes, 1 = no, 2 = misuse):
#     pr-scope.sh is-token      <token>
#     pr-scope.sh belongs       <token> <name>
#     pr-scope.sh path-belongs  <token> <path>
#     pr-scope.sh env-belongs   <token> <environment>
#     pr-scope.sh protected-env <environment>

# pr_scope_is_token <token>
#
# True iff <token> is exactly `pr-` followed by one or more digits — the ONLY shape a teardown may act
# on. Every predicate below splices the token straight into a shell glob, so a loose token is how an
# over-broad match gets in: `pr-` would prefix every name, and `pr-1*` would reach into other PRs. It
# also refuses whitespace, `*`, path traversal, and the bare stage names `sandbox`/`prod`/`global`.
pr_scope_is_token() {
    [[ ${1-} =~ ^pr-[0-9]+$ ]]
}

# pr_scope_belongs <token> <name>
#
# True iff <name> is exactly <token>, or is prefixed by "<token>-". The trailing delimiter is the whole
# point: without it, closing PR #1 would also claim `pr-15` and `pr-100`. Returns 2 (not "no") on a
# malformed token, so a caller that skipped the guard fails loudly instead of matching something.
pr_scope_belongs() {
    pr_scope_is_token "${1-}" || return 2
    case "${2-}" in "$1" | "$1"-*) return 0 ;; *) return 1 ;; esac
}

# pr_scope_path_belongs <token> <path>
#
# pr_scope_belongs, plus the same rule applied ANYWHERE inside a path — for auto-created resources whose
# name we do not choose, e.g. the Container Insights log group
# `/aws/ecs/containerinsights/kitchensink-food-service-pr-{N}-{LogicalId}-{hash}/performance`.
#
# ⚠️ This deliberately REVERSES a claim this comment used to make. It said the delimiters keep `pr-1` out
# of `/…/service-pr-1` — treating a mid-segment token as something to exclude. That exclusion was the
# defect, not a safeguard: `service-pr-1` is exactly the shape ECS generates, so excluding it meant the
# teardown's log-group sweep matched nothing on every PR close. `pr-1` out of `/…/pr-15-cluster/…` is
# still correct and still enforced — that is the TRAILING anchor's job, and it is preserved.
#
# The rule is now: the token must be delimited on both sides by start/end-of-string, `/`, or `-`.
pr_scope_path_belongs() {
    pr_scope_is_token "${1-}" || return 2
    pr_scope_belongs "$1" "${2-}" && return 0
    case "${2-}" in *"/$1" | *"/$1-"* | *"/$1/"*) return 0 ;; esac

    # ⚠️ The token also appears MID-SEGMENT, and for two years this function did not match it. The globs
    # above require the segment to START with the token (`/pr-57-cluster/`), which is what this function's
    # own docstring used to claim a Container Insights log group looks like. It does not. ECS names the
    # cluster it auto-creates `kitchensink-{service}-pr-{N}-{LogicalId}-{hash}`, so the real name is
    #   /aws/ecs/containerinsights/kitchensink-food-service-pr-57-FoodServiceCluster442EDB29-XJQiEps8SkTM/performance
    # where `pr-57` is preceded by `-`, not `/`. The sweep in `teardown-sandbox-pr.sh` §4 therefore ran on
    # every PR close, enumerated every log group, matched NOTHING, and reported success — which is how 22
    # orphans (pr-57 … pr-90) accumulated behind a routine that looked implemented and even documented the
    # resource by name. Verified against the live API 2026-08-11.
    #
    # Anchored on BOTH sides, which is what keeps this from becoming the over-broad prefix match ADR-0005
    # forbids: the token must be preceded by start-of-string, `/`, or `-`, and followed by `-`, `/`, or
    # end-of-string. The trailing anchor is what stops `pr-5` from claiming `…-pr-57-…` and `pr-57` from
    # claiming `…-pr-570-…`; the leading one stops a suffix collision like `…-expr-57-…`.
    [[ ${2-} =~ (^|[/-])"$1"([/-]|$) ]] && return 0
    return 1
}

# The prefix `sandbox-web-preview.yml` publishes a per-PR web preview's GitHub **Environment** under, as
# `sandbox-preview/pr-{N}` (the `environment:` property of the Deployments-API call, NOT a job key). Held
# here so the teardown that reclaims those environments shares ONE definition of the name with the scope
# rule that authorizes deleting it.
PR_SCOPE_PREVIEW_ENV_PREFIX='sandbox-preview/'

# pr_scope_is_protected_environment <environment>
#
# True iff <environment> is a PERSISTENT GitHub Environment that no teardown may ever delete. Deleting an
# environment also deletes its protection rules, its environment secrets/variables and its whole deployment
# history, so this is a destructive, non-recoverable operation on repository CONFIGURATION:
#   • `Production` carries the required-reviewer rule and the main-only branch policy that gate prod
#     deploys — deleting it silently REMOVES the approval gate rather than failing closed;
#   • `Sandbox` is the (deliberately unprotected) binding every sandbox deploy job names;
#   • `Preview` is Vercel's own environment; `copilot` is GitHub's.
# An explicit denylist is the exception to ADR-0005's no-denylist rule, and it is warranted precisely
# because these names carry NO `pr-{N}` marker and NO `Environment` tag to cross-check — unlike a stack,
# there is no second, independent signal that would catch a mistake here.
pr_scope_is_protected_environment() {
    case "${1-}" in
        Production | Sandbox | Preview | copilot) return 0 ;;
        *) return 1 ;;
    esac
}

# pr_scope_environment_belongs <token> <environment>
#
# True iff <environment> is EXACTLY the GitHub Environment this PR's web preview owns.
#
# Deliberately an EQUALITY test against the derived name, not the prefix rule `pr_scope_belongs` applies to
# AWS resources: `sandbox-web-preview.yml` creates exactly one environment per PR, so equality is the
# tightest rule that is complete for the known requirement — and it makes the `pr-1` vs `pr-15`/`pr-100`
# case structural rather than something a delimiter has to catch. It also refuses every protected
# environment outright, so the guard holds even if the prefix constant above were ever changed to something
# that could collide.
pr_scope_environment_belongs() {
    pr_scope_is_token "${1-}" || return 2
    pr_scope_is_protected_environment "${2-}" && return 1
    [ "${2-}" = "${PR_SCOPE_PREVIEW_ENV_PREFIX}$1" ]
}

# CLI dispatch — only when executed directly, never when sourced.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    case "${1-}" in
        is-token) pr_scope_is_token "${2-}" ;;
        belongs) pr_scope_belongs "${2-}" "${3-}" ;;
        path-belongs) pr_scope_path_belongs "${2-}" "${3-}" ;;
        env-belongs) pr_scope_environment_belongs "${2-}" "${3-}" ;;
        protected-env) pr_scope_is_protected_environment "${2-}" ;;
        *)
            echo "usage: pr-scope.sh is-token|belongs|path-belongs|env-belongs|protected-env <pr-N> [name]" >&2
            exit 2
            ;;
    esac
fi
