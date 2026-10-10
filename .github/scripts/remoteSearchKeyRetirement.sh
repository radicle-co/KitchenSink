#!/usr/bin/env bash
#
# Refuse to retire a remote search signing key while a food service still signs with it (ADR-0055 point 7; step 3
# of the rotation runbook in `packages/infra/global/lib/platform/RemoteSearchSharedStack.ts`).
#
# Food reads the key-pair id at deploy and keeps it in its task definition, and a preview whose food did not change is
# not redeployed (`deployGate.sh`). Dropping a generation from the shared stack removes the key CloudFront trusts, so
# a food still holding that id has every search refused with CloudFront's own `403`. Run before the global deploy:
#
# - the RETIRING ids are the `AWS::CloudFront::PublicKey` resources the deployed stack holds and the synthesized
#   template does not; a public key's physical id is its key-pair id;
# - the RUNNING task definitions are the ones the deployments of each service name (the primary and any in flight),
#   in this application's clusters. Never a task definition family: CDK never deregisters an old revision;
# - a retiring id anywhere in a running container's environment is a refusal, matched by value, not variable name.
#
# Every question it cannot answer is a refusal: an unreadable stack, cluster, service or task definition never reads
# as "nothing references the key".
#
# Usage: remoteSearchKeyRetirement.sh check <region> <sharedStackName> <cloudAssemblyDir>

set -euo pipefail

# Clusters this application owns: CloudFormation names an unnamed cluster after its stack, and every stack here is
# `kitchensink-…`. The account hosts another application, whose clusters are never read.
readonly KEY_RETIREMENT_CLUSTER_PREFIX='kitchensink-'

# key_retirement_template <cloudAssemblyDir> <stackName>
#
# The path of the template the assembly holds for a stack, from the assembly's own manifest.
#
# @sideEffect Reads the assembly.
key_retirement_template() {
    local assembly="$1" stack="$2" file

    file=$(jq -r --arg stack "$stack" \
        '[.artifacts[] | select(.type == "aws:cloudformation:stack" and .properties.stackName == $stack)
            | .properties.templateFile] | if length == 1 then .[0] else empty end' \
        "${assembly}/manifest.json") || return 1

    if [ -z "$file" ] || [ ! -f "${assembly}/${file}" ]; then
        echo "::error::remote search key retirement: the synthesized assembly at ${assembly} holds no template for ${stack}, so what this deploy keeps is unknown." >&2

        return 1
    fi

    echo "${assembly}/${file}"
}

# key_retirement_retiring <templateFile> <deployedRows>
#
# The key-pair ids of the deployed public keys the template no longer declares, one per line. `deployedRows` is
# `<logicalId>\t<physicalId>` per line. Pure.
key_retirement_retiring() {
    local template="$1" deployed="$2" kept logical physical

    kept=$(jq -r '.Resources // {} | to_entries[] | select(.value.Type == "AWS::CloudFront::PublicKey") | .key' "$template") || return 1

    while IFS=$'\t' read -r logical physical; do
        if [ -z "$logical" ]; then
            continue
        fi

        if ! grep -qxF -- "$logical" <<<"$kept"; then
            echo "$physical"
        fi
    done <<<"$deployed"
}

# key_retirement_running <region>
#
# Every `<serviceArn>\t<taskDefinitionArn>` a deployment of a service in this application's clusters names.
#
# @sideEffect Reads ECS.
key_retirement_running() {
    local region="$1" clusters cluster services batch

    clusters=$(aws ecs list-clusters --region "$region" --query 'clusterArns' --output text) || return 1

    for cluster in $clusters; do
        case "${cluster##*/}" in
            "${KEY_RETIREMENT_CLUSTER_PREFIX}"*) ;;
            *) continue ;;
        esac

        services=$(aws ecs list-services --region "$region" --cluster "$cluster" --query 'serviceArns' --output text \
            </dev/null) || return 1
        read -r -a batch <<<"$services"

        # `describe-services` takes at most ten services a call.
        while [ "${#batch[@]}" -gt 0 ]; do
            aws ecs describe-services --region "$region" --cluster "$cluster" --services "${batch[@]:0:10}" \
                --output json </dev/null |
                jq -r '.services[] | .serviceArn as $service | .deployments[] | [$service, .taskDefinition] | @tsv' ||
                return 1
            batch=("${batch[@]:10}")
        done
    done
}

# key_retirement_check <region> <stackName> <cloudAssemblyDir>
#
# @sideEffect Reads the assembly, CloudFormation and ECS; writes the verdict.
key_retirement_check() {
    local region="${1:?usage: remoteSearchKeyRetirement.sh check <region> <stackName> <cloudAssemblyDir>}"
    local stack="${2:?usage: remoteSearchKeyRetirement.sh check <region> <stackName> <cloudAssemblyDir>}"
    local assembly="${3:?usage: remoteSearchKeyRetirement.sh check <region> <stackName> <cloudAssemblyDir>}"
    local template deployed errors retiring running service definition values blocked=0

    template=$(key_retirement_template "$assembly" "$stack") || return 1
    errors=$(mktemp)

    if ! deployed=$(aws cloudformation list-stack-resources --region "$region" --stack-name "$stack" \
        --query "StackResourceSummaries[?ResourceType=='AWS::CloudFront::PublicKey'].[LogicalResourceId,PhysicalResourceId]" \
        --output text 2>"$errors"); then
        if grep -q 'does not exist' "$errors"; then
            echo "remote search key retirement: ${stack} is not deployed yet, so no key can be retiring."
            rm -f "$errors"

            return 0
        fi

        echo "::error::remote search key retirement: could not read ${stack}'s public keys, so this deploy might retire a key a food still signs with: $(cat "$errors")" >&2
        rm -f "$errors"

        return 1
    fi
    rm -f "$errors"

    retiring=$(key_retirement_retiring "$template" "$deployed") || return 1

    if [ -z "$retiring" ]; then
        echo "remote search key retirement: this deploy retires no signing key."

        return 0
    fi

    running=$(key_retirement_running "$region") || {
        echo "::error::remote search key retirement: could not read which task definitions this application's services run, so the retiring key $(tr '\n' ' ' <<<"$retiring")may still be in use." >&2

        return 1
    }

    while IFS=$'\t' read -r service definition; do
        if [ -z "$service" ]; then
            continue
        fi

        values=$(aws ecs describe-task-definition --region "$region" --task-definition "$definition" --output json \
            </dev/null |
            jq -r '.taskDefinition.containerDefinitions[].environment[]?.value') || {
            echo "::error::remote search key retirement: could not read ${definition}, which ${service} runs." >&2

            return 1
        }

        while IFS= read -r key; do
            if [ -n "$key" ] && grep -qxF -- "$key" <<<"$values"; then
                echo "::error::remote search key retirement: ${service} runs ${definition}, which still signs with ${key}. Redeploy that food service so it reads the newest key, then re-run this deploy." >&2
                blocked=1
            fi
        done <<<"$retiring"
    done < <(sort -u <<<"$running")

    if [ "$blocked" -eq 1 ]; then
        return 1
    fi

    echo "remote search key retirement: no running task definition signs with $(tr '\n' ' ' <<<"$retiring")so it may be retired."
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    case "${1-}" in
        check)
            shift
            key_retirement_check "$@"
            ;;
        *)
            echo "usage: remoteSearchKeyRetirement.sh check <region> <sharedStackName> <cloudAssemblyDir>" >&2
            exit 2
            ;;
    esac
fi
