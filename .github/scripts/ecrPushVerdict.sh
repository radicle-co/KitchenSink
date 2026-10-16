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
# Exit 0 with the verdict on stdout. Exit 1 when ECR cannot say whether the tag exists, with NOTHING on stdout: that
# is neither "absent" (the push would fail on an immutable tag that does exist) nor "present" (the deploy would ship an
# image nobody pushed), and GitHub's default `bash -e` stops the step on a failed `$(...)` assignment. Exit 2 on usage.
#
#   verdict=$(bash .github/scripts/ecrPushVerdict.sh <repositoryName> <imageTag>)
#   if [ "$verdict" = push ]; then docker buildx build … --push .; fi
#
# @sideEffect Calls the ECR API for a release tag.
set -euo pipefail

REPO="${1-}"
TAG="${2-}"
POLICY="$(dirname "${BASH_SOURCE[0]}")/ecrLifecyclePolicy.json"

if [ -z "$REPO" ] || [ -z "$TAG" ]; then
    echo 'usage: ecrPushVerdict.sh <repositoryName> <imageTag>' >&2
    exit 2
fi

# The mutable prefixes are the retention policy's own: one authority, shared with ecrEnsureRepo.sh.
while IFS= read -r prefix; do
    case "$TAG" in
        "${prefix}"*)
            echo push
            exit 0
            ;;
    esac
done < <(jq -r '[.rules[].selection.tagPrefixList // [] | .[]] | unique | .[]' "$POLICY")

if ! output="$(aws ecr describe-images --repository-name "$REPO" --image-ids "imageTag=${TAG}" --output json 2>&1)"; then
    # Only ECR's own "no such image" is an answer. Anything else (credentials, throttling, a missing repository) is not.
    if [[ "$output" == *ImageNotFoundException* ]]; then
        echo push
        exit 0
    fi

    echo "::error::ecr-push-verdict: could not tell whether ${REPO}:${TAG} exists: ${output}" >&2
    exit 1
fi

echo "[ecr] ${REPO}:${TAG} is already pushed and its tag is immutable; skipping the build." >&2
echo skip
