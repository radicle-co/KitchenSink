#!/usr/bin/env bash
#
# Build and push `<repository>:<tag>` only when `ecrPushVerdict.sh` answers `push`, then record it
# (`ecrRecordRelease.sh`, a no-op for any tag that is not a release).
#
# ⛔ THE RACE (ADR-0067). Two runs that compute the same content key, such as a Sandbox Up call and a pull-request push
# (different concurrency groups), can both hear `push`. The second push to an immutable tag then fails. So when the
# build command fails, the verdict is asked AGAIN: `skip` means another run pushed the image these inputs build, and
# this run succeeds on it. Any other answer, an unreadable one included, keeps the build's own exit status. The
# registry's error text is never matched, because buildx does not promise it.
#
#   bash .github/scripts/ecrPushUnlessBuilt.sh <repositoryName> <imageTag> <buildCommand> [<argument>…]
#
# Exit 0 when the image is there (built now, by an earlier run, or by a racing one). Exit 1 when the first verdict
# cannot be read (nothing is built). The build's own status when it failed and the image is not there. Exit 2 on usage.
#
# @sideEffect Runs the build command, calls ECR, and may write the release ledger in SSM.
set -uo pipefail

REPO="${1-}"
TAG="${2-}"

if [ -z "$REPO" ] || [ -z "$TAG" ] || [ $# -lt 3 ]; then
    echo 'usage: ecrPushUnlessBuilt.sh <repositoryName> <imageTag> <buildCommand> [<argument>…]' >&2
    exit 2
fi
shift 2

here="$(dirname "${BASH_SOURCE[0]}")"

if ! verdict="$(bash "${here}/ecrPushVerdict.sh" "$REPO" "$TAG")"; then
    exit 1
fi
if [ "$verdict" = skip ]; then
    exit 0
fi

"$@"
status=$?
if [ "$status" -ne 0 ]; then
    if [ "$(bash "${here}/ecrPushVerdict.sh" "$REPO" "$TAG" 2>/dev/null)" = skip ]; then
        echo "[ecr] the push of ${REPO}:${TAG} failed, but another run pushed the image these inputs build; using it." >&2
        exit 0
    fi
    echo "::error::ecr-push-unless-built: building ${REPO}:${TAG} failed (exit ${status}), and the image is not there." >&2
    exit "$status"
fi

bash "${here}/ecrRecordRelease.sh" "$REPO" "$TAG"
