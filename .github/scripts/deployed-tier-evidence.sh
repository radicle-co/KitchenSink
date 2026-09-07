#!/usr/bin/env bash
#
# Did this pull request produce ANY evidence from a deployed environment?
#
# ⚠️  DELIBERATE — read docs/architecture/decisions/0032-deployed-ecosystem-test-tier.md first.
#
# ## What this exists for
#
# ADR-0032 records the owner's ruling that an end-to-end test targets a DEPLOYED environment and SKIPS when
# the PR's sandbox is not running, and that a PR which ran no e2e tests is GREEN. That ruling stands and
# this script does not touch it.
#
# What it closes is the gap the ADR states in the same breath and leaves open: **a PR merged without ever
# raising a sandbox has had no end-to-end test of any kind, and nothing says so.** The mitigation was the
# `sandbox-up` label plus a manual job, "and neither is enforced by a check". A label a human has to
# remember is a single point of failure whose failure mode is silence — every deployed tier skips, the PR is
# green, and the skip looks exactly like a pass.
#
# So this does not force the tiers to run. It forces the DECISION to be visible: either something ran, or
# somebody said in the open that nothing needed to.
#
# ## The verdict
#
#   ok       — at least one deployed tier ran, OR the run is not a pull request, OR the opt-out is present
#   missing  — a pull request where every deployed tier skipped and nobody said why
#
# ⚠️ A tier that FAILED counts as evidence, not as a miss. It ran against a deployed environment and said
# something; reporting it here as well would be a second red for one defect, aimed at the wrong step.
#
#   deployed-tier-evidence.sh verdict <event> <optOut> <result>...   # pure
set -uo pipefail

# evidence_verdict <eventName> <optOutPresent:true|false> <result>...
#
# Pure. Prints `verdict=ok|missing` and `reason=<one line>`.
evidence_verdict() {
    if [ "$#" -lt 2 ]; then
        echo "usage: deployed-tier-evidence.sh verdict <event> <optOut> <result>..." >&2

        return 2
    fi

    local event="$1" opt_out="$2"
    shift 2

    local ran=0 skipped=0 failed=0 result
    for result in "$@"; do
        case "$result" in
            success) ran=$((ran + 1)) ;;
            failure) failed=$((failed + 1)) ;;
            *) skipped=$((skipped + 1)) ;;
        esac
    done

    # Only a pull request can be missing evidence. A push to a branch, a schedule or a dispatch has no
    # merge decision attached to it, so there is nothing here to protect.
    if [ "$event" != 'pull_request' ]; then
        printf 'verdict=ok\nreason=%s\n' "not a pull request (${event}) — nothing to gate"

        return 0
    fi

    if [ "$ran" -gt 0 ] || [ "$failed" -gt 0 ]; then
        printf 'verdict=ok\nreason=%s\n' \
            "${ran} deployed tier(s) passed, ${failed} failed, ${skipped} skipped — this PR has deployed evidence"

        return 0
    fi

    if [ "$opt_out" = 'true' ]; then
        printf 'verdict=ok\nreason=%s\n' \
            "every deployed tier skipped, and the PR carries the opt-out label — recorded as a deliberate choice"

        return 0
    fi

    printf 'verdict=missing\nreason=%s\n' \
        "all ${skipped} deployed tier(s) skipped and no opt-out is present — this PR has never been exercised against a deployed environment"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    case "${1-}" in
        verdict)
            shift
            evidence_verdict "$@"
            ;;
        *)
            echo "usage: deployed-tier-evidence.sh verdict <event> <optOut> <result>..." >&2
            exit 2
            ;;
    esac
fi
