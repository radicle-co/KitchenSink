#!/usr/bin/env bash
#
# Post-deploy verification: the stack converged, but did the things INSIDE it actually arrive?
#
# ⚠️  DELIBERATE — read docs/architecture/decisions/0010-ensure-exists-per-pr-deploy-gate.md and
#     docs/architecture/decisions/0025-ingredient-parser-python-deployable.md before changing this.
#
# ## Why this exists
#
# `cdkAppDeployCoverage.test.ts` asks whether every CDK app has a deployer. `deploy-gate.sh` asks whether a
# stage's stacks are present and its origin answers. Neither can ask whether a HANDLER or a RESOURCE inside a
# deployed stack arrived, and that is one level above where the CRF parser failed: `RecipeWorkersStack`
# shipped `RecipeParseLineFunction` into every stage carrying
# `CRF_FUNCTION_NAME=kitchensink-ingredient-parser-{stage}` plus an IAM grant to that ARN, while no account
# contained the function. `crfInvoke.ts` maps a failed invoke to `unavailable` per line and the pipeline reads
# that as `single-engine llm`, so a two-engine parse silently ran on one engine. Every signal was green: the
# stack converged, `/health` answered 200, and the existing smoke asserts the recipe→food edge but knows
# nothing of this one.
#
# Two more shapes are invisible to a converged stack, and both have shipped here:
#
#   * a stack at rest in `UPDATE_ROLLBACK_COMPLETE` is USABLE to ADR-0010's gate — correctly, the stack is
#     intact at its previous revision — while the RESOURCE that failed to update sits at
#     `UPDATE_ROLLBACK_COMPLETE` too. The deploy that did not land reported green because nobody looked.
#   * a Lambda whose code package cannot load deploys fine and dies on its first cold start. ADR-0025 records
#     precisely that residual for the parser's arm64 / CPython 3.13 wheels: "the first real proof is a deploy".
#
# ## Why it enumerates nothing
#
# "A copy of a list cannot detect that the list is incomplete" (ADR-0025 §3, on the handle-sync-worker
# outage), so both sides are DISCOVERED:
#
#   * the STACKS come from `cdk ls --long` on the very `--app` string the deploy step used, so they are the
#     stacks this app really synthesises for THIS stage — conditional ones (`kitchensink-edge-prod`,
#     `kitchensink-sandbox-scheduler-sandbox`) included or excluded automatically, which a hand-written list
#     could only get right by being edited. A synth that yields no stack names is a hard error, never an
#     empty sweep: this check must fail loudly rather than verify nothing.
#   * the RESOURCES come from `cloudformation list-stack-resources`, so a Lambda, queue or service added
#     tomorrow is covered the day it is deployed.
#   * the cross-stack REFERENCES come from each deployed Lambda's own environment, classified by the VALUE's
#     shape first — an ARN names its own service and resource type, so `arn:aws:sqs:…` resolves without
#     anybody registering SQS here. Only a BARE name needs the key's help, because a bare string is
#     shapeless; that is this derivation's honest limit, so a `kitchensink-…` value under an unrecognised key
#     is reported as UNCHECKED rather than passed in silence. A hole that announces itself is the whole
#     difference.
#
# `classify_resource` and `classify_reference` are PURE: a status in, a verdict out; a name/value in, a probe
# out. Every AWS call lives in `verify_stacks`. Both halves are executed — not re-implemented — by
# packages/infra/global/__tests__/deploymentVerification.test.ts and
# packages/infra/global/tests/deploymentVerification.integration.test.ts.
#
# ## Usage
#
#     verify-deployment.sh verify         <region> <cdkAppCommand>
#     verify-deployment.sh verify-stacks  <region> <stackName> [<stackName> …]
#     verify-deployment.sh stacks         <cdkAppCommand>
#     verify-deployment.sh drift          <region> <stage> <cdkAppCommand> [--warn-only]
#     verify-deployment.sh classify-resource  <ResourceStatus>
#     verify-deployment.sh classify-reference <envKey> <envValue>
#
# ## `drift` — the question every check above is structurally unable to ask
#
# Everything above asks whether THIS deploy landed. None of it can ask whether the account is running the
# code this commit declares, because every input is the deploy itself. That is the gap
# `docs/architecture/2026-08-28-ingredient-pipeline-state.md` §1 fell through: it claimed `verifyLine` and
# thirteen other handlers were deployed while `kitchensink-recipe-workers-prod` held SIX Lambdas and had
# last been updated on 2026-08-02, with the branch 600+ commits ahead. Every check here was green, because
# every check here was about a deploy that had gone fine — a month earlier.
#
# `drift` reads the `CommitSha` STACK tag `@kitchensink/infra-security`'s `stampCommitProvenance` writes,
# compares it against the commit under consideration, and compares the DECLARED Lambda handlers in
# `docs/generated/infrastructure/manifest.json` against the handlers actually running. It is a thin shell
# over `scripts/deploymentDrift.mjs`, which owns the pure comparison and is unit-tested there — the same
# pure/impure split the classifiers above use, one language over.
#
# Exit status: 0 = everything verified, 1 = findings (each reported as `::error::`), 2 = misuse. A misuse
# NEVER exits 0 — a verifier that answers "nothing wrong" on malformed input is how an unverified deploy
# passes a green check.
#
# ⛔ `set +e` IS DELIBERATE, AND IT IS THE FIX FOR A VERIFIER THAT WAS INERT IN EVERY DEPLOY PIPELINE.
#
# GitHub Actions runs a `run:` body under `/usr/bin/bash -e {0}`, so errexit arrives from the CALLER, and
# this script's own `set -uo pipefail` then completed the trap. Every control path here ACCUMULATES findings
# and returns a count — `output=$(check_lambda …)` is EXPECTED to fail, `names=$(… | grep -v '^$' …)` is
# expected to fail when the synth produced nothing — so under an inherited `-e` the shell exited at the first
# such command, one line ABOVE the `::error::` written to explain it. Measured on this repository:
#
#     $ bash -e .github/scripts/verify-deployment.sh stacks "node packages/infra/global/dist/bin/app.js"
#     exit=1        # nothing on stdout, nothing on stderr
#
# and the same command under a bare `bash` printed the full diagnostic. Every finding this script exists to
# report — the CRF case, a rolled-back resource, an unloadable Lambda, a non-serving ECS service — was
# reaching the log as ZERO BYTES; the job went red naming nothing. The exit status is still the contract
# (0 verified, 1 findings, 2 misuse), and it is now produced by the explicit `return` paths below rather than
# by an ambient trap that fires before anything is said.
#
# `tests/deploymentVerification.integration.test.ts` runs this script under `bash -e` for exactly this
# reason — the harness used to run a DIFFERENT shell from CI, which is why the defect was invisible to it.
set +e
set -uo pipefail

# ── Pure: resource-status classification ────────────────────────────────────────────────────────────────

# verify_deployment_emit <verdict> <reason>
#
# Print the two-line verdict. Kept separate so the classification below reads as a table of cases.
verify_deployment_emit() {
    printf 'verdict=%s\nreason=%s\n' "${1}" "${2}"
}

# verify_deployment_classify_resource <ResourceStatus>
#
# Classify ONE CloudFormation *resource* status as `ok`, `stale` or `failed`. Pure.
#
# ⚠️ `UPDATE_ROLLBACK_COMPLETE` is `stale`, not `ok`, and the asymmetry with `deploy-gate.sh` is deliberate:
# at STACK level that status means "usable — intact at the previous revision", which is why the gate skips on
# it. At RESOURCE level the same word means "this deploy did not land here", which is a finding.
#
# An unrecognised status fails CLOSED. A status AWS adds after this was written must be loud; the permissive
# direction is the one that ships an unverified deploy.
verify_deployment_classify_resource() {
    local status="${1-}"

    if [ "$#" -lt 1 ] || [ -z "$status" ]; then
        echo "usage: verify-deployment.sh classify-resource <ResourceStatus>" >&2

        return 2
    fi

    case "$status" in
        CREATE_COMPLETE | UPDATE_COMPLETE | IMPORT_COMPLETE)
            verify_deployment_emit ok "resource converged (${status})"
            ;;
        DELETE_COMPLETE | DELETE_SKIPPED)
            # Not a finding: the resource has left the stack, so it can be neither stale nor broken.
            # DELETE_SKIPPED is a RETAINED resource — a deliberate removalPolicy, not a fault.
            verify_deployment_emit ok "resource is no longer part of the stack (${status})"
            ;;
        UPDATE_ROLLBACK_COMPLETE | ROLLBACK_COMPLETE | IMPORT_ROLLBACK_COMPLETE)
            verify_deployment_emit stale \
                "resource is at its PREVIOUS revision (${status}) — this deploy was rolled back on it, so the running code is not the code that was just built"
            ;;
        *FAILED)
            verify_deployment_emit failed "resource did not deploy (${status})"
            ;;
        *IN_PROGRESS)
            verify_deployment_emit failed \
                "resource is still ${status} after the deploy returned — the stack is mid-flight or wedged"
            ;;
        *)
            verify_deployment_emit failed \
                "unrecognised CloudFormation resource status '${status}' — failing closed rather than assuming it is healthy"
            ;;
    esac
}

# ── Pure: cross-stack reference classification ──────────────────────────────────────────────────────────

# verify_deployment_reference <probe> <target>
verify_deployment_reference() {
    printf 'probe=%s\ntarget=%s\n' "${1}" "${2}"
}

# verify_deployment_classify_reference <envKey> <envValue>
#
# Decide whether a deployed Lambda's environment variable NAMES an AWS resource, and which API resolves it.
# Pure. Prints `probe=` and `target=`.
#
# Order matters and is the argument of this function:
#   1. an unresolvable value (empty, wildcard, unsubstituted template) is `none` — probing it would red the
#      deploy for a name nobody meant.
#   2. an ARN is classified by SHAPE. This is the part that enumerates nothing about this repository: the ARN
#      carries its own service and resource type, so a service we have never used here still resolves.
#   3. a BARE name is classified by the KEY's suffix, because a bare string carries no shape. `CRF_FUNCTION_NAME`
#      is exactly this case, and exactly the defect this script was written for.
#   4. anything left that looks like one of OUR physical names (`kitchensink-…`) is `unchecked` — reported,
#      never silently passed, because that is the same defect wearing a key this function does not know.
verify_deployment_classify_reference() {
    local key="${1-}" value="${2-}"

    if [ "$#" -lt 2 ]; then
        echo "usage: verify-deployment.sh classify-reference <envKey> <envValue>" >&2

        return 2
    fi

    # (1) Nothing resolvable.
    if [ -z "$value" ]; then
        verify_deployment_reference none ''

        return 0
    fi
    case "$value" in
        # A grant pattern names no single resource, and an unsubstituted CDK/CloudFormation placeholder is a
        # synth bug rather than a live resource — resolving either produces a confusing "not found".
        *'*'* | *'${'* | *'#{'*)
            verify_deployment_reference none "$value"

            return 0
            ;;
    esac

    # (2) ARNs, by shape.
    case "$value" in
        arn:aws*:lambda:*:function:*)
            # `…:function:name`, optionally `:version` or `:alias`. Take the name, drop any qualifier.
            local fn="${value#*:function:}"
            verify_deployment_reference lambda "${fn%%:*}"

            return 0
            ;;
        arn:aws*:sqs:*)
            # An SQS ARN's last field IS the queue name; the URL is derived from it by `get-queue-url`.
            verify_deployment_reference sqs-name "${value##*:}"

            return 0
            ;;
        arn:aws*:sns:*)
            verify_deployment_reference sns "$value"

            return 0
            ;;
        arn:aws*:ssm:*:parameter/*)
            # `…:parameter/kitchensink/…` — the API wants the leading-slash NAME, not the ARN.
            verify_deployment_reference ssm "/${value#*:parameter/}"

            return 0
            ;;
        arn:aws*:states:*:stateMachine:*)
            verify_deployment_reference statemachine "$value"

            return 0
            ;;
        arn:aws*:secretsmanager:*)
            verify_deployment_reference secret "$value"

            return 0
            ;;
        arn:aws*:s3:::*)
            verify_deployment_reference s3 "${value##*:}"

            return 0
            ;;
        arn:aws*)
            # An ARN whose service this function has no resolver for. REPORTED, not passed: it is a real
            # cross-resource reference and the next engineer needs to see that it went unchecked.
            verify_deployment_reference unchecked "$value"

            return 0
            ;;
    esac

    # An SQS queue URL is the one non-ARN shape that identifies its own service unambiguously.
    case "$value" in
        https://sqs.*.amazonaws.com/*)
            verify_deployment_reference sqs "$value"

            return 0
            ;;
        *://*)
            # Any other URL is an ORIGIN, not a resource identifier. Origins are the smoke's job
            # (`deployedSmoke.ts`), and this function must not duplicate that judgement.
            verify_deployment_reference none "$value"

            return 0
            ;;
    esac

    # (3) Bare names, by the key's suffix. Only reached when the value carries no shape of its own.
    local plain=0
    case "$value" in
        *[!A-Za-z0-9_.-]*) plain=0 ;;
        *) plain=1 ;;
    esac

    if [ "$plain" -eq 1 ]; then
        case "$key" in
            *_FUNCTION_NAME)
                verify_deployment_reference lambda "$value"

                return 0
                ;;
            *_BUCKET | *_BUCKET_NAME)
                verify_deployment_reference s3 "$value"

                return 0
                ;;
            *_QUEUE_NAME)
                verify_deployment_reference sqs-name "$value"

                return 0
                ;;
        esac
    fi

    case "$key" in
        *_PARAMETER_NAME)
            case "$value" in
                /*)
                    verify_deployment_reference ssm "$value"

                    return 0
                    ;;
            esac
            ;;
    esac

    # (4) The honest limit, made loud.
    case "$value" in
        kitchensink-*)
            verify_deployment_reference unchecked "$value"

            return 0
            ;;
    esac

    verify_deployment_reference none "$value"
}

# ── Impure: stack discovery ─────────────────────────────────────────────────────────────────────────────

# verify_deployment_stacks <cdkAppCommand>
#
# The physical stack names the CDK app synthesises for the CURRENT environment, one per line ON STDOUT.
#
# ⛔ Derived from the app, never from a list in YAML. `GlobalStack` alone owns seven child stacks, two of
# which exist only on one stage; a hand-written set could only be right by being edited, which is the artefact
# this repository has been bitten by three times.
#
# An empty result is an ERROR, not an empty sweep: `cdk ls` printing nothing (a synth failure, or an output
# format this parser no longer understands) must fail the deploy rather than silently verify zero stacks.
# That vacuity guard is the load-bearing half of this function.
#
# ⛔ `--json`, NOT the default YAML, and that is not a style choice. `cdk ls --long` emits a sequence of
# `{id, name, environment}` where `environment` carries a `name` of its own
# (`aws://unknown-account/unknown-region`) — measured against CDK 2.x, not assumed. Any line-wise `name:`
# parser therefore hands `aws://…` to `describe-stacks` as if it were a stack, and the run reds on a stack
# nobody named. `jq '.[].name'` addresses the top level and cannot make that mistake.
#
# ## ⛔ STDOUT CARRIES DATA. EVERY DIAGNOSTIC GOES TO STDERR.
#
# The only production caller is `verify_deployment_verify`, and it reads this function as
# `names=$(verify_deployment_stacks "$app")`. A command substitution captures STDOUT — so an `::error::`
# written there is swallowed into `$names` and discarded, which is precisely what happened: the one
# diagnostic explaining why a deploy verified nothing was assigned to a variable and thrown away. Only stderr
# survives a substitution, so that is where every word this function says now goes.
#
# ## ⛔ THE JSON IS SLICED OUT OF STDOUT, AND THE DISCARDED PREFIX IS REPORTED
#
# `cdk ls` runs the app, and the app is ours: anything it — or any library it loads — prints lands ahead of
# the JSON on the same stream. `dotenv@17` did exactly that, emitting
# `◇ injected env (0) from … // tip: …` on every `config()` call (even for a file that does not exist), which
# all seven CDK entrypoints make. `jq` refused the document, its error went to `/dev/null`, and the verifier
# became inert across every deploy pipeline while still exiting 1.
#
# Two rules follow, and BOTH are needed. Silencing dotenv (`quiet: true`, guarded by
# `packages/infra/global/__tests__/cdkAppStdoutPurity.test.ts`) fixes today's pollutant. Recovering the JSON
# means the NEXT one cannot make this check inert. And the dropped prefix is REPORTED rather than swallowed,
# because a tool writing to a channel this repository parses as data is itself the finding — a recovery
# nobody is told about is how the second occurrence takes just as long to diagnose as the first.
#
# ⛔ The cut is at the first LINE that begins with `[`, NOT at the first `[` character, and the difference is
# not pedantry. dotenv's banner rotates through a set of tips and FOUR of the eight observed contain a
# bracket — `{ path: ['.env.local', '.env'] }`, `[www.dotenvx.com]`. A first-character cut would therefore
# have recovered the listing or destroyed it depending on which advertisement the library felt like printing
# that second: an INTERMITTENT verifier, which is worse than the inert one being repaired here. `cdk ls
# --long --json` pretty-prints, so its document opens with `[` alone on a line (measured, CDK 2.x); a banner
# is one line and cannot. If that ever stops being true the vacuity guard below fails loudly with the raw
# stdout attached, which is the correct direction for a wrong assumption.
#
# @sideEffect Runs `cdk` (which synthesises the app) and may perform AWS context lookups.
verify_deployment_stacks() {
    local app="${1-}"

    if [ -z "$app" ]; then
        echo "usage: verify-deployment.sh stacks <cdkAppCommand>" >&2

        return 2
    fi

    local diagnostics jq_errors listing prefix json names
    diagnostics=$(mktemp)
    jq_errors=$(mktemp)
    # stderr goes to a file rather than to /dev/null: when the synth fails, its reason is the only thing that
    # makes this failure actionable, and swallowing it turns a real error into "yielded no stack names".
    listing=$(npx cdk ls --long --json --app "$app" 2>"$diagnostics") || listing=''

    # Split at the first line opening a JSON array. Two passes over a listing of a few kilobytes, kept
    # separate because a diagnostic path is the last place to be clever.
    prefix=$(printf '%s' "$listing" | awk 'seen == 0 && /^[[:space:]]*\[/ { seen = 1 } seen == 0 { print }')
    json=$(printf '%s' "$listing" | awk 'seen == 1 || /^[[:space:]]*\[/ { seen = 1; print }')

    # Reported only when there IS a document behind it. With no `[` line at all nothing was "dropped" — the
    # whole of stdout is unusable, and the error below prints it verbatim rather than describing a prefix.
    if [ -n "$json" ] && [ -n "${prefix//[[:space:]]/}" ]; then
        echo "::warning::verify-deployment: \`cdk ls\` wrote ${#prefix} byte(s) to STDOUT ahead of its JSON, which this script parses as data. Silence the writer rather than relying on this recovery. Discarded prefix: $(printf '%s' "$prefix" | tr '\n' ' ')" >&2
    fi

    # jq's stderr is KEPT. Discarding it (`2>/dev/null`) is what turned "the document is not JSON, here is
    # the byte it choked on" into the contentless "yielded no stack names" this function used to report.
    names=$(printf '%s' "$json" | jq -r 'if type == "array" then .[].name else empty end' 2>"$jq_errors" | grep -v '^$' | sort -u) || names=''

    if [ -z "$names" ]; then
        {
            echo "::error::verify-deployment: \`cdk ls --long --json --app \"${app}\"\` yielded no stack names, so this run would have verified NOTHING. Diagnostics follow."
            sed 's/^/[cdk] /' "$diagnostics"
            sed 's/^/[jq] /' "$jq_errors"
            # The raw stdout, bounded: it is the single most useful fact when a tool has polluted the stream,
            # and without it the reader cannot tell a synth failure from an unparseable success.
            printf '%s' "$listing" | head -c 2000 | sed 's/^/[stdout] /'
            printf '\n'
        } >&2
        rm -f "$diagnostics" "$jq_errors"

        return 1
    fi
    rm -f "$diagnostics" "$jq_errors"

    printf '%s\n' "$names"
}

# ── Impure: the verification itself ─────────────────────────────────────────────────────────────────────

# verify_deployment_resolve <region> <probe> <target>
#
# Resolve one cross-stack reference against the live account. Returns 0 when the resource exists.
#
# @sideEffect Calls the AWS API.
verify_deployment_resolve() {
    local region="$1" probe="$2" target="$3"

    case "$probe" in
        lambda) aws lambda get-function-configuration --region "$region" --function-name "$target" >/dev/null 2>&1 ;;
        sqs) aws sqs get-queue-attributes --region "$region" --queue-url "$target" --attribute-names QueueArn >/dev/null 2>&1 ;;
        sqs-name) aws sqs get-queue-url --region "$region" --queue-name "$target" >/dev/null 2>&1 ;;
        sns) aws sns get-topic-attributes --region "$region" --topic-arn "$target" >/dev/null 2>&1 ;;
        ssm) aws ssm get-parameter --region "$region" --name "$target" >/dev/null 2>&1 ;;
        s3) aws s3api head-bucket --bucket "$target" >/dev/null 2>&1 ;;
        statemachine) aws stepfunctions describe-state-machine --region "$region" --state-machine-arn "$target" >/dev/null 2>&1 ;;
        secret) aws secretsmanager describe-secret --region "$region" --secret-id "$target" >/dev/null 2>&1 ;;
        *) return 0 ;;
    esac
}

# verify_deployment_check_lambda <region> <stack> <logicalId> <functionName>
#
# A deployed Lambda must be loadable AND its outbound references must resolve. Echoes one line per finding.
#
# @sideEffect Calls the Lambda API and every API a reference resolves against.
verify_deployment_check_lambda() {
    local region="$1" stack="$2" logical="$3" fn="$4" configuration findings=0

    configuration=$(aws lambda get-function-configuration --region "$region" --function-name "$fn" --output json 2>/dev/null) || configuration=''
    if [ -z "$configuration" ]; then
        echo "::error::[${stack}/${logical}] CloudFormation reports this function deployed, but lambda:GetFunctionConfiguration cannot find '${fn}'."

        return 1
    fi

    local state update
    # A function CloudFormation created can still be unusable: `State=Failed` is an unloadable code package
    # or an unreachable VPC config, and `LastUpdateStatus=Failed` is a code update that never took. Absent
    # fields default to the healthy value — they are omitted for functions that never had a pending state.
    state=$(printf '%s' "$configuration" | jq -r '.State // "Active"')
    update=$(printf '%s' "$configuration" | jq -r '.LastUpdateStatus // "Successful"')

    if [ "$state" = 'Failed' ]; then
        echo "::error::[${stack}/${logical}] ${fn} is State=Failed ($(printf '%s' "$configuration" | jq -r '.StateReason // "no reason given"')) — it deployed but cannot run."
        findings=$((findings + 1))
    fi
    if [ "$update" = 'Failed' ]; then
        echo "::error::[${stack}/${logical}] ${fn} is LastUpdateStatus=Failed ($(printf '%s' "$configuration" | jq -r '.LastUpdateStatusReason // "no reason given"')) — the code update did not take, so it is running the PREVIOUS build."
        findings=$((findings + 1))
    fi

    # The CRF check. Newlines are flattened rather than filtered: a multi-line value (a PEM public key) is
    # never a resource identifier, and flattening keeps one variable per line so the read loop cannot desync.
    local pairs key value probe target
    pairs=$(printf '%s' "$configuration" |
        jq -r '(.Environment.Variables // {}) | to_entries[] | "\(.key)\t\(.value | tostring | gsub("[\n\r]"; " "))"' 2>/dev/null) || pairs=''

    while IFS=$'\t' read -r key value; do
        [ -z "$key" ] && continue
        local classified
        classified=$(verify_deployment_classify_reference "$key" "${value-}")
        probe=$(printf '%s' "$classified" | sed -n 's/^probe=//p')
        target=$(printf '%s' "$classified" | sed -n 's/^target=//p')

        case "$probe" in
            none) ;;
            unchecked)
                echo "::warning::[${stack}/${logical}] ${key}=${target} looks like one of our physical resource names, but verify-deployment.sh has no resolver for it. Extend classify_reference rather than leaving the reference unverified — this is the shape the CRF outage took."
                ;;
            *)
                if ! verify_deployment_resolve "$region" "$probe" "$target"; then
                    echo "::error::[${stack}/${logical}] ${fn} is configured with ${key}=${target}, and no such ${probe} resource exists in ${region}. The function will fail at RUN time, not at deploy time — this is the ingredient-parser defect (ADR-0025)."
                    findings=$((findings + 1))
                fi
                ;;
        esac
    done <<<"$pairs"

    return "$findings"
}

# verify_deployment_check_ecs_service <region> <stack> <logicalId> <serviceArn>
#
# A converged ECS service is not a RUNNING one: a task that cannot pull its image or fails its health check
# leaves the service ACTIVE with fewer running tasks than desired. Echoes one line per finding.
#
# @sideEffect Calls the ECS API.
verify_deployment_check_ecs_service() {
    local region="$1" stack="$2" logical="$3" arn="$4" cluster description running desired status

    # `arn:aws:ecs:<region>:<account>:service/<cluster>/<service>` — the cluster is inside the ARN, and
    # `describe-services` requires it separately.
    cluster="${arn#*:service/}"
    cluster="${cluster%%/*}"
    if [ "$cluster" = "$arn" ]; then
        # A legacy short-form ARN carries no cluster; nothing to verify without guessing, so say so.
        echo "::warning::[${stack}/${logical}] cannot derive a cluster from '${arn}' — skipping the running-task check."

        return 0
    fi

    description=$(aws ecs describe-services --region "$region" --cluster "$cluster" --services "$arn" --output json 2>/dev/null) || description=''
    if [ -z "$description" ]; then
        echo "::error::[${stack}/${logical}] CloudFormation reports this ECS service deployed, but ecs:DescribeServices cannot read '${arn}'."

        return 1
    fi

    status=$(printf '%s' "$description" | jq -r '.services[0].status // "MISSING"')
    running=$(printf '%s' "$description" | jq -r '.services[0].runningCount // 0')
    desired=$(printf '%s' "$description" | jq -r '.services[0].desiredCount // 0')

    if [ "$status" != 'ACTIVE' ]; then
        echo "::error::[${stack}/${logical}] ECS service is ${status}, not ACTIVE."

        return 1
    fi
    if [ "$running" -lt "$desired" ]; then
        echo "::error::[${stack}/${logical}] ECS service is ACTIVE but only ${running} of ${desired} tasks are running — the stack converged and the service is not serving."

        return 1
    fi

    return 0
}

# verify_deployment_verify_stacks <region> <stackName> [<stackName> …]
#
# Verify every RESOURCE of every named stack. This is the seam the pure classifiers feed, and the one the
# integration suite drives against a stubbed AWS CLI.
#
# @sideEffect Calls CloudFormation, Lambda, ECS and every API a reference resolves against.
verify_deployment_verify_stacks() {
    local region="${1-}"

    if [ "$#" -lt 2 ] || [ -z "$region" ]; then
        echo "usage: verify-deployment.sh verify-stacks <region> <stackName> [<stackName> …]" >&2

        return 2
    fi
    shift

    local findings=0 checked=0 stack rows logical type status physical classified verdict reason output

    for stack in "$@"; do
        rows=$(aws cloudformation list-stack-resources --region "$region" --stack-name "$stack" \
            --query 'StackResourceSummaries[].[LogicalResourceId,ResourceType,ResourceStatus,PhysicalResourceId]' \
            --output text 2>/dev/null) || rows=''

        if [ -z "$rows" ]; then
            # Vacuity guard. "The stack has no resources" is not a pass — it is a stack that is absent, or a
            # listing this script could not read, and either way nothing was verified.
            echo "::error::[${stack}] cloudformation:ListStackResources returned nothing. The stack is absent or unreadable, so this run verified NOTHING for it."
            findings=$((findings + 1))
            continue
        fi

        while IFS=$'\t' read -r logical type status physical; do
            [ -z "${logical:-}" ] && continue
            checked=$((checked + 1))

            classified=$(verify_deployment_classify_resource "$status")
            verdict=$(printf '%s' "$classified" | sed -n 's/^verdict=//p')
            reason=$(printf '%s' "$classified" | sed -n 's/^reason=//p')

            if [ "$verdict" != 'ok' ]; then
                echo "::error::[${stack}/${logical}] (${type}) ${reason}"
                findings=$((findings + 1))
                # A resource that did not deploy cannot be interrogated further; its identifier may be stale
                # or absent, and probing it would report a second, derived failure for the same cause.
                continue
            fi

            case "$type" in
                AWS::Lambda::Function)
                    output=$(verify_deployment_check_lambda "$region" "$stack" "$logical" "$physical")
                    findings=$((findings + $?))
                    [ -n "$output" ] && printf '%s\n' "$output"
                    ;;
                AWS::ECS::Service)
                    output=$(verify_deployment_check_ecs_service "$region" "$stack" "$logical" "$physical")
                    findings=$((findings + $?))
                    [ -n "$output" ] && printf '%s\n' "$output"
                    ;;
            esac
        done <<<"$rows"
    done

    if [ "$checked" -eq 0 ]; then
        echo "::error::verify-deployment: no resources were examined at all across ${*}. Failing rather than reporting a green verification of nothing."

        return 1
    fi

    if [ "$findings" -ne 0 ]; then
        echo "::error::verify-deployment: ${findings} finding(s) across ${checked} resource(s) in $# stack(s)."

        return 1
    fi

    echo "verify-deployment: ${checked} resource(s) across $# stack(s) verified — every one converged, every Lambda loadable, every cross-stack reference resolvable."
}

# verify_deployment_verify <region> <cdkAppCommand>
#
# The workflow entry point: discover this app's stacks, then verify them.
#
# @sideEffect Synthesises the CDK app and calls the AWS APIs listed above.
verify_deployment_verify() {
    local region="${1-}" app="${2-}"

    if [ "$#" -lt 2 ] || [ -z "$region" ] || [ -z "$app" ]; then
        echo "usage: verify-deployment.sh verify <region> <cdkAppCommand>" >&2

        return 2
    fi

    local names
    names=$(verify_deployment_stacks "$app") || return 1

    echo "verify-deployment: ${app} synthesises $(printf '%s\n' "$names" | wc -l | tr -d ' ') stack(s): $(printf '%s ' $names)"

    # shellcheck disable=SC2086 — the names are CloudFormation stack names, which cannot contain whitespace.
    verify_deployment_verify_stacks "$region" $names
}

# verify_deployment_drift <region> <stage> <cdkAppCommand> [--warn-only]
#
# Is the account running the code this commit declares? See the header's `drift` section.
#
# ⛔ It does NOT synthesise. Every other subcommand here derives its subject from `cdk ls`, which needs the
# service BUILT and AWS credentials for `Vpc.fromLookup`; this one reads the COMMITTED manifest instead, so
# it can be run against any stage from any checkout — including, deliberately, to ask "is prod stale?"
# without deploying anything. `infrastructureManifest.test.ts` is what keeps that manifest honest.
#
# @sideEffect Runs node, reads the committed manifest, and calls CloudFormation + Lambda (read-only).
verify_deployment_drift() {
    local region="${1-}" stage="${2-}" app="${3-}"

    if [ "$#" -lt 3 ] || [ -z "$region" ] || [ -z "$stage" ] || [ -z "$app" ]; then
        echo "usage: verify-deployment.sh drift <region> <stage> <cdkAppCommand> [--warn-only]" >&2

        return 2
    fi
    shift 3

    # Resolved from this script's own location, never from `$PWD`: a workflow that changed working directory
    # would otherwise get "module not found" and a step that looks broken rather than a check that ran.
    local root
    root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)

    AWS_REGION="$region" node "${root}/scripts/deploymentDrift.mjs" \
        --region "$region" --stage "$stage" --app "$app" "$@"
}

# CLI dispatch — only when executed directly, never when sourced.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    case "${1-}" in
        classify-resource)
            shift
            verify_deployment_classify_resource "$@"
            ;;
        classify-reference)
            shift
            verify_deployment_classify_reference "$@"
            ;;
        stacks)
            shift
            verify_deployment_stacks "$@"
            ;;
        verify-stacks)
            shift
            verify_deployment_verify_stacks "$@"
            ;;
        verify)
            shift
            verify_deployment_verify "$@"
            ;;
        drift)
            shift
            verify_deployment_drift "$@"
            ;;
        *)
            echo "usage: verify-deployment.sh verify|verify-stacks|stacks|drift|classify-resource|classify-reference …" >&2
            exit 2
            ;;
    esac
fi
