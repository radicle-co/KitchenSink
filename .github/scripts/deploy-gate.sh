#!/usr/bin/env bash
#
# The per-PR **ensure-exists** deploy gate (issue #124).
#
# ⚠️  DELIBERATE — see docs/architecture/decisions/0010-ensure-exists-per-pr-deploy-gate.md
#
# A PR preview must be a COMPLETE ecosystem: recipe-service, recipe-workers AND food-service all present
# for `pr-{N}`, with the web preview pointed at them. Gating each deploy job purely on
# `dorny/paths-filter` did not give that — a recipe-only PR deployed no food service, so the REQUIRED
# `RECIPE_FOOD_SERVICE_URL` named a `food-pr-{N}` host that did not resolve and the ingredient typeahead
# silently degraded to `catalogAvailability: 'unavailable'` for the whole preview.
#
# The crude fix ("always redeploy everything") rebuilds and pushes two Docker images for a README-only
# push. This gate encodes the cheaper semantics that still satisfies the guarantee:
#
#   deploy  ⟸  the sources CHANGED
#          ∨   the run was manually dispatched
#          ∨   a per-PR stack is ABSENT or in an unusable resting state   ← "ensure-exists"
#          ∨   the origin it should be serving does not answer 200        ← "ensure-SERVING"
#   skip    ⟸  none of the above (unchanged AND already serving)
#
# So a fresh docs-only PR deploys the whole ecosystem on its FIRST event (nothing exists yet) and every
# later push to it skips; a preview that was reaped, half-rolled-back, or lost its tasks self-heals on the
# next push. The decision is per-JOB, not per-service-file, so the two callers (food, recipe) share ONE
# definition of "already deployed" instead of two drifting copies of a status allowlist.
#
# `decide` is PURE: no I/O, no AWS calls, no network — inputs in, verdict out. All I/O lives in
# `evaluate`. Both are regression-tested for real (the tests execute THIS file rather than
# re-implementing it) by packages/infra/global/__tests__/deployGate{,.integration}.test.ts.
#
# Usage — as a CLI:
#     deploy-gate.sh decide   <intent> <changed> <forced> <healthCode> <name=STATUS> [<name=STATUS> …]
#     deploy-gate.sh evaluate <intent> <service> <changed> <forced> <healthUrl> <region> <stack> [<stack> …]
#
# `evaluate` writes `deploy=` and `reason=` to stdout and, when set, appends them to $GITHUB_OUTPUT.
# Exit status: 0 = a decision was made (read `deploy=`), 2 = misuse (never treat as "skip").
set -uo pipefail

# CloudFormation statuses in which a stack is deployed and usable AS-IS. Everything else — ABSENT (our
# substitute for a failed describe-stacks), the *_FAILED resting states, ROLLBACK_COMPLETE (a create that
# never succeeded), REVIEW_IN_PROGRESS (a change set that was never executed), and any *_IN_PROGRESS —
# means the preview cannot be relied upon, so the job re-runs. UPDATE_ROLLBACK_COMPLETE is usable: the
# LAST update failed but the stack is intact at its previous, working revision.
DEPLOY_GATE_USABLE_STATUSES='CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE IMPORT_COMPLETE'

# The status this script substitutes when `describe-stacks` finds nothing (or cannot be trusted). It is a
# value, not an error, so "the stack does not exist yet" flows through the same pure decision as every
# other state — which is the whole point of ensure-exists.
DEPLOY_GATE_ABSENT='ABSENT'

# deploy_gate_stack_is_usable <status>
#
# True iff <status> is one of DEPLOY_GATE_USABLE_STATUSES. Pure.
deploy_gate_stack_is_usable() {
    case " $DEPLOY_GATE_USABLE_STATUSES " in
        *" ${1-} "*) return 0 ;;
        *) return 1 ;;
    esac
}

# deploy_gate_decide <intent> <changed> <forced> <healthCode> <name=STATUS> [<name=STATUS> …]
#
# ⚠️  <intent> is the ON-DEMAND SANDBOX amendment, and it inverts what an absent stack means.
#
# ADR-0010 made ABSENT a reason to DEPLOY, because a preview missing one of its services is broken. Once
# sandboxes are torn down at midnight, absent stops meaning "broken" and starts meaning "deliberately
# reaped" — and ensure-exists, left alone, rebuilds every environment on the first push after the reaper
# ran. Silently. Behind a green check. That is ADR-0010's own failure mode running backwards, and it would
# quietly restore the entire bill.
#
# So absence alone no longer deploys. It deploys when the sandbox is SUPPOSED to be up — `intent`, carried
# by the `sandbox-up` PR label the button applies and the hourly reconciler removes — and then only under
# the original ensure-exists rules. A manual dispatch still deploys unconditionally, because pressing the
# button IS the expression of intent.
#
# The gate's whole decision, as a pure function. Prints exactly two lines — `deploy=true|false` and
# `reason=<one line>` — and nothing else on stdout. Misuse exits 2 WITHOUT printing a verdict: a gate that
# answers "skip" on malformed input is how a preview ends up half-deployed behind a green check.
#
# <healthCode> is an HTTP status, or `000` for curl's "no response at all" (DNS failure, refused
# connection, TLS failure, timeout).
deploy_gate_decide() {
    local intent="${1-}" changed="${2-}" forced="${3-}" health="${4-}"
    shift 4 2>/dev/null || {
        echo "usage: deploy-gate.sh decide <intent> <changed> <forced> <healthCode> <name=STATUS>…" >&2
        return 2
    }

    case "$intent" in true | false) ;; *)
        echo "deploy-gate: <intent> must be 'true' or 'false', got '${intent}'" >&2
        return 2
        ;;
    esac
    case "$changed" in true | false) ;; *)
        echo "deploy-gate: <changed> must be 'true' or 'false', got '${changed}'" >&2
        return 2
        ;;
    esac
    case "$forced" in true | false) ;; *)
        echo "deploy-gate: <forced> must be 'true' or 'false', got '${forced}'" >&2
        return 2
        ;;
    esac
    if ! [[ $health =~ ^[0-9]{3}$ ]]; then
        echo "deploy-gate: <healthCode> must be a three-digit HTTP code (000 = no response), got '${health}'" >&2
        return 2
    fi
    if [ "$#" -eq 0 ]; then
        echo "deploy-gate: at least one <name=STATUS> stack pair is required" >&2
        return 2
    fi

    local pair name status
    for pair in "$@"; do
        name="${pair%%=*}"
        status="${pair#*=}"
        if [ -z "$name" ] || [ "$name" = "$pair" ] || ! [[ $status =~ ^[A-Z_]+$ ]]; then
            echo "deploy-gate: stack argument must be <name>=<STATUS>, got '${pair}'" >&2
            return 2
        fi
    done

    # A manual dispatch is an explicit instruction; there is no PR diff to filter on, so never talk it out
    # of deploying.
    if [ "$forced" = 'true' ]; then
        deploy_gate_emit true 'manual workflow_dispatch — deploying unconditionally'

        return 0
    fi

    # The on-demand gate. Checked AFTER `forced` (the button is how intent is declared) and BEFORE every
    # reason to deploy, because each of those reasons — changed, absent, unhealthy — is equally true of an
    # environment that was deliberately torn down last midnight.
    if [ "$intent" = 'false' ]; then
        deploy_gate_emit false \
            'no live sandbox for this PR (it was torn down, or never started) — press Run workflow to start one'

        return 0
    fi

    if [ "$changed" = 'true' ]; then
        deploy_gate_emit true 'the service sources changed on this PR'

        return 0
    fi

    # ensure-exists. Reported per stack and named, because "which one is missing" is the first thing anyone
    # reading the log needs.
    for pair in "$@"; do
        name="${pair%%=*}"
        status="${pair#*=}"
        if ! deploy_gate_stack_is_usable "$status"; then
            deploy_gate_emit true \
                "unchanged, but stack ${name} is ${status} — a per-PR preview is INCOMPLETE without it (issue #124)"

            return 0
        fi
    done

    # ensure-SERVING. A converged stack is not a working service: Spot reclamation, an unpullable image, or
    # a target group with no healthy members all leave CloudFormation reporting UPDATE_COMPLETE.
    if [ "$health" = '000' ]; then
        deploy_gate_emit true \
            'unchanged and the stacks exist, but the origin did not answer at all (000 — DNS, connection, TLS or timeout); redeploying to repair it'

        return 0
    fi
    if [ "$health" != '200' ]; then
        deploy_gate_emit true \
            "unchanged and the stacks exist, but the origin answered ${health} instead of 200; redeploying to repair it"

        return 0
    fi

    deploy_gate_emit false 'unchanged and already deployed and serving (all stacks usable, origin 200) — skipping'
}

# deploy_gate_emit <deploy> <reason>
#
# Print the two-line verdict. Kept separate so the decision reads as a table of cases.
deploy_gate_emit() {
    printf 'deploy=%s\nreason=%s\n' "${1}" "${2}"
}

# deploy_gate_stack_status <region> <stackName>
#
# Echo the stack's CloudFormation status, or DEPLOY_GATE_ABSENT when it does not exist / cannot be read.
# A read failure deliberately reads as ABSENT: erring towards "deploy it" can only cost a deploy, whereas
# erring towards "skip" ships an incomplete preview behind a green check.
#
# @sideEffect Calls the CloudFormation API.
deploy_gate_stack_status() {
    local status
    status=$(aws cloudformation describe-stacks --region "$1" --stack-name "$2" \
        --query 'Stacks[0].StackStatus' --output text 2>/dev/null) || status=''
    if [ -z "$status" ] || [ "$status" = 'None' ]; then
        status="$DEPLOY_GATE_ABSENT"
    fi
    echo "$status"
}

# deploy_gate_probe <url>
#
# Echo the HTTP status the URL answers with, or `000` when nothing answered. Retries so a single transient
# blip cannot trigger a full image rebuild + redeploy. The attempt count / delay are overridable ONLY so
# the integration suite can drive the real retry loop against a real socket without sleeping for it.
#
# @sideEffect Performs HTTP requests and sleeps between attempts.
deploy_gate_probe() {
    local url="$1" attempt code=000
    local attempts="${DEPLOY_GATE_PROBE_ATTEMPTS:-3}" delay="${DEPLOY_GATE_PROBE_DELAY_SECONDS:-5}"
    for ((attempt = 1; attempt <= attempts; attempt++)); do
        code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null) || code=000
        [ -z "$code" ] && code=000
        [ "$code" = '200' ] && break
        [ "$attempt" -lt "$attempts" ] && sleep "$delay"
    done
    echo "$code"
}

# deploy_gate_evaluate <intent> <service> <changed> <forced> <healthUrl> <region> <stack> [<stack> …]
#
# Resolve the live state, decide, and publish the verdict to $GITHUB_OUTPUT. The probes run
# UNCONDITIONALLY — even when the answer is already "deploy" — so the log always records the state the
# decision was made against, and so no future reordering of the pure cases can silently read a
# placeholder.
#
# @sideEffect Calls CloudFormation, performs HTTP requests, writes stdout and $GITHUB_OUTPUT.
deploy_gate_evaluate() {
    local intent="${1-}" service="${2-}" changed="${3-}" forced="${4-}" health_url="${5-}" region="${6-}"
    if [ "$#" -lt 7 ] || [ -z "$service" ] || [ -z "$health_url" ] || [ -z "$region" ]; then
        echo "usage: deploy-gate.sh evaluate <intent> <service> <changed> <forced> <healthUrl> <region> <stack>…" >&2
        return 2
    fi
    shift 6

    local pairs=() stack status
    for stack in "$@"; do
        status=$(deploy_gate_stack_status "$region" "$stack")
        echo "[deploy-gate/${service}] stack ${stack} → ${status}"
        pairs+=("${stack}=${status}")
    done

    local health
    health=$(deploy_gate_probe "$health_url")
    echo "[deploy-gate/${service}] GET ${health_url} → ${health}"

    local verdict
    verdict=$(deploy_gate_decide "$intent" "$changed" "$forced" "$health" "${pairs[@]}") || return 2

    echo "$verdict"
    if [ -n "${GITHUB_OUTPUT:-}" ]; then
        echo "$verdict" >>"$GITHUB_OUTPUT"
    fi
    case "$verdict" in
        deploy=true*) echo "::notice::[${service}] deploying — $(echo "$verdict" | sed -n 's/^reason=//p')" ;;
        *) echo "::notice::[${service}] skipping — $(echo "$verdict" | sed -n 's/^reason=//p')" ;;
    esac
}

# CLI dispatch — only when executed directly, never when sourced.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    case "${1-}" in
        decide)
            shift
            deploy_gate_decide "$@"
            ;;
        evaluate)
            shift
            deploy_gate_evaluate "$@"
            ;;
        stack-usable)
            deploy_gate_stack_is_usable "${2-}"
            ;;
        *)
            echo "usage: deploy-gate.sh decide|evaluate|stack-usable …" >&2
            exit 2
            ;;
    esac
fi
