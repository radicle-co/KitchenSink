#!/usr/bin/env bash
# Export the Clerk edge verification key to `$GITHUB_ENV` as `CLERK_JWT_KEY`.
#
# Usage: exportClerkEdgeKey.sh STAGE
#
# Lambda@Edge cannot read environment variables, so the global app's edge verifier inlines the key when it is
# bundled (ADR-0020), and the synth refuses without it. Every job that bundles or synthesizes the global app at `prod`
# runs this first: the production deploy (`prod-deploy.yml`) and `main`'s checks (`deployInfra.yml`). The key is
# public, but it lives only in SSM, so no copy sits in repository configuration.
#
# The key is a PEM, so it spans several lines. It is written in GitHub's heredoc form, which `safeEnv.sh` cannot do,
# with a delimiter the key is refused for containing.
#
# Exit 1, after an `::error::` naming the parameter, when it is empty or holds the delimiter. Nothing is written then.
set -euo pipefail

stage="${1:?usage: exportClerkEdgeKey.sh STAGE}"
parameter="/kitchensink/${stage}/clerk/jwt-public-key"
delimiter='KITCHENSINK_CLERK_JWT_KEY_EOF'

key="$(aws ssm get-parameter --name "${parameter}" --query 'Parameter.Value' --output text)"

if [ -z "${key}" ] || [ "${key}" = "None" ]; then
    echo "::error::${parameter} is empty — the edge verifier would reject every request" >&2
    exit 1
fi

if [[ "${key}" == *"${delimiter}"* ]]; then
    echo "::error::${parameter} contains the heredoc delimiter ${delimiter}" >&2
    exit 1
fi

{
    echo "CLERK_JWT_KEY<<${delimiter}"
    echo "${key}"
    echo "${delimiter}"
} >> "${GITHUB_ENV}"
