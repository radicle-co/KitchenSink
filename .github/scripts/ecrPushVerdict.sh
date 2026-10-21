#!/usr/bin/env bash
#
# Should this job build and push `<repository>:<tag>`? Prints `push` or `skip`.
#
# ⚠️  DELIBERATE — this is what lets a RELEASE tag be immutable (`ecrEnsureRepo.sh`, CI roles security review MEDIUM-1).
# A push to an existing immutable tag fails, and a rebuild never reproduces the digest, so a rerun of a production
# commit (a re-run job, a redeploy of the same sha) would die at the push. The tag IS the commit, so an image already
# under it is the same image: the build is skipped and the deploy proceeds against what is there.
#
# A tag that begins with one of the retention policy's preview prefixes (`sandbox-`, `pr-`) is MUTABLE by the same
# policy and is always rebuilt: nothing is asked of ECR, because a rerun of a preview must refresh it.
#
# ⛔ A skip is only ever for an image PRODUCTION pushed: the release ledger must hold the digest found under the tag, or
# the verdict fails closed. Pair every release push with `ecrRecordRelease.sh`.
#
# Exit 0 with the verdict on stdout. Exit 1 when ECR cannot say whether the tag exists, with NOTHING on stdout: that
# is neither "absent" (the push would fail on an immutable tag that does exist) nor "present" (the deploy would ship an
# image nobody pushed), and GitHub's default `bash -e` stops the step on a failed `$(...)` assignment. Exit 2 on usage.
#
#   verdict=$(bash .github/scripts/ecrPushVerdict.sh <repositoryName> <imageTag>)
#   if [ "$verdict" = push ]; then docker buildx build … --push .; fi
#
# @sideEffect Calls the ECR API for a release tag, and reads the release ledger in SSM.
set -euo pipefail

REPO="${1-}"
TAG="${2-}"

if [ -z "$REPO" ] || [ -z "$TAG" ]; then
    echo 'usage: ecrPushVerdict.sh <repositoryName> <imageTag>' >&2
    exit 2
fi

source "$(dirname "${BASH_SOURCE[0]}")/ecrTagKind.sh"

# A preview tag is mutable and is always rebuilt: nothing is asked of ECR.
if ecr_tag_is_preview "$TAG"; then
    echo push
    exit 0
fi

# A CONTENT tag is the content: an image under it was built from exactly these inputs, and the tag is immutable, so it
# is never built twice. No ledger: the ledger proves PRODUCTION pushed a release, and a content tag is not a release.
if ecr_tag_is_content "$TAG"; then
    if output="$(aws ecr describe-images --repository-name "$REPO" --image-ids "imageTag=${TAG}" --output json 2>&1)"; then
        echo "[ecr] ${REPO}:${TAG} is already built from these inputs; skipping the build." >&2
        echo skip
        exit 0
    fi
    if [[ "$output" == *ImageNotFoundException* ]]; then
        echo push
        exit 0
    fi
    echo "::error::ecr-push-verdict: could not tell whether ${REPO}:${TAG} exists: ${output}" >&2
    exit 1
fi

if ! output="$(aws ecr describe-images --repository-name "$REPO" --image-ids "imageTag=${TAG}" --output json 2>&1)"; then
    # Only ECR's own "no such image" is an answer. Anything else (credentials, throttling, a missing repository) is not.
    if [[ "$output" == *ImageNotFoundException* ]]; then
        echo push
        exit 0
    fi

    echo "::error::ecr-push-verdict: could not tell whether ${REPO}:${TAG} exists: ${output}" >&2
    exit 1
fi

# ⛔ "The tag exists" is NOT "production built it": the non-prod role (any branch's workflow) may push a NEW tag of any
# shape into this repository, and ECR has no IAM condition on the tag. So a skip needs PROOF: the digest production
# recorded (`ecrRecordRelease.sh`, in a ledger only the production role can write) must be the digest under the tag.
# No entry, a different digest, or an unreadable ledger fails CLOSED: never a rebuild (the tag is immutable) and never a
# deploy of an image nobody here built. Recovery for a planted tag is a new commit.
digest="$(jq -r '.imageDetails[0].imageDigest // ""' <<<"$output")"
ledger_name="$(ecr_release_ledger_name "$REPO" "$TAG")"
if ! recorded="$(aws ssm get-parameter --name "$ledger_name" --query Parameter.Value --output text 2>&1)"; then
    if [[ "$recorded" == *ParameterNotFound* ]]; then
        echo "::error::ecr-push-verdict: ${REPO}:${TAG} exists but production never recorded pushing it (${ledger_name}); it may have been planted. Refusing to deploy it." >&2
    else
        echo "::error::ecr-push-verdict: could not read the release ledger ${ledger_name}: ${recorded}" >&2
    fi
    exit 1
fi
if [ -z "$digest" ] || [ "$recorded" != "$digest" ]; then
    echo "::error::ecr-push-verdict: ${REPO}:${TAG} holds ${digest:-no digest}, but production recorded ${recorded}. Refusing to deploy it." >&2
    exit 1
fi

echo "[ecr] ${REPO}:${TAG} is the image production pushed (${digest}) and its tag is immutable; skipping the build." >&2
echo skip
