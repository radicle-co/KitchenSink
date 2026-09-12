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
# Usage:  cfn-export.sh [--optional] <export-name> [region]
#
# A lookup has THREE outcomes, and the exit status tells them apart:
#   0 — found; the value is on stdout, exactly one line.
#   1 — ABSENT; nothing on stdout, a `::error::` on stderr. The only status `--optional` tolerates.
#   2 — the LOOKUP FAILED (no credentials, no permission, no network); nothing on stdout, the CLI's own
#       diagnostic on stderr. Never reported as "not found", never tolerated by `--optional`.
# It never prints a partial or ambiguous value, and never exits 0 having found nothing.
set -euo pipefail

# Status codes, named so the two non-zero outcomes cannot be confused for one another. Plain assignments
# rather than `readonly`, because this file may be `source`d more than once and a second `readonly` of the
# same name is itself an error.
CFN_EXPORT_ABSENT=1
CFN_EXPORT_LOOKUP_FAILED=2

# The lookup itself: value on stdout and status 0 / $CFN_EXPORT_ABSENT / $CFN_EXPORT_LOOKUP_FAILED. It
# prints NO "not found" diagnostic of its own — that is the strict caller's decision, not the lookup's,
# because for `--optional` absence is an answer and not an error.
#
# shellcheck disable=SC2317  # functions are invoked by callers that source this file
cfn_export_lookup() {
    local name="$1"
    local region="${2:-}"
    local -a region_args=()

    if [ -n "$region" ]; then
        region_args=(--region "$region")
    fi

    # ⚠️ The CLI call is captured on its OWN, before any filtering, so that its exit status is observed
    # rather than folded into the pipeline. The previous shape — `aws … | grep | head || true` — could not
    # tell an auth failure from an absent export: under `pipefail` the CLI's 255 became the pipeline's
    # status, the `|| true` (there to absorb grep's exit 1 on an all-`None` page set) absorbed it too, and
    # an empty `value` was then reported as "not found". A wrong diagnosis in strict mode, and under
    # `--optional` a silent exit 0 — a credentials failure read as "not deployed yet".
    #
    # The CLI's stderr is deliberately NOT captured or suppressed: its message names the actual cause.
    local pages
    if ! pages=$(aws cloudformation list-exports "${region_args[@]}" \
        --query "Exports[?Name=='${name}'].Value | [0]" --output text); then
        echo "::error::aws cloudformation list-exports failed while resolving '${name}'${region:+ in ${region}} — this is a lookup failure (credentials, permissions, network), not an absent export." >&2
        return "$CFN_EXPORT_LOOKUP_FAILED"
    fi

    # `| [0]` reduces each page to a single scalar, so a page either yields the value or `None`.
    # `grep -vx None` drops the non-matching pages' placeholder; `head -n1` guards against the
    # (impossible per CloudFormation, but cheap to bound) case of a duplicate export name.
    #
    # `|| true` on grep is deliberate and NOT a swallowed failure: grep exits 1 when every line was
    # `None`, which is the legitimate "export absent" case reported by status below. It can only ever
    # absorb grep now — the CLI's status was already observed above.
    local value
    value=$(printf '%s\n' "$pages" | grep -vx 'None' | head -n1 || true)

    if [ -z "$value" ]; then
        return "$CFN_EXPORT_ABSENT"
    fi

    printf '%s\n' "$value"
}

# Strict: absence is an error, and says so.
resolve_cfn_export() {
    local name="$1"
    local region="${2:-}"
    local status=0

    cfn_export_lookup "$name" "$region" || status=$?

    if [ "$status" -eq "$CFN_EXPORT_ABSENT" ]; then
        echo "::error::CloudFormation export '${name}' not found${region:+ in ${region}}." >&2
    fi

    return "$status"
}

#
# `--optional`: ABSENCE is a legitimate answer, so print nothing and exit 0. Nothing else is.
#
# This exists so callers that already handle "not deployed yet" do NOT have to write `|| true`. A `|| true`
# would suppress every failure of this lookup — including a credentials or permissions error — and turn it
# into "the export is absent", which is the swallowed-failure class this repo has an explicit workflow guard
# against. The tolerance is keyed on the STATUS, not on the exit being non-zero: only $CFN_EXPORT_ABSENT is
# mapped to 0, so a lookup failure still propagates (with the CLI's diagnostic intact) and aborts the
# caller's `set -e` assignment. The earlier form ran the strict lookup inside an `if` — which disables
# `errexit` for the tested command — and returned 0 on every branch, so it tolerated everything.
resolve_cfn_export_optional() {
    local name="$1"
    local region="${2:-}"
    local status=0

    cfn_export_lookup "$name" "$region" || status=$?

    if [ "$status" -eq "$CFN_EXPORT_ABSENT" ]; then
        return 0
    fi

    return "$status"
}

# Allow both `source cfn-export.sh` (for the test harness and multi-lookup callers) and direct
# execution. `${BASH_SOURCE[0]}` differs from `$0` only when the file was sourced.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    if [ "$#" -lt 1 ]; then
        echo "usage: cfn-export.sh [--optional] <export-name> [region]" >&2
        # EX_USAGE, not 2 — 2 now means "the lookup failed" and a caller bug must not read as one.
        exit 64
    fi

    if [ "$1" = "--optional" ]; then
        shift
        resolve_cfn_export_optional "$1" "${2:-}"
    else
        resolve_cfn_export "$1" "${2:-}"
    fi
fi
