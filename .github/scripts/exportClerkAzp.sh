#!/usr/bin/env bash
# Export the Clerk `azp` selectors a GLOBAL-app synth derives its media-bucket CORS origins from (ADR-0064).
#
# Usage: exportClerkAzp.sh STAGE
#
# `packages/infra/global/bin/app.ts` calls `resolveUploadOrigins` over `CLERK_AUTHORIZED_PARTIES` /
# `CLERK_AZP_PATTERN` / `CLERK_AZP_PREVIEW_MODE`, the same three values the services read, so the bucket's CORS rule
# and the `azp` boundary cannot disagree about which pages are ours. The app THROWS when none is set. This script is
# the one place that reads them from SSM for a synth, so a workflow cannot export a stale or different spelling.
#
#   prod        -> CLERK_AUTHORIZED_PARTIES from /kitchensink/prod/clerk/authorized-parties
#   anything else -> CLERK_AZP_PATTERN and CLERK_AZP_PREVIEW_MODE from /kitchensink/sandbox/clerk/ (every non-prod
#                    stage, `pr-{N}` included, shares the sandbox Clerk instance and its parameters)
#
# The preview mode is OPTIONAL: an absent parameter is the strict default, and exporting it empty changes nothing.
# Everything goes through `safeEnv.sh`, which refuses a value outside a URL's character set.
#
# Exit 1 on a missing REQUIRED parameter, after an `::error::` naming it.
set -euo pipefail

stage="${1:?usage: exportClerkAzp.sh STAGE}"

read_parameter() {
    # `--output text` prints the literal `None` for an absent value; treat it as empty.
    local value
    value="$(aws ssm get-parameter --name "$1" --query 'Parameter.Value' --output text 2>/dev/null | tr -d '[:space:]')" || value=""
    [ "${value}" = "None" ] && value=""
    printf '%s' "${value}"
}

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${stage}" = "prod" ]; then
    parties="$(read_parameter /kitchensink/prod/clerk/authorized-parties)"

    if [ -z "${parties}" ]; then
        echo "::error::/kitchensink/prod/clerk/authorized-parties is empty - the media bucket's CORS rule would admit no browser origin"
        exit 1
    fi

    bash "${here}/safeEnv.sh" CLERK_AUTHORIZED_PARTIES "${parties}"
    exit 0
fi

pattern="$(read_parameter /kitchensink/sandbox/clerk/azp-pattern)"

if [ -z "${pattern}" ]; then
    echo "::error::/kitchensink/sandbox/clerk/azp-pattern is empty - the media bucket's CORS rule would admit no browser origin"
    exit 1
fi

bash "${here}/safeEnv.sh" CLERK_AZP_PATTERN "${pattern}"

mode="$(read_parameter /kitchensink/sandbox/clerk/azp-preview-mode)"

if [ -n "${mode}" ]; then
    bash "${here}/safeEnv.sh" CLERK_AZP_PREVIEW_MODE "${mode}"
fi
