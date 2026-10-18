#!/usr/bin/env bash
#
# The image tag for a stage and commit: `<stage>-<sha>`. Print it, nothing else.
#
# ⛔ ONE definition of the tag. The job that BUILDS an image (`infra-image`) and the job that DEPLOYS it
# (`infra-package`) are different jobs now, and a tag spelled in each is the drift that points ECS at a tag nothing
# pushed (the shape that served `pr-73` a fifteen-day-old build behind green checks).
#
#   bash .github/scripts/imageTag.sh <stage> <sha>
#
# Pure: no AWS, no network.
set -euo pipefail

STAGE="${1-}"
SHA="${2-}"

if [ -z "$STAGE" ] || [ -z "$SHA" ]; then
    echo 'usage: imageTag.sh <stage> <sha>' >&2
    exit 2
fi

printf '%s-%s\n' "$STAGE" "$SHA"
