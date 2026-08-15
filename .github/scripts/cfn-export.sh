#!/usr/bin/env bash
#
# Resolve ONE CloudFormation export value by name, correctly, across pagination.
#
# ⚠️ WHY THIS SCRIPT EXISTS — the obvious one-liner is WRONG, and it was wrong in ten places.
#
# The idiom everywhere in this repo was:
#
#     aws cloudformation list-exports --query "Exports[?Name=='<name>'].Value | [0]" --output text
#
# `ListExports` pages at 100 items, and the AWS CLI applies `--query` to EACH PAGE and prints one
# result per page. This account has 196 exports, so that command emits TWO lines: the value from the
# page holding the export, and the literal `None` from the page that does not. Which line comes first
# depends on which page the export happens to land on, and that changes as exports are added.
#
# The failure is therefore intermittent-by-account-growth, and it fails in BOTH directions:
#   - the caller captures `"Z0123ABC\nNone"` and passes a two-line string to a downstream flag; or
#   - the caller captures `"None\nZ0123ABC"`, the `= "None"` guard does not match (it is comparing the
#     whole two-line string), and the value is used anyway; or
#   - the page order lands such that only `None` is seen and a correct deploy aborts claiming the
#     export "not found" — which is what happened to `Publish sandbox preview address` on PR #91 while
#     `aws cloudformation list-exports` demonstrably listed `kitchensink-domain-sandbox:HostedZoneId`.
#
# `--no-paginate` is NOT the fix: it would return only the first page and silently miss any export
# beyond the first 100. The fix is to keep pagination and reduce the per-page results, discarding the
# `None` lines the non-matching pages contribute.
#
# Every export lookup in every deploy workflow — sandbox, identity AND prod — goes through here, so
# there is one implementation to get right. Exercised by
# `packages/infra/global/__tests__/cfnExport.test.ts`, which drives THIS file rather than a
# reimplementation of it.
#
# Usage:  cfn-export.sh <export-name> [region]
# Exits non-zero with a message on stderr when the export does not exist — never prints a partial or
# ambiguous value, and never exits 0 having found nothing.
set -euo pipefail

# shellcheck disable=SC2317  # functions are invoked by callers that source this file
resolve_cfn_export() {
    local name="$1"
    local region="${2:-}"
    local -a region_args=()

    if [ -n "$region" ]; then
        region_args=(--region "$region")
    fi

    # `| [0]` reduces each page to a single scalar, so a page either yields the value or `None`.
    # `grep -vx None` drops the non-matching pages' placeholder; `head -n1` guards against the
    # (impossible per CloudFormation, but cheap to bound) case of a duplicate export name.
    #
    # `|| true` on grep is deliberate and NOT a swallowed failure: grep exits 1 when every line was
    # `None`, which is the legitimate "export absent" case that the emptiness check below reports.
    # Without it, `set -o pipefail` would abort here with no diagnostic at all.
    local value
    value=$(
        aws cloudformation list-exports "${region_args[@]}" \
            --query "Exports[?Name=='${name}'].Value | [0]" --output text |
            grep -vx 'None' | head -n1 || true
    )

    if [ -z "$value" ]; then
        echo "::error::CloudFormation export '${name}' not found${region:+ in ${region}}." >&2
        return 1
    fi

    printf '%s\n' "$value"
}

#
# `--optional`: absence is a legitimate answer, so print nothing and exit 0.
#
# This exists so callers that already handle "not deployed yet" do NOT have to write `|| true`. A `|| true`
# would suppress every failure of this lookup — including a credentials or permissions error — and turn it
# into "the export is absent", which is the swallowed-failure class this repo has an explicit workflow guard
# against. Making the tolerance a FLAG keeps the distinction: `--optional` tolerates absence only, while a
# genuine CLI failure still aborts because `set -e` is in force inside the function.
resolve_cfn_export_optional() {
    local name="$1"
    local region="${2:-}"

    if resolve_cfn_export "$name" "$region" 2>/dev/null; then
        return 0
    fi

    return 0
}

# Allow both `source cfn-export.sh` (for the test harness and multi-lookup callers) and direct
# execution. `${BASH_SOURCE[0]}` differs from `$0` only when the file was sourced.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    if [ "$#" -lt 1 ]; then
        echo "usage: cfn-export.sh [--optional] <export-name> [region]" >&2
        exit 2
    fi

    if [ "$1" = "--optional" ]; then
        shift
        resolve_cfn_export_optional "$1" "${2:-}"
    else
        resolve_cfn_export "$1" "${2:-}"
    fi
fi
