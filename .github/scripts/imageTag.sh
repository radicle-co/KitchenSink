#!/usr/bin/env bash
#
# The image tag for a stage and commit, `<stage>-<sha>`, or for a content key, `ck-<key>`. Print it, nothing else.
#
# ⛔ ONE definition of the tag. The job that BUILDS an image (`infra-image`) and the job that DEPLOYS it
# (`infra-package`) are different jobs now, and a tag spelled in each is the drift that points ECS at a tag nothing
# pushed (the shape that served `pr-73` a fifteen-day-old build behind green checks).
#
#   bash .github/scripts/imageTag.sh <stage> <sha>
#   bash .github/scripts/imageTag.sh content <key>    # key: `deployKey.sh`'s sha256, 64 lowercase hex
#
# Pure: no AWS, no network.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/ecrTagKind.sh"

# A content key is exactly a sha256 in lowercase hex. Anything else (a 40-hex commit sha above all) is refused, so a
# content tag can never be spelled from a commit.
if [ "${1-}" = content ]; then
    KEY="${2-}"
    if ! [[ "$KEY" =~ ^[0-9a-f]{64}$ ]]; then
        echo "imageTag.sh: a content key is 64 lowercase hex characters, got '${KEY}'" >&2
        exit 2
    fi
    printf '%s%s\n' "$ECR_CONTENT_TAG_PREFIX" "$KEY"
    exit 0
fi

STAGE="${1-}"
SHA="${2-}"

if [ -z "$STAGE" ] || [ -z "$SHA" ]; then
    echo 'usage: imageTag.sh <stage> <sha>' >&2
    exit 2
fi

printf '%s-%s\n' "$STAGE" "$SHA"
