#!/usr/bin/env bash
#
# Record, in the production-only release ledger, the digest just pushed under a RELEASE tag. Run it right after the push.
#
# ⛔ This is half of how production refuses to trust a tag it did not build (CI roles security review HIGH-1). The other
# half is `ecrPushVerdict.sh`, which skips a rebuild only when the image under the tag is the one recorded here. The
# ledger is `/kitchensink/prod/releaseImages/<repository>/<tag>` and only the production CI role can write under
# `/kitchensink/prod/`, so an entry proves the production role pushed that digest (an immutable tag cannot change after).
# The entry is never overwritten: an existing entry must already hold this digest (a rerun), else the run fails.
#
# A preview tag is mutable, is not a release and is never recorded (exit 0, nothing asked of AWS).
#
#   bash .github/scripts/ecrRecordRelease.sh <repositoryName> <imageTag>
#
# @sideEffect Calls ECR and writes an SSM parameter.
set -euo pipefail

REPO="${1-}"
TAG="${2-}"

if [ -z "$REPO" ] || [ -z "$TAG" ]; then
    echo 'usage: ecrRecordRelease.sh <repositoryName> <imageTag>' >&2
    exit 2
fi

source "$(dirname "${BASH_SOURCE[0]}")/ecrTagKind.sh"

if ecr_tag_is_preview "$TAG"; then
    exit 0
fi

if ! output="$(aws ecr describe-images --repository-name "$REPO" --image-ids "imageTag=${TAG}" --output json 2>&1)"; then
    echo "::error::ecr-record-release: could not read ${REPO}:${TAG} to record it: ${output}" >&2
    exit 1
fi
digest="$(jq -r '.imageDetails[0].imageDigest // ""' <<<"$output")"
if [ -z "$digest" ]; then
    echo "::error::ecr-record-release: ${REPO}:${TAG} has no digest to record" >&2
    exit 1
fi

name="$(ecr_release_ledger_name "$REPO" "$TAG")"
if ! output="$(aws ssm put-parameter --name "$name" --value "$digest" --type String --no-overwrite 2>&1)"; then
    if [[ "$output" != *ParameterAlreadyExists* ]]; then
        echo "::error::ecr-record-release: could not write ${name}: ${output}" >&2
        exit 1
    fi
    recorded="$(aws ssm get-parameter --name "$name" --query Parameter.Value --output text)"
    if [ "$recorded" != "$digest" ]; then
        echo "::error::ecr-record-release: ${name} already records ${recorded}, not ${digest}" >&2
        exit 1
    fi
fi

echo "[ecr] recorded ${REPO}:${TAG} = ${digest}" >&2
