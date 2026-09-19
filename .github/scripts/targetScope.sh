#!/usr/bin/env bash
#
# The predicate that decides whether a deployed-test tier may drive a target. No I/O, no AWS calls.
#
# ⛔ THIS FILE IS A SECURITY BOUNDARY, and the reason it exists at all is that it was written TEN times.
# Every `E2E (…)` job in `deployedE2eTiers.yml` resolves its origins at run time and then refuses any that is
# not under this repository's own domain — because an origin is an address this suite is about to send
# authenticated requests and real fixture data to, and a resolver bug, a mis-set repository variable or a
# crafted dispatch input is all it takes for that address to be somebody else's. Ten inline copies is ten
# places to fix one rule and no place to test it.
#
# This repository's own standard, stated in CLAUDE.md for the sibling case: *"The NAME match lives ONCE, in
# `.github/scripts/prScope.sh` … do not add a second matcher."* `deployGate.sh` and `prScope.sh` are the
# shape — a pure predicate here, regression-tested for real by a suite under `packages/infra/global/__tests__`
# that EXECUTES this file rather than re-implementing it.
#
# Usage — source it:
#     . "$(dirname "${BASH_SOURCE[0]}")/targetScope.sh"
#     target_scope_assert "$DOMAIN_NAME" "$IDENTITY_ORIGIN" "$RECIPE_ORIGIN"
#
# …or run it as a CLI, where the EXIT STATUS is the answer (0 = yes, 1 = no, 2 = misuse):
#     targetScope.sh under-domain <domain> <origin>
#     targetScope.sh assert       <domain> <origin>...

# target_scope_under_domain <domain> <origin>
#
# True iff <origin> is exactly `https://<domain>` or `https://<label>.<domain>`.
#
# ⛔ THE `https://` PREFIX IS PART OF THE MATCH. A suffix test alone admits `http://` — which would send this
# suite's bearer tokens over the wire in clear — and admits any scheme at all.
#
# ⛔ AND THE DOT IS PART OF IT. Matching a bare suffix admits `https://evil-commise.app` for the domain
# `commise.app`, which is the classic suffix-confusion that makes a domain check worse than none: it reads as
# a guard and passes an attacker's host.
target_scope_under_domain() {
    local domain=${1-} origin=${2-}

    [ -n "${domain}" ] || return 2
    [ -n "${origin}" ] || return 1

    case "${origin}" in
        "https://${domain}" | "https://"*".${domain}") return 0 ;;
        *) return 1 ;;
    esac
}

# target_scope_assert <domain> <origin>...
#
# Exits non-zero, with a GitHub `::error::` per offending origin, unless every origin is under <domain>.
#
# ⛔ AN EMPTY <domain> IS A FAILURE, NOT A PASS. If the `DOMAIN_NAME` repository variable is unset, every
# origin would be compared against a bare label and the guard would either admit everything or nothing
# depending on how it was written — so it refuses outright and says why. This is the case an inline copy is
# most likely to get wrong, because the happy path never exercises it.
target_scope_assert() {
    local domain=${1-}
    shift || true
    local origin refused=0

    if [ -z "${domain}" ]; then
        echo '::error::the DOMAIN_NAME repository variable is empty — every resolved origin would be compared against a bare label'
        return 1
    fi

    if [ "$#" -eq 0 ]; then
        echo '::error::no origins were passed to the target guard — a guard with nothing to check is not a guard'
        return 1
    fi

    for origin in "$@"; do
        if target_scope_under_domain "${domain}" "${origin}"; then
            echo "target ${origin}"
        else
            echo "::error::resolved target '${origin}' is not under ${domain} — refusing to drive it"
            refused=1
        fi
    done

    return "${refused}"
}

# CLI dispatch — only when executed, never when sourced.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    case "${1-}" in
        under-domain)
            shift
            target_scope_under_domain "$@"
            ;;
        assert)
            shift
            target_scope_assert "$@"
            ;;
        *)
            echo "usage: targetScope.sh {under-domain|assert} <domain> <origin>..." >&2
            exit 2
            ;;
    esac
fi
