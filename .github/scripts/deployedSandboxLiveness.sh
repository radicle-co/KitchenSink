#!/usr/bin/env bash
#
# The answers to two DIFFERENT questions about the deployed sandbox, kept apart on purpose.
#
#   check   "is it serving?"   Each Maestro shard's START probe (`_ci-heavy.yml`, Android and iOS), which gates the
#                              stage-secrets valve. Health, stack status and seed currency are the right inputs here.
#   stopped "was it STOPPED?"  The Maestro flow loop (`runMaestroFlows.sh`, via `MAESTRO_SANDBOX_STOPPED`), which asks
#                              after a flow or a reset FAILS, because the midnight stop can land mid-shard.
#
# ⛔ The second must NOT be the first. Owner rule: a skip only because the sandbox is DOWN. "Not serving" also covers a
# task the flow just crashed, a `503`, a redeploy and a rollback, and turning those into a skip is a green over a real
# defect. `stopped` therefore reads only the stop's own facts and never a health URL: the shared tier is stopped or
# stopping (`sandboxWake.sh check` exits 3, the same facts the scheduler and the wake check use), or this stage's
# service stacks are being or have been deleted (the midnight reclaim). It must hold on TWO probes a short interval
# apart, and anything unreadable is NOT stopped. A service that is up but unhealthy stays RED.
#
# The rule: the sandbox is live only when BOTH recipe and food answer `live=true` AND neither wants a deploy
# (`deploy=false`). `live=true, deploy=true` means the gate is about to CREATE or REPLACE the environment.
# The questions asked (which stacks, which health URLs) are the resolver job's own in `_ci-heavy.yml`, byte for
# byte after whitespace; `maestroRerunLiveness.test.ts` holds the two equal.
#
# Usage:
#     deployedSandboxLiveness.sh check <stage> <region> <recipeOrigin> <foodOrigin>
#
# Prints the two gate verdicts, then `live=true|false` and `reason=…` as its final two lines. Callers read the LAST
# `live=` line (the gate's own verdicts carry `live=` keys too). Exit 0 = a verdict was printed; 2 = misuse; any
# other status = the gate itself failed, which a caller must treat as UNKNOWN, never as "down".
#
# `stopped` usage: deployedSandboxLiveness.sh stopped <stage> <region>. Prints `stopped=true|false` and `reason=…` as
# its final two lines (a caller reads the LAST `stopped=`); exit 0 = a verdict was printed, 2 = misuse.
#
# Test seams, all unset in CI: `DEPLOY_GATE_SCRIPT` replaces the gate, `SANDBOX_WAKE_SCRIPT` the status check, and
# `STOPPED_CONFIRM_INTERVAL_SECONDS` (default 20) the wait between the two probes.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# @sideEffect Calls AWS (CloudFormation, Lambda) and the services' /health endpoints through deployGate.sh.
liveness_check() {
    local STAGE="$1" DEFAULT_AWS_REGION="$2" RECIPE_ORIGIN="$3" FOOD_ORIGIN="$4"

    # Run the gate with its GITHUB_OUTPUT suppressed and capture the verdict, so both services
    # can be asked without the second answer clobbering the first.
    ask() {
        local service="$1" health="$2" seed="$3"
        shift 3
        GITHUB_OUTPUT='' bash "${DEPLOY_GATE_SCRIPT:-${here}/deployGate.sh}" evaluate \
            true "${service}" false false "${health}" "${DEFAULT_AWS_REGION}" "${seed}" "$@"
    }

    field() {
        printf '%s\n' "$1" | sed -n "s/^${2}=//p" | tail -1
    }

    recipe_verdict=$(ask recipe "${RECIPE_ORIGIN}/health" none \
        "kitchensink-ingredient-parser-${STAGE}" \
        "kitchensink-recipe-schema-${STAGE}" \
        "kitchensink-recipe-workers-${STAGE}" \
        "kitchensink-recipe-service-${STAGE}")
    echo "${recipe_verdict}"

    food_verdict=$(ask food "${FOOD_ORIGIN}/health" \
        "kitchensink-food-schema-${STAGE}:FoodSeedFunctionName" \
        "kitchensink-food-schema-${STAGE}" \
        "kitchensink-food-service-${STAGE}")
    echo "${food_verdict}"

    live='false'
    if [ "$(field "${recipe_verdict}" live)" = 'true' ] &&
        [ "$(field "${recipe_verdict}" deploy)" = 'false' ] &&
        [ "$(field "${food_verdict}" live)" = 'true' ] &&
        [ "$(field "${food_verdict}" deploy)" = 'false' ]; then
        live='true'
    fi

    echo "live=${live}"
    echo "reason=recipe: $(field "${recipe_verdict}" reason). food: $(field "${food_verdict}" reason)"
}

# stopped_probe <stage> <region>
#
# One reading of the stop's own facts. Prints `true <reason>` or `false <reason>`.
# The status check runs with NO pre-midnight headroom (that rule answers "will it still be up when I finish?", which
# would call a live sandbox down for the 45 minutes before the stop) and NO wait for a starting resource.
#
# @sideEffect Calls AWS (RDS, EC2, CloudFormation) through the status check and `describe-stacks`.
stopped_probe() {
    local stage="$1" region="$2" wake_rc=0 gone=0 stack output
    local wake_script="${SANDBOX_WAKE_SCRIPT:-${here}/sandboxWake.sh}"

    SANDBOX_WAKE_REQUIRED_HEADROOM_SECONDS=0 SANDBOX_WAKE_TIMEOUT_SECONDS=0 SANDBOX_WAKE_POLL_SECONDS=0 \
        bash "${wake_script}" check "${region}" >/dev/null 2>&1 || wake_rc=$?
    if [ "${wake_rc}" -eq 3 ]; then
        echo 'true the shared tier is stopped or stopping'
        return 0
    fi

    for stack in "kitchensink-recipe-service-${stage}" "kitchensink-food-service-${stage}"; do
        if output=$(aws cloudformation describe-stacks --stack-name "${stack}" --query 'Stacks[0].StackStatus' --output text 2>&1); then
            case "${output}" in
                DELETE_IN_PROGRESS | DELETE_COMPLETE) gone=$((gone + 1)) ;;
            esac
        elif [[ "${output}" == *'does not exist'* ]]; then
            gone=$((gone + 1))
        else
            echo "false could not read ${stack} (${output//$'\n'/ }), so a stop is not proven"
            return 0
        fi
    done

    if [ "${gone}" -eq 2 ]; then
        echo "true ${stage}'s service stacks were reclaimed"
    else
        echo "false the shared tier is up and ${stage}'s service stacks are not both gone (status check exit ${wake_rc})"
    fi
}

# stopped_check <stage> <region>: two probes, an interval apart, both of which must say stopped.
#
# @sideEffect Calls AWS twice (see stopped_probe) and sleeps between.
stopped_check() {
    local first second
    first=$(stopped_probe "$1" "$2")

    if [ "${first%% *}" = 'true' ]; then
        sleep "${STOPPED_CONFIRM_INTERVAL_SECONDS:-20}"
        second=$(stopped_probe "$1" "$2")
        if [ "${second%% *}" = 'true' ]; then
            echo 'stopped=true'
            echo "reason=${first#* }; confirmed: ${second#* }"
            return 0
        fi
        first="false the stop was not confirmed by a second probe: ${second#* }"
    fi

    echo 'stopped=false'
    echo "reason=${first#* }"
}

case "${1-}" in
    stopped)
        if [ "$#" -ne 3 ]; then
            echo "usage: deployedSandboxLiveness.sh stopped <stage> <region>" >&2
            exit 2
        fi
        stopped_check "$2" "$3"
        ;;
    check)
        if [ "$#" -ne 5 ]; then
            echo "usage: deployedSandboxLiveness.sh check <stage> <region> <recipeOrigin> <foodOrigin>" >&2
            exit 2
        fi
        liveness_check "$2" "$3" "$4" "$5"
        ;;
    *)
        echo "usage: deployedSandboxLiveness.sh check <stage> <region> <recipeOrigin> <foodOrigin>" >&2
        exit 2
        ;;
esac
