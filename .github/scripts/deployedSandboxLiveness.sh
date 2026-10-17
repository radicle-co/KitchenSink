#!/usr/bin/env bash
#
# The ONE answer to "is the deployed sandbox still up?" for a test tier that is about to drive it, or is driving it.
#
# Two callers ask it, and they must never hold separate copies of the rule:
#   * each Maestro shard's START probe (`_ci-heavy.yml`, Android and iOS), which gates the stage-secrets valve;
#   * the Maestro flow loop (`runMaestroFlows.sh`, via `MAESTRO_SANDBOX_LIVENESS`), which asks again after a flow or
#     a reset FAILS, because the midnight stop can land mid-shard and a red caused by absence is not an app defect.
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
# `DEPLOY_GATE_SCRIPT` replaces the gate (a test seam; unset in CI).
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

case "${1-}" in
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
