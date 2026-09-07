#!/usr/bin/env bash
#
# The schema apply — ONE definition, invoked by every deploy workflow.
#
# ⚠️  DELIBERATE — read docs/architecture/decisions/0035-schema-stacks-decoupled-from-service-deploys.md
# before changing this. (ADR-0022 is SUPERSEDED by it and kept as the record of the in-stack posture.)
#
# ## This is the MECHANISM, not a safety net
#
# It used to be the net behind an `aws-cdk-lib/triggers` Trigger that applied the schema inside each
# service's deploy. That Trigger is gone. Each database's runner now lives in its own stack
# (`kitchensink-{svc}-schema-{stage}`), deployed by its own pipeline step, and THIS invoke is what applies
# the schema — ahead of every consumer, in every app, which is more than a Trigger could ever reach
# (`DependsOn` cannot leave a stack, which is why recipe needed two runners for one database).
#
# ## Why it runs UNCONDITIONALLY, and why the deploy before it does not
#
# ⛔ The invoke is ungated. A gate on a path diff skips it in the ONE case it exists for — a stage whose
# schema is behind for a reason NO CODE CHANGE explains: a restore, a stage created later, a
# `deploy_webhooks`-only run. That mistake was live once: the net was gated on the same flag as the deploy
# it followed, so it covered exactly the runs that did not need it, and PRODUCTION was the weaker stage
# because sandbox's ensure-exists gate (ADR-0010) forces a deploy the flag would not.
#
# ⚠️ The schema `cdk deploy` that precedes it IS gated, on the same flag as the step that bundles its asset,
# and the asymmetry is deliberate rather than an oversight. That step has INPUTS; ungated, it runs on a push
# that built neither the CDK app nor `dist-lambda/` — at best `MODULE_NOT_FOUND`, at worst a SUCCESSFUL
# deploy of the throwing inline placeholder over a working runner. Gating costs nothing because the property
# lives HERE: a service's migrations are under that service's own path, so either they changed and the flag
# is true, or the deployed runner still holds a set whose digest matches the tree.
# `packages/infra/global/__tests__/schemaDeployGating.test.ts` asserts it.
#
# Running every time is safe, and that is a property of the runner rather than optimism: `schema_migrations`
# is keyed by FILENAME (`name TEXT PRIMARY KEY`, no checksum) and the runner skips on a name match, so a run
# against an up-to-date database applies nothing and costs one Lambda invocation.
#
# ## ⛔ POSITION IS STILL LOAD-BEARING — after the schema deploy, never before it
#
# ADR-0022 found that hoisting a migrate step above `cdk deploy` is SILENTLY WORSE, and that finding still
# holds for the reason it always did: `esbuild.mjs` copies `migrations/*.sql` into the bundle at BUILD time
# and the bundle ships WITH the deploy, so invoking first invokes the PREVIOUS release's runner carrying the
# PREVIOUS migration set — exit 0, "nothing pending", nothing applied.
#
# What changed is that the hazard is no longer UNDETECTABLE, which is what made hoisting unsafe. This script
# digests the working tree's migrations and sends `expectManifestSha` with the invoke; a runner holding a
# different set THROWS instead of reporting a clean run. So the step still sits after the deploy that ships
# its bundle — and if it ever does not, the runner says so rather than lying.
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
#     run-migrations.sh run      <region> <stackName> <outputKey> <label> <migrationsDir>
#     run-migrations.sh classify <functionError> <payload>
#     run-migrations.sh manifest <migrationsDir>
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

# run_migrations_manifest <migrationsDir>
#
# The MIGRATION MANIFEST of a directory: one digest naming exactly which migration set it holds.
#
# ## Why this exists at all
#
# A runner reads its OWN bundled `.sql`, diffs it against `schema_migrations`, and returns `applied: []`
# when there is nothing to do. When the runner is a PREVIOUS release's — which it is whenever it is invoked
# before the deploy that ships it — its directory does not contain the new migrations, so `applied: []`
# means "I have never heard of them" and is byte-identical to "everything is already applied". Passing this
# digest to the runner makes it state which set it holds, so an empty `applied[]` from a runner that MATCHED
# is finally a proof rather than a shrug.
#
# ## Why this is a SECOND implementation and not a call into the TypeScript one
#
# Deliberate. A single shared helper can be wrong identically on both sides and still agree; two independent
# implementations cannot, because sha256 has exactly one right answer. The rendering is byte-for-byte GNU
# `sha256sum`'s (`<64 hex><space><space><name><newline>`, ordered by name under C collation) precisely so
# that both sides can produce it without coordinating, and
# `packages/infra/global/__tests__/migrationManifestAgreement.test.ts` runs this function and
# `@kitchensink/db-schema-guard` over the SAME directories and asserts they agree — on the rendered text,
# not only the final digest, so a future disagreement names the line it happened on.
#
# ⛔ `LC_ALL=C` on the sort is load-bearing: collation is locale-dependent, and a runner whose locale
# differs from CI's would digest the same files differently and report a healthy deploy as a stale runner.
#
# An EMPTY directory is a failure, never a digest: `sha256('')` is a well-formed digest, so an empty bundle
# would agree with an empty tree and certify a runner carrying no migrations at all.
run_migrations_manifest() {
    local dir="${1-}"

    if [ "$#" -lt 1 ] || [ -z "$dir" ]; then
        echo "usage: run-migrations.sh manifest <migrationsDir>" >&2

        return 2
    fi

    if [ ! -d "$dir" ]; then
        echo "::error::migrations directory '${dir}' does not exist, so no migration set can be named" >&2

        return 1
    fi

    local rendered
    rendered=$(cd "$dir" && LC_ALL=C ls -1 -- *.sql 2>/dev/null | LC_ALL=C sort | tr '\n' '\0' | xargs -0 -r sha256sum)

    if [ -z "$rendered" ]; then
        echo "::error::no .sql migrations in '${dir}' — an empty migration set proves nothing" >&2

        return 1
    fi

    printf '%s\n' "$rendered" | sha256sum | cut -d' ' -f1
}

# run_migrations_run <region> <stackName> <outputKey> <label> <migrationsDir>
#
# Resolve the runner from the stack's own output, invoke it, and classify the answer.
#
# ⛔ `migrationsDir` is REQUIRED, and the digest it yields is sent with the invoke. Without it the runner
# cannot distinguish "nothing was pending" from "this bundle has never heard of the new migrations", which
# is what a PREVIOUS release's runner reports — exit 0, nothing applied, a green deploy onto an unmigrated
# schema. An OPTIONAL expectation would be one a caller forgets, and a forgotten one is indistinguishable
# from the behaviour it replaces, so it is an argument rather than a flag.
#
# ⚠️ An ABSENT STACK is a stated SKIP, not a failure: there is no database of ours behind a stack that does
# not exist, and a service's absence is ADR-0010's concern (and `deployVerificationCoverage.test.ts`'s), not
# this script's. A stack that EXISTS but publishes no such output IS a failure — that is a runner which lost
# its `CfnOutput`, which is precisely how a migration path becomes unreachable while every check stays green.
#
# @sideEffect Calls CloudFormation and Lambda, and writes a temp file.
run_migrations_run() {
    local region="${1-}" stack="${2-}" output_key="${3-}" label="${4-}" migrations_dir="${5-}"

    if [ "$#" -lt 5 ] || [ -z "$region" ] || [ -z "$stack" ] || [ -z "$output_key" ] || [ -z "$label" ] ||
        [ -z "$migrations_dir" ]; then
        echo "usage: run-migrations.sh run <region> <stackName> <outputKey> <label> <migrationsDir>" >&2

        return 2
    fi

    # ⛔ Computed BEFORE the stack is even looked up, so a bad migrations path fails on EVERY run rather than
    # only on the stages that happen to have a stack. A check that is skipped precisely where it is needed is
    # the defect this script's own header records about its old path-diff gate.
    local expect_manifest
    expect_manifest=$(run_migrations_manifest "$migrations_dir") || return 1

    local outputs
    outputs=$(aws cloudformation describe-stacks --region "$region" --stack-name "$stack" \
        --query "Stacks[0].Outputs" --output json 2>/dev/null) || {
        echo "::notice::[${label}] ${stack} does not exist, so there is no schema of ours to migrate. Skipping — a service's absence is the deploy gate's concern, not the migration net's."

        return 0
    }

    local fn
    fn=$(printf '%s' "$outputs" | jq -r --arg key "$output_key" '(. // []) | map(select(.OutputKey == $key)) | .[0].OutputValue // empty')

    if [ -z "$fn" ]; then
        echo "::error::[${label}] ${stack} exists but publishes no '${output_key}' output, so its migration runner cannot be reached and NOTHING is applying this schema. There is no in-stack Trigger behind this any more (ADR-0035) — give the runner a CfnOutput."

        return 1
    fi

    echo "[${label}] invoking migration runner ${fn}, expecting migration manifest ${expect_manifest}"

    local payload_file function_error payload verdict reason
    payload_file=$(mktemp)
    function_error=$(aws lambda invoke --region "$region" --function-name "$fn" \
        --payload "{\"action\":\"migrate\",\"expectManifestSha\":\"${expect_manifest}\"}" \
        --cli-binary-format raw-in-base64-out \
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
        manifest)
            shift
            run_migrations_manifest "$@"
            ;;
        *)
            echo "usage: run-migrations.sh run|classify|manifest …" >&2
            exit 2
            ;;
    esac
fi
