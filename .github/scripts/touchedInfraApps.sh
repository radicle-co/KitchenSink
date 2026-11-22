#!/usr/bin/env bash
# Print each CDK app directory (an `infra/` folder or infra-global, with its own package-lock.json) that the change
# `<base>...HEAD` touches, one per line. The apps sit outside the npm workspaces, so only an install in the
# directory itself gives type-aware lint their `aws-cdk-lib` types (`scannersInstallInfra.test.ts`).
set -euo pipefail

git diff --name-only "$1"...HEAD | while IFS= read -r file; do
    dir="$(dirname "$file")"
    while [ "$dir" != . ]; do
        case "$dir" in
            */infra | packages/infra/global)
                if [ -f "$dir/package-lock.json" ]; then
                    echo "$dir"
                    break
                fi
                ;;
        esac
        dir="$(dirname "$dir")"
    done
done | sort -u
