#!/usr/bin/env bash
#
# The schema-migration SAFETY NET — ONE definition, invoked by every deploy workflow.
#
# ⚠️  DELIBERATE — read docs/architecture/decisions/0022-in-stack-migration-trigger.md before changing this.
#
# ## Why it runs UNCONDITIONALLY
#
# ADR-0022 moved the schema apply INSIDE the deploy, as an `aws-cdk-lib/triggers` Trigger every Lambda and
# ECS service in the stack is ordered behind. That Trigger is the MECHANISM. This invoke is the stated SAFETY
# NET, kept "because it is idempotent and catches a stage whose schema is behind for a reason no code change
# explains: a restore, a stage created later, a `deploy_webhooks`-only run" (§4).
#
# ⛔ The net used to be gated on the same path-diff flag as the deploy it followed — so in the ONE case it
# exists for, a schema behind for a reason NO CODE CHANGE EXPLAINS, the flag was `false`: no `cdk deploy`, so
# the Trigger never fired, the invoke was skipped, and the deploy reported success against an unmigrated
# database. The net covered exactly the runs that did not need it. Sandbox never had that hole, because
# ADR-0010's ensure-exists gate forces a deploy when the stack is absent or the origin is not serving — which
# made PRODUCTION the weaker stage, the inverse of what anybody would assume.
#
# Running every time is safe, and that is a property of the runner rather than optimism: `schema_migrations`
# is keyed by FILENAME (`name TEXT PRIMARY KEY`, no checksum) and the runner skips on a name match, so a run
# against an up-to-date database applies nothing and costs one Lambda invocation.
#
# ⛔ Do NOT hoist a call to this script ABOVE the `cdk deploy` that ships the runner's bundle. `esbuild.mjs`
# copies `migrations/*.sql` into the bundle at BUILD time and the bundle ships WITH the deploy, so invoking
# first invokes the PREVIOUS release's runner carrying the PREVIOUS migration set — exit 0, "nothing
# pending", nothing applied. Position is load-bearing; the GATE is what changed.
#
# ## Why `aws lambda invoke`'s exit status proves nothing
#
# The CLI exits 0 when the FUNCTION threw: the failure is in the response, not in the status. Three call
# sites had three different amounts of rigour about that — `sandbox-deploy.yml`'s recipe leg grepped the
# payload for `errorType`, the identity legs read `FunctionError`, and the FOOD leg inspected NEITHER, so a
# migration runner that threw left the step green and the deploy continued onto a schema that had not moved.
# `classify` is the one definition of "did the runner succeed", so there is nothing left to drift.
#
# `run_migrations_classify` is PURE; every AWS call lives in `run_migrations_run`. Both halves are executed —
# not re-implemented — by packages/infra/global/__tests__/runMigrations.test.ts and
# packages/infra/global/tests/runMigrations.integration.test.ts.
#
# ## Usage
#
#     run-migrations.sh run      <region> <stackName> <outputKey> <label>
#     run-migrations.sh classify <functionError> <payload>
#
# Exit status: 0 = the schema is current (or there is no stack to migrate), 1 = the runner failed or could
# not be found, 2 = misuse. A misuse NEVER exits 0.
set -uo pipefail

# run_migrations_emit <verdict> <reason>
run_migrations_emit() {
    printf 'verdict=%s\nreason=%s\n' "${1}" "${2}"
}

# run_migrations_classify <functionError> <payload>
#
# Did the migration runner succeed? Pure. Prints `verdict=ok|failed` and `reason=<one line>`.
#
# Both inputs are consulted because either can carry the fault alone: an UNHANDLED throw sets
# `FunctionError` and puts `errorType` in the payload, while a HANDLED one can report the failure in the
# payload with `FunctionError` unset. Reading only one is how the food leg stayed green through a failure.
run_migrations_classify() {
    local function_error="${1-}" payload="${2-}"

    if [ "$#" -lt 2 ]; then
        echo "usage: run-migrations.sh classify <functionError> <payload>" >&2

        return 2
    fi

    # `None` is what `--query FunctionError --output text` prints when the function did NOT throw.
    case "$function_error" in
        None | none | '' | null) ;;
        *)
            run_migrations_emit failed \
                "the runner threw: FunctionError=${function_error}. Payload: ${payload}"

            return 0
            ;;
    esac

    case "$payload" in
        *'"errorType"'*)
            run_migrations_emit failed "the runner returned an errorType. Payload: ${payload}"

            return 0
            ;;
    esac

    if [ -z "$payload" ]; then
        # An invoke that wrote no payload at all did not run the function we asked for. `null` is a
        # DIFFERENT thing — a handler that returns nothing — and is accepted below.
        run_migrations_emit failed 'the invoke returned no payload at all, so nothing about the schema was proved'

        return 0
    fi

    run_migrations_emit ok "migrations ran clean. Payload: ${payload}"
}

# run_migrations_run <region> <stackName> <outputKey> <label>
#
# Resolve the runner from the stack's own output, invoke it, and classify the answer.
#
# ⚠️ An ABSENT STACK is a stated SKIP, not a failure: there is no database of ours behind a stack that does
# not exist, and a service's absence is ADR-0010's concern (and `deployVerificationCoverage.test.ts`'s), not
# this script's. A stack that EXISTS but publishes no such output IS a failure — that is a runner which lost
# its `CfnOutput`, which is precisely how a migration path becomes unreachable while every check stays green.
#
# @sideEffect Calls CloudFormation and Lambda, and writes a temp file.
run_migrations_run() {
    local region="${1-}" stack="${2-}" output_key="${3-}" label="${4-}"

    if [ "$#" -lt 4 ] || [ -z "$region" ] || [ -z "$stack" ] || [ -z "$output_key" ] || [ -z "$label" ]; then
        echo "usage: run-migrations.sh run <region> <stackName> <outputKey> <label>" >&2

        return 2
    fi

    local outputs
    outputs=$(aws cloudformation describe-stacks --region "$region" --stack-name "$stack" \
        --query "Stacks[0].Outputs" --output json 2>/dev/null) || {
        echo "::notice::[${label}] ${stack} does not exist, so there is no schema of ours to migrate. Skipping — a service's absence is the deploy gate's concern, not the migration net's."

        return 0
    }

    local fn
    fn=$(printf '%s' "$outputs" | jq -r --arg key "$output_key" '(. // []) | map(select(.OutputKey == $key)) | .[0].OutputValue // empty')

    if [ -z "$fn" ]; then
        echo "::error::[${label}] ${stack} exists but publishes no '${output_key}' output, so its migration runner cannot be reached. The in-stack Trigger may still be applying the schema, but the ADR-0022 §4 safety net is BLIND here — give the runner a CfnOutput."

        return 1
    fi

    echo "[${label}] invoking migration runner ${fn}"

    local payload_file function_error payload verdict reason
    payload_file=$(mktemp)
    function_error=$(aws lambda invoke --region "$region" --function-name "$fn" \
        --payload '{"action":"migrate"}' --cli-binary-format raw-in-base64-out \
        --query 'FunctionError' --output text "$payload_file" 2>/dev/null) || function_error='InvokeFailed'
    payload=$(cat "$payload_file" 2>/dev/null)
    rm -f "$payload_file"

    verdict=$(run_migrations_classify "$function_error" "$payload") || return 2
    reason=$(printf '%s' "$verdict" | sed -n 's/^reason=//p')

    case "$verdict" in
        verdict=ok*)
            echo "[${label}] ${reason}"

            return 0
            ;;
        *)
            echo "::error::[${label}] schema migration FAILED — ${reason}"

            return 1
            ;;
    esac
}

# CLI dispatch — only when executed directly, never when sourced.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    case "${1-}" in
        classify)
            shift
            run_migrations_classify "$@"
            ;;
        run)
            shift
            run_migrations_run "$@"
            ;;
        *)
            echo "usage: run-migrations.sh run|classify …" >&2
            exit 2
            ;;
    esac
fi
