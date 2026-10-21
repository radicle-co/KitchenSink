#!/usr/bin/env bash
#
# Which of a CDK app's stacks would a deploy CHANGE? (ADR-0067) A stack is CURRENT, and is left alone, only when:
#
#  - it is in a usable resting state (`deployGate.sh`'s DEPLOY_GATE_USABLE_STATUSES, the one authority);
#  - its deployed template equals the template this commit synthesizes, compared as JSON apart from CDK's own
#    `CDKMetadata` resource, whose analytics string moves with the CDK version and which `cdk diff` ignores too;
#  - every SSM parameter it resolved at deploy time still holds the value it resolved then.
#
# Anything else is STALE and deploys — an answer that could not be read included. That is ADR-0010's bias: a gate may
# deploy for nothing, never skip a deploy behind a green check. The stack's `CommitSha` tag is not in its template, so
# a commit that changes nothing a stack declares leaves it current, and the tag keeps meaning "the last commit that
# deployed this stack" (owner ruling, 2026-10-21).
#
# Usage:
#     stackCurrency.sh decide   <status> <compareExit> [<ssmName> <resolvedValue> <currentValue>] …
#     stackCurrency.sh evaluate <region> <forced> <cdk> <app> <stackName> […]
#
# `decide` is PURE: it prints `current=true|false` and `reason=<one line>`, nothing else, or exits 2 on misuse with no
# verdict. <compareExit> is 0 for equal templates, 1 for different ones, 2 when the deployed one could not be read, and
# anything else when the comparison itself failed. `evaluate` does the I/O: ONE synth of <app> into a temporary
# assembly, then per stack its status, its deployed template against that assembly's, and its resolved SSM values.
#
# ⛔ NOT `cdk diff`. It reads the deployed template through the bootstrap LOOKUP role, which may not call
# DescribeStacks in this account, and it then exits 1 exactly as for a real change (run 39661720474: every stack read
# changed). `get-template` runs with the caller's own credentials, like every other read here.
#
# It prints, and appends to $GITHUB_OUTPUT:
#     stale=<construct paths of the stale stacks, space-separated, for `cdk deploy --exclusively`>
#     stale_json=<their CloudFormation names, as a JSON array, for `contains(fromJSON(…), '<name>')`>
#     paths_json=<every judged stack's construct path, keyed by CloudFormation name: a step that deploys ONE stack
#                selects it by path, and a path is not always the name (`IdentityService-sandbox`)>
#     assembly=<the synthesized assembly directory, so the deploy and its verification use exactly what was judged>
# With <forced>=true every stack is stale and nothing is diffed (a dispatch or a Sandbox Up call deploys everything).
# Exit 0 when the question was answered; 1 when the synth failed or a named stack is not in the app; 2 on misuse.
#
# @sideEffect `evaluate` runs the CDK CLI (synth and ls only) and calls CloudFormation and SSM.
set -uo pipefail

# shellcheck source=deployGate.sh
source "$(dirname "${BASH_SOURCE[0]}")/deployGate.sh"

# The bootstrap version parameter every CDK stack carries resolves `/cdk-bootstrap/<qualifier>/version`. CDK marks it
# not to invalidate a deploy, and a bootstrap upgrade must not redeploy every stack, so it is not compared.
STACK_CURRENCY_IGNORED_PARAMETERS=' BootstrapVersion '

stack_currency_decide() {
    local status="${1-}" diff_exit="${2-}"

    if [ -z "$status" ] || ! [[ "$diff_exit" =~ ^[0-9]+$ ]]; then
        echo 'usage: stackCurrency.sh decide <status> <compareExit> [<ssmName> <resolvedValue> <currentValue>] …' >&2
        return 2
    fi
    shift 2
    if [ $(($# % 3)) -ne 0 ]; then
        echo 'stackCurrency.sh decide: each SSM parameter needs <name> <resolvedValue> <currentValue>' >&2
        return 2
    fi

    if [ "$status" = "$DEPLOY_GATE_ABSENT" ]; then
        printf 'current=false\nreason=the stack is absent\n'
        return 0
    fi
    if ! deploy_gate_stack_is_usable "$status"; then
        printf 'current=false\nreason=the stack is %s, not a usable resting state\n' "$status"
        return 0
    fi
    if [ "$diff_exit" -eq 1 ]; then
        printf 'current=false\nreason=the template differs from the deployed one\n'
        return 0
    fi
    if [ "$diff_exit" -eq 2 ]; then
        printf 'current=false\nreason=the deployed template could not be read\n'
        return 0
    fi
    if [ "$diff_exit" -ne 0 ]; then
        printf 'current=false\nreason=the template comparison failed (exit %s)\n' "$diff_exit"
        return 0
    fi
    while [ $# -gt 0 ]; do
        if [ -z "$3" ]; then
            printf 'current=false\nreason=SSM parameter %s could not be read\n' "$1"
            return 0
        fi
        if [ "$2" != "$3" ]; then
            printf 'current=false\nreason=SSM parameter %s changed since the deploy resolved it\n' "$1"
            return 0
        fi
        shift 3
    done
    printf 'current=true\nreason=unchanged\n'
}

# The SSM triples `decide` needs for one deployed stack: `<name> <resolved> <current>` per resolved parameter, one per
# line, tab-separated. An unreadable parameter prints an empty current value, which `decide` reads as stale.
# ⛔ Returns 1, printing nothing, when the stack's parameters cannot be read at all: the status read before it may have
# succeeded, and "no parameters to compare" must never pass for "none changed".
stack_currency_ssm_triples() {
    local region="$1" stack="$2" parameters key name resolved current
    parameters=$(aws cloudformation describe-stacks --region "$region" --stack-name "$stack" \
        --query 'Stacks[0].Parameters' --output json 2>/dev/null) || return 1
    while IFS=$'\t' read -r key name resolved; do
        [ -n "$key" ] || continue
        case "$STACK_CURRENCY_IGNORED_PARAMETERS" in *" ${key} "*) continue ;; esac
        current=$(aws ssm get-parameter --region "$region" --name "$name" \
            --query 'Parameter.Value' --output text 2>/dev/null) || current=''
        printf '%s\t%s\t%s\n' "$name" "$resolved" "$current"
    done < <(jq -r '.[]? | select(.ResolvedValue != null) | [.ParameterKey, .ParameterValue, .ResolvedValue] | @tsv' \
        <<<"${parameters:-[]}")
}

# The template file the assembly holds for <stackName>, searched in every nested manifest. Prints nothing when none.
stack_currency_template_file() {
    local assembly="$1" stack="$2" manifest
    while IFS= read -r manifest; do
        jq -r --arg name "$stack" --arg dir "$(dirname "$manifest")" \
            '.artifacts // {} | to_entries[] | select(.value.type == "aws:cloudformation:stack")
             | select((.value.properties.stackName // .key) == $name) | "\($dir)/\(.value.properties.templateFile)"' \
            "$manifest"
    done < <(find "$assembly" -name manifest.json) | head -n 1
}

# Compare <stackName>'s deployed template with <templateFile>. Returns 0 equal, 1 different, 2 when the deployed
# template cannot be read, 3 when the local one cannot. Prints nothing.
stack_currency_compare() {
    local region="$1" stack="$2" template_file="$3" deployed local_template normalize
    normalize='if type == "string" then fromjson else . end | del(.Resources.CDKMetadata?)'
    deployed=$(aws cloudformation get-template --region "$region" --stack-name "$stack" --template-stage Original \
        --query TemplateBody --output json 2>/dev/null | jq -S "$normalize" 2>/dev/null) || return 2
    [ -n "$deployed" ] || return 2
    [ -n "$template_file" ] && [ -f "$template_file" ] || return 3
    local_template=$(jq -S "$normalize" "$template_file" 2>/dev/null) || return 3
    [ "$deployed" = "$local_template" ] || return 1
}

stack_currency_evaluate() {
    local region="${1-}" forced="${2-}" cdk="${3-}" app="${4-}"

    if [ -z "$region" ] || [ -z "$forced" ] || [ -z "$cdk" ] || [ -z "$app" ] || [ $# -lt 5 ]; then
        echo 'usage: stackCurrency.sh evaluate <region> <forced> <cdk> <app> <stackName> […]' >&2
        return 2
    fi
    shift 4

    local assembly listing
    assembly=$(mktemp -d "${RUNNER_TEMP:-/tmp}/stackCurrency.XXXXXX")
    if ! "$cdk" synth --app "$app" --output "$assembly" --quiet >&2; then
        echo "::error::stack-currency: the app did not synthesize, so no stack can be judged: ${app}" >&2
        return 1
    fi
    if ! listing=$("$cdk" ls --app "$assembly" --long --json 2>/dev/null); then
        echo "::error::stack-currency: could not list the stacks of the synthesized assembly ${assembly}" >&2
        return 1
    fi

    local stale=() stale_names=() paths=() stack path status diff_exit verdict reason triples triple_lines name resolved
    local current
    for stack in "$@"; do
        # The construct path `cdk deploy --exclusively` selects by: the listing's id without its ` (<name>)` suffix.
        path=$(jq -r --arg name "$stack" '.[] | select(.name == $name) | .id | sub(" \\(.*\\)$"; "")' <<<"$listing")
        if [ -z "$path" ]; then
            echo "::error::stack-currency: ${stack} is not a stack of ${app}" >&2
            return 1
        fi
        paths+=("$stack" "$path")

        if [ "$forced" = true ]; then
            echo "[stack-currency] ${stack}: stale (a forced run deploys every stack)" >&2
            stale+=("$path")
            stale_names+=("$stack")
            continue
        fi

        status=$(deploy_gate_stack_status "$region" "$stack")
        diff_exit=0
        if [ "$status" != "$DEPLOY_GATE_ABSENT" ]; then
            stack_currency_compare "$region" "$stack" "$(stack_currency_template_file "$assembly" "$stack")" ||
                diff_exit=$?
        fi
        triples=()
        if [ "$status" = "$DEPLOY_GATE_ABSENT" ]; then
            verdict=$(stack_currency_decide "$status" "$diff_exit") || return 2
        elif ! triple_lines=$(stack_currency_ssm_triples "$region" "$stack"); then
            verdict=$'current=false\nreason=its resolved parameters could not be read'
        else
            while IFS=$'\t' read -r name resolved current; do
                [ -n "$name" ] || continue
                triples+=("$name" "$resolved" "$current")
            done <<<"$triple_lines"
            verdict=$(stack_currency_decide "$status" "$diff_exit" "${triples[@]+"${triples[@]}"}") || return 2
        fi
        reason=$(sed -n 's/^reason=//p' <<<"$verdict")
        if [ "$(sed -n 's/^current=//p' <<<"$verdict")" = true ]; then
            echo "[stack-currency] ${stack}: current (${reason})" >&2
        else
            echo "[stack-currency] ${stack}: STALE (${reason})" >&2
            stale+=("$path")
            stale_names+=("$stack")
        fi
    done

    # `stale_json` is an ARRAY so a step tests one stack with `contains(fromJSON(…), '<name>')`, which matches whole
    # names: a substring test over a string would need padding that `$GITHUB_OUTPUT` is not documented to keep.
    local verdict_lines stale_json paths_json
    stale_json=$(jq -cn '$ARGS.positional' --args "${stale_names[@]+"${stale_names[@]}"}")
    paths_json=$(jq -cn '$ARGS.positional | [range(0; length; 2) as $i | {(.[$i]): .[$i + 1]}] | add // {}' \
        --args "${paths[@]}")
    verdict_lines=$(printf 'stale=%s\nstale_json=%s\npaths_json=%s\nassembly=%s\n' \
        "${stale[*]-}" "$stale_json" "$paths_json" "$assembly")
    printf '%s\n' "$verdict_lines"
    if [ -n "${GITHUB_OUTPUT:-}" ]; then
        printf '%s\n' "$verdict_lines" >>"$GITHUB_OUTPUT"
    fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    case "${1-}" in
        decide)
            shift
            stack_currency_decide "$@"
            ;;
        evaluate)
            shift
            stack_currency_evaluate "$@"
            ;;
        *)
            echo 'usage: stackCurrency.sh decide|evaluate …' >&2
            exit 2
            ;;
    esac
fi
