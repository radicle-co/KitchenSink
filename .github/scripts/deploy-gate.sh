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
        # The ONE arm that is not live: nothing is deployed and this run will not deploy it, so every
        # post-gate step that talks to the preview must skip rather than fail against thin air.
        deploy_gate_emit false \
            'no live sandbox for this PR (it was torn down, or never started) — press Run workflow to start one' \
            false

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
    # `live` (3rd, default true) answers a DIFFERENT question from `deploy`: is there a preview to talk
    # to at all, by the end of this run. Every arm but the intent gate below has one — either because it
    # deploys, or because it skipped precisely on the grounds that the thing is already serving. The
    # workflow needs both: build/push steps key on `deploy`, while resolving this stage's food origin,
    # reading the running task definition and smoke-testing key on `live` (they presuppose something is
    # deployed, not that THIS run deployed it — which is what lets the smoke catch a half-wired preview
    # on a push that deployed nothing).
    printf 'deploy=%s\nlive=%s\nreason=%s\n' "${1}" "${3:-true}" "${2}"
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

# ── The deploy-graph closure: a consumer leg must never deploy without its producer ──────────────────────
#
# ⛔ `deploy_gate_decide` above answers "should THIS leg run?" from that leg's OWN stacks. It cannot see the
# other question a per-leg gate has to answer: is the leg this one DEPENDS ON running too.
#
# `prod-deploy.yml` gated each leg independently on a `dorny/paths-filter` group, so a change touching only
# `packages/services/identity-webhooks/**` set `deploy_webhooks=true` and `deploy_global=false`. ADR-0028 had
# just moved the identity log group into `ServiceLogsStack` — a child of the GLOBAL app — recording that it
# "already deploys before both consumers, so no deploy order changed". That is true of the ORDER and false of
# the GATE: the earlier leg does not run at all. Measured against the account on 2026-09-02,
# `kitchensink-service-logs-prod` DOES NOT EXIST, so the next webhooks-only merge would have died inside
# `cdk deploy` on `No export named kitchensink-service-logs-prod:IdentityServiceLogGroupName found`.
# `IdentityServiceStack` imports the same export and had the identical hole.
#
# ⛔ Nothing here enumerates an edge. `scripts/infrastructureManifest.mjs` reads every `Fn.importValue` out of
# the CDK source by AST and projects the cross-APP ones to
# `docs/generated/infrastructure/cross-app-imports.tsv`, under the same regenerate-and-diff staleness gate the
# rest of the manifest carries. A new cross-app import is covered the day it is written. A hand-maintained
# producer→consumer table is the shape that has already cost this repository the ALB priority collision, the
# stale NAT consumer list and ADR-0025's asset guard: a copy of a list cannot detect that the list grew.

# Where the derived edge list lives, relative to the repository root.
DEPLOY_GATE_EDGE_FILE='docs/generated/infrastructure/cross-app-imports.tsv'

# deploy_gate_close <unmetEdges> <flag=value@entrypoint> [<flag=value@entrypoint> …]
#
# Print the CLOSED value of every flag: `true` when it was already true, or when it is the producer of an
# unmet import that a DEPLOYING consumer needs.
#
# <unmetEdges> is a space-separated list of `<consumerEntrypoint>><producerEntrypoint>><exportName>` tokens —
# the edges whose export the account does not currently publish — or the empty string. `>` separates because
# an export name contains `:` and a path contains `/`.
#
# ⚠️ NARROW ON PURPOSE. "Force the producer whenever any consumer leg runs" turns every prod deploy into a
# full platform rollout (RDS, VPC, edge) for a webhooks typo; "force it whenever anything is missing" does the
# same from an unrelated leg. This fires only where the deploy would otherwise FAIL, so it stops firing the
# moment the platform is whole.
#
# Misuse exits 2 WITHOUT printing a verdict, for `deploy_gate_decide`'s reason: a gate that answers "nothing
# to force" on malformed input is how a leg deploys against a producer nobody checked, behind a green check.
#
# Pure: no I/O, no AWS, no file reads.
deploy_gate_close() {
    local unmet="${1-}"
    shift 1 2>/dev/null || {
        echo "usage: deploy-gate.sh close <unmetEdges> <flag=value@entrypoint>…" >&2
        return 2
    }

    if [ "$#" -eq 0 ]; then
        echo "deploy-gate: at least one <flag=value@entrypoint> leg is required" >&2
        return 2
    fi

    # Parallel arrays rather than an associative array: bash 3 has no `declare -A`, and macOS still ships it.
    local -a flag_names=() flag_values=() entry_paths=() entry_flags=()
    local leg flag value entrypoint index found

    for leg in "$@"; do
        if ! [[ $leg =~ ^([a-z_][a-z0-9_]*)=(true|false)@(.+)$ ]]; then
            echo "deploy-gate: leg must be <flag>=<true|false>@<entrypoint>, got '${leg}'" >&2
            return 2
        fi

        flag="${BASH_REMATCH[1]}"
        value="${BASH_REMATCH[2]}"
        entrypoint="${BASH_REMATCH[3]}"

        found=''
        for index in "${!flag_names[@]}"; do
            if [ "${flag_names[$index]}" = "$flag" ]; then
                found="$index"
                break
            fi
        done

        if [ -z "$found" ]; then
            flag_names+=("$flag")
            flag_values+=("$value")
        elif [ "${flag_values[$found]}" != "$value" ]; then
            # One flag gates one leg. Two values for it can only be a wiring mistake, and silently picking
            # one would make the closure's answer depend on argument order.
            echo "deploy-gate: flag '${flag}' was given both '${flag_values[$found]}' and '${value}'" >&2
            return 2
        fi

        entry_paths+=("$entrypoint")
        entry_flags+=("$flag")
    done

    local consumer producer export_name consumer_flag producer_flag reasons=()
    local -a unmet_edges=()

    # ⚠️ `read -ra`, not a bare `for leg in $unmet`. Word-splitting an unquoted variable also GLOB-EXPANDS it,
    # so a token containing `[`, `*` or `?` would be rewritten against the working directory or silently
    # dropped — and a dropped edge is a producer that never gets forced, which is this gate's whole failure
    # mode. `read` splits on IFS and expands nothing.
    if [ -n "$unmet" ]; then
        read -ra unmet_edges <<<"$unmet" || true
    fi

    for leg in ${unmet_edges[@]+"${unmet_edges[@]}"}; do
        if ! [[ $leg =~ ^([^>]+)\>([^>]+)\>(.+)$ ]]; then
            echo "deploy-gate: unmet edge must be <consumer>><producer>><export>, got '${leg}'" >&2
            return 2
        fi

        consumer="${BASH_REMATCH[1]}"
        producer="${BASH_REMATCH[2]}"
        export_name="${BASH_REMATCH[3]}"

        consumer_flag=''
        producer_flag=''
        for index in "${!entry_paths[@]}"; do
            [ "${entry_paths[$index]}" = "$consumer" ] && consumer_flag="${entry_flags[$index]}"
            [ "${entry_paths[$index]}" = "$producer" ] && producer_flag="${entry_flags[$index]}"
        done

        # An app this workflow does not deploy is out of scope: `@commise/web`'s router imports from the
        # platform and is shipped by Vercel, so erroring on it would red every prod deploy.
        if [ -z "$consumer_flag" ]; then
            continue
        fi

        for index in "${!flag_names[@]}"; do
            if [ "${flag_names[$index]}" = "$consumer_flag" ] && [ "${flag_values[$index]}" = 'false' ]; then
                consumer_flag=''
                break
            fi
        done
        if [ -z "$consumer_flag" ]; then
            continue
        fi

        # ⛔ The asymmetry is deliberate. An unknown CONSUMER is out of scope; an unknown PRODUCER means a leg
        # IS deploying and what it depends on is not something this workflow can force — a hole no gate can
        # close. Refuse, so somebody decides, rather than failing inside `cdk deploy` twenty minutes later.
        if [ -z "$producer_flag" ]; then
            echo "deploy-gate: '${consumer}' is deploying and needs '${export_name}' from '${producer}', which" \
                'no leg of this workflow deploys — nothing can order that' >&2
            return 2
        fi

        for index in "${!flag_names[@]}"; do
            if [ "${flag_names[$index]}" = "$producer_flag" ] && [ "${flag_values[$index]}" != 'true' ]; then
                flag_values[index]='true'
                reasons+=("${consumer} needs ${export_name}, so ${producer_flag} is forced")
            fi
        done
    done

    for index in "${!flag_names[@]}"; do
        printf '%s=%s\n' "${flag_names[$index]}" "${flag_values[$index]}"
    done

    if [ "${#reasons[@]}" -eq 0 ]; then
        printf 'closure_reason=%s\n' \
            'every cross-app export a deploying leg imports is already published — no producer forced'
    else
        printf 'closure_reason=%s\n' "$(
            IFS='; '
            echo "${reasons[*]}"
        )"
    fi
}

# deploy_gate_resolve_export <template> <stage> <baseStage>
#
# Substitute a stage into a `{stage}`/`{baseStage}`-parameterised export name.
#
# ⚠️ A placeholder is the LOCAL VARIABLE NAME the CDK author chose — the manifest reads the last identifier of
# the reference chain, which is all a hermetic AST read can know. `WebhooksStack.ts` alone spells one stage
# `deployStage`, `identityStage` and `stage`. `{baseStage}` is the one spelling whose meaning is fixed
# (ADR-0006: a `pr-{N}` service imports the BASE stage's platform); every other placeholder is read as the
# deploy stage — and when the two stages DIFFER that reading is a guess, so this refuses instead. Today
# `prod-deploy.yml` passes stage == baseStage == `prod`, where the distinction cannot arise.
#
# Pure.
deploy_gate_resolve_export() {
    local template="${1-}" stage="${2-}" base="${3-}" resolved

    if [ -z "$template" ] || [ -z "$stage" ] || [ -z "$base" ]; then
        echo 'usage: deploy_gate_resolve_export <template> <stage> <baseStage>' >&2
        return 2
    fi
    if [[ $template == *'{?}'* ]]; then
        echo "deploy-gate: export template '${template}' has a name the manifest could not read" >&2
        return 2
    fi

    resolved="${template//\{baseStage\}/$base}"
    resolved="${resolved//\{stage\}/$stage}"

    if [[ $resolved =~ \{[A-Za-z_][A-Za-z0-9_]*\} ]]; then
        if [ "$stage" != "$base" ]; then
            echo "deploy-gate: '${template}' names a stage this gate cannot classify, and stage (${stage})" \
                "differs from base stage (${base}) — refusing to guess" >&2
            return 2
        fi
        resolved=$(printf '%s' "$resolved" | sed -E "s/\{[A-Za-z_][A-Za-z0-9_]*\}/${stage}/g")
    fi

    printf '%s\n' "$resolved"
}

# deploy_gate_unmet_imports <region> <stage> <baseStage> [<edgeFile>]
#
# Resolve the derived edge list against the account and publish the edges whose export is NOT published, as
# the `unmet_imports` output `deploy_gate_close` consumes.
#
# ⛔ The lookup goes through `.github/scripts/cfn-export.sh`, never an open-coded
# `list-exports --query …` — that idiom is wrong per page (ADR-0005; `sandboxReclamationReachability.test.ts`
# analyser 2 fails any workflow that reopens it), and `--optional` is what keeps "absent" distinguishable from
# "the CLI failed": a bare `|| true` would report a credentials error as a missing export and force a deploy
# for the wrong reason.
#
# @sideEffect Reads the edge file and calls the CloudFormation API.
deploy_gate_unmet_imports() {
    local region="${1-}" stage="${2-}" base="${3-}"
    local edges="${4:-${GITHUB_WORKSPACE:-.}/${DEPLOY_GATE_EDGE_FILE}}"

    if [ -z "$region" ] || [ -z "$stage" ] || [ -z "$base" ]; then
        echo 'usage: deploy-gate.sh unmet-imports <region> <stage> <baseStage> [edgeFile]' >&2
        return 2
    fi
    if [ ! -f "$edges" ]; then
        echo "::error::${edges} is missing — the cross-app deploy graph is unknown, so no leg can be closed" >&2
        return 2
    fi

    # ⛔ A `#!` line is an import whose producer the manifest could not name. Closing a graph with a known
    # hole in it would publish a guarantee the gate cannot make.
    if grep -q '^#!' "$edges"; then
        echo "::error::${edges} reports an import with no resolvable producer:" >&2
        grep '^#!' "$edges" >&2

        return 2
    fi

    # ⛔ PRECONDITION, not a courtesy. `cfn-export.sh --optional` answers EMPTY for both "the export is
    # absent" and "the CLI failed" — it cannot tell them apart, and this caller reads empty as absent. So a
    # credentials or permissions failure would mark EVERY cross-app export missing and force a full platform
    # rollout to production as a side effect: precisely the blast radius the narrow closure rule exists to
    # avoid, arriving through the back door. One cheap read-only call turns that into a loud failure.
    if ! aws sts get-caller-identity --region "$region" >/dev/null 2>&1; then
        echo '::error::deploy-gate: cannot reach CloudFormation (sts get-caller-identity failed). Every export' \
            'would read as absent and force a platform deploy, so refusing to answer.' >&2

        return 2
    fi

    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    local consumer producer template resolved value unmet=() seen_absent=() seen_present=() index found
    while IFS=$'\t' read -r consumer producer template; do
        case "$consumer" in '' | '#'*) continue ;; esac

        resolved=$(deploy_gate_resolve_export "$template" "$stage" "$base") || return 2

        found=''
        for index in "${!seen_absent[@]}"; do
            [ "${seen_absent[$index]}" = "$resolved" ] && found='absent'
        done
        for index in "${!seen_present[@]}"; do
            [ "${seen_present[$index]}" = "$resolved" ] && found='present'
        done

        if [ -z "$found" ]; then
            value=$(bash "${script_dir}/cfn-export.sh" --optional "$resolved" "$region") || return 2
            if [ -z "$value" ]; then
                found='absent'
                seen_absent+=("$resolved")
            else
                found='present'
                seen_present+=("$resolved")
            fi
        fi

        if [ "$found" = 'absent' ]; then
            unmet+=("${consumer}>${producer}>${resolved}")
        fi
    done <"$edges"

    local verdict
    verdict="unmet_imports=${unmet[*]-}"

    echo "[deploy-gate] ${#seen_absent[@]} of $((${#seen_absent[@]} + ${#seen_present[@]})) cross-app exports" \
        "are absent at stage ${stage}"
    echo "$verdict"
    if [ -n "${GITHUB_OUTPUT:-}" ]; then
        echo "$verdict" >>"$GITHUB_OUTPUT"
    fi
    for index in "${!seen_absent[@]}"; do
        echo "::notice::cross-app export ${seen_absent[$index]} is NOT published — its producer leg is forced"
    done
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
        close)
            shift
            deploy_gate_close "$@"
            ;;
        unmet-imports)
            shift
            deploy_gate_unmet_imports "$@"
            ;;
        resolve-export)
            shift
            deploy_gate_resolve_export "$@"
            ;;
        stack-usable)
            deploy_gate_stack_is_usable "${2-}"
            ;;
        *)
            echo "usage: deploy-gate.sh decide|evaluate|close|unmet-imports|resolve-export|stack-usable …" >&2
            exit 2
            ;;
    esac
fi
