#!/usr/bin/env bash
#
# Fail unless an image tag exists in an ECR repository. The deploy job runs this before `cdk deploy`.
#
# ⛔ The image is built and pushed by ANOTHER job (`infra-image`), so the deploy can no longer observe its own push.
# This is what keeps "the stack never references a tag nothing pushed" true across the job boundary: a skipped, failed
# or mis-selected push is a red deploy job that says so, not an ECS service that cannot pull its image.
#
# A tag that is missing is told apart from a read that FAILED (permissions, throttling): only the first means "not
# pushed", and blaming the push for an outage would send the reader to the wrong job.
#
#   bash .github/scripts/ecrImagePresent.sh <repositoryName> <imageTag>
#
# @sideEffect Calls ECR (read only).
set -euo pipefail

REPO="${1-}"
TAG="${2-}"

if [ -z "$REPO" ] || [ -z "$TAG" ]; then
    echo 'usage: ecrImagePresent.sh <repositoryName> <imageTag>' >&2
    exit 2
fi

if output="$(aws ecr describe-images --repository-name "$REPO" --image-ids "imageTag=${TAG}" --output json 2>&1)"; then
    echo "[ecr] ${REPO}:${TAG} is present ($(jq -r '.imageDetails[0].imageDigest // "no digest"' <<<"$output"))"
    exit 0
fi

if [[ "$output" == *ImageNotFoundException* ]]; then
    echo "::error::ecr-image-present: ${REPO}:${TAG} does not exist. The image job for this repository did not push it (skipped, failed, or built a different commit), so this deploy would point ECS at a tag it cannot pull." >&2
    exit 1
fi

echo "::error::ecr-image-present: could not read ${REPO}:${TAG}: ${output}" >&2
exit 1
