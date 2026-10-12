#!/usr/bin/env bash
#
# Drive the sandbox scheduler Lambda from a workflow — the ONE way any workflow does it (ADR-0060).
#
# ⚠️  DELIBERATE — read docs/architecture/decisions/0060-sandbox-starts-only-by-hand.md before changing this.
#
#   sandboxScheduler.sh start <pr-N> [region]   # Sandbox Up only: RDS, the NAT, the shared tier, and that PR
#   sandboxScheduler.sh sync [region]           # after anything that changes what is up: switch scheduled rules
#
# Exit 0 on success, 1 on any failure, 2 on misuse (and nothing is invoked).
#
# ## Why a script rather than an inline `aws lambda invoke` per workflow
#
# Five workflows and the infra-package action drive this function. Each inline copy would have to remember that
# `aws lambda invoke` EXITS 0 WHEN THE FUNCTION THREW — the throw is reported in `FunctionError`, not the status —
# and an inline copy that forgot would report a scheduler that never ran as a success. That is the failure this
# file exists to make impossible to repeat.
#
# ## Why there is no `stop` verb
#
# The midnight schedule is the ONLY thing that stops the sandbox (owner ruling 2026-10-12). A workflow that wants a
# preview gone runs `teardownSandboxPr.sh`; it does not stop the tier every other preview stands on.
#
# ## Why an absent scheduler FAILS
#
# Every non-prod scheduled rule deploys DISABLED, and `sync` is the only thing that switches one on. A sync that
# cannot run therefore leaves every queue check and sweeper off while the sandbox is up — silently, behind a green
# deploy — so its absence is an error, never a skip.
set -uo pipefail

SANDBOX_SCHEDULER_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# The scheduler's function name, exported by `kitchensink-sandbox-scheduler-sandbox` (`SandboxSchedulerStack`).
SANDBOX_SCHEDULER_EXPORT='kitchensink-sandbox-scheduler-sandbox:SchedulerFunctionName'

# sandbox_scheduler_is_preview_token <stage>
#
# Pure. Exit 0 for `pr-` and a PR number with no leading zero — the same rule the function's own parser applies.
sandbox_scheduler_is_preview_token() {
    [[ "${1-}" =~ ^pr-[1-9][0-9]*$ ]]
}

# sandbox_scheduler_invoke <region> <payload>
#
# Resolve the function, invoke it once, and turn the answer into an exit status and annotations.
#
# @sideEffect Calls CloudFormation and Lambda, and writes a temp file.
sandbox_scheduler_invoke() {
    local region="$1" payload="$2" fn function_error response_file response

    if ! fn=$(bash "${SANDBOX_SCHEDULER_SCRIPT_DIR}/cfnExport.sh" "$SANDBOX_SCHEDULER_EXPORT" "$region"); then
        echo "::error::the sandbox scheduler is not deployed (no export ${SANDBOX_SCHEDULER_EXPORT}) — deploy packages/infra/global at stage sandbox. Until it runs, every scheduled job stays OFF." >&2
        return 1
    fi

    response_file=$(mktemp)
    echo "invoking ${fn} ${payload}"
    if ! function_error=$(aws lambda invoke --region "$region" --function-name "$fn" \
        --cli-read-timeout 310 --cli-connect-timeout 10 --no-cli-pager \
        --payload "$payload" --cli-binary-format raw-in-base64-out \
        --query 'FunctionError' --output text "$response_file"); then
        rm -f "$response_file"
        echo "::error::aws lambda invoke failed for ${fn} — the scheduler did not run." >&2
        return 1
    fi
    response=$(cat "$response_file" 2>/dev/null)
    rm -f "$response_file"
    echo "result: ${response}"

    # ⛔ `FunctionError` is the verdict, not the exit status: the handler THROWS when any resource or rule failed
    # (`assertRunSucceeded`), and the CLI reports that here while exiting 0.
    if [ -n "$function_error" ] && [ "$function_error" != 'None' ]; then
        echo "::error::the sandbox scheduler failed (${function_error}): ${response}" >&2
        return 1
    fi

    # Warnings do not fail the run; they are reported on every run until the gap closes.
    if ! printf '%s' "$response" | jq -r '.warnings[]? | "::warning::" + .' 2>/dev/null; then
        echo "::warning::could not read the scheduler's warnings from its answer; the run itself succeeded."
    fi

    return 0
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    case "${1-}" in
        start)
            if ! sandbox_scheduler_is_preview_token "${2-}"; then
                echo "::error::sandboxScheduler.sh start takes one PR token (pr-<N>); got '${2-}'. A start is for ONE PR — there is no start-everything." >&2
                exit 2
            fi
            sandbox_scheduler_invoke "${3:-${AWS_REGION:-us-east-1}}" "{\"action\":\"start\",\"stage\":\"${2}\"}"
            ;;
        sync)
            sandbox_scheduler_invoke "${2:-${AWS_REGION:-us-east-1}}" '{"action":"sync"}'
            ;;
        *)
            echo 'usage: sandboxScheduler.sh {start <pr-N> [region] | sync [region]}' >&2
            exit 2
            ;;
    esac
fi
