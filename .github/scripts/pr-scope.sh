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
#     pr-scope.sh is-token     <token>
#     pr-scope.sh belongs      <token> <name>
#     pr-scope.sh path-belongs <token> <path>

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
# pr_scope_belongs, plus the same rule applied to a `/`-delimited SEGMENT inside a path — for
# auto-created resources whose name we do not choose, e.g. the
# `/aws/ecs/containerinsights/<token>-cluster.../performance` log group. The `/` and `-` delimiters keep
# `pr-1` out of `/…/pr-15-cluster/…` and out of `/…/service-pr-1`.
pr_scope_path_belongs() {
    pr_scope_is_token "${1-}" || return 2
    pr_scope_belongs "$1" "${2-}" && return 0
    case "${2-}" in *"/$1" | *"/$1-"* | *"/$1/"*) return 0 ;; *) return 1 ;; esac
}

# CLI dispatch — only when executed directly, never when sourced.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    case "${1-}" in
        is-token) pr_scope_is_token "${2-}" ;;
        belongs) pr_scope_belongs "${2-}" "${3-}" ;;
        path-belongs) pr_scope_path_belongs "${2-}" "${3-}" ;;
        *)
            echo "usage: pr-scope.sh is-token|belongs|path-belongs <pr-N> [name]" >&2
            exit 2
            ;;
    esac
fi
