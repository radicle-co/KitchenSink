#!/usr/bin/env bash
# Append ONE validated `NAME=VALUE` line to `$GITHUB_ENV`.
#
# Usage: safe-env.sh NAME VALUE
#
# ⛔ Why this exists. zizmor's `github-env` audit objects to writing `$GITHUB_ENV` because a value carrying a
# NEWLINE smuggles a second assignment (`NODE_OPTIONS=--require=…`, `LD_PRELOAD=…`, `BASH_ENV=…`) and every
# later step runs code nobody reviewed. The composite `infra-package` action cannot avoid the file: it exports
# platform inputs, the food origin and the image tag under names its CALLER chooses, and a step output cannot be
# re-exported under a dynamic name. So each of its writes carries a per-site suppression, and the suppression is
# only honest because every one of them goes through here — `safeEnv.test.ts` pins the rules below, and it also
# fails if a suppressed step writes the file any other way.
#
# Rules — all three, or nothing is written:
#   1. NAME is SCREAMING_SNAKE (`^[A-Z_][A-Z0-9_]*$`).
#   2. NAME is not one that changes how a later process STARTS (loader, shell, Node, runner namespaces).
#   3. VALUE is drawn from `[A-Za-z0-9._:/@+=,-]` — enough for IDs, ARNs, hosts, URLs and tags; no whitespace,
#      no quote, no `$`, and so no newline.
#
# Exit 2 on refusal (the repository's usage-error convention), after an `::error::` naming what was refused.
set -euo pipefail

name="${1-}"
value="${2-}"

refuse() {
    echo "::error::safe-env: refusing to export ${1}" >&2
    exit 2
}

[[ "$name" =~ ^[A-Z_][A-Z0-9_]*$ ]] || refuse "an invalid name '${name}'"

case "$name" in
    GITHUB_* | RUNNER_* | ACTIONS_* | LD_* | NODE_OPTIONS | BASH_ENV | ENV | PATH | PYTHONPATH | PERL5OPT | \
        JAVA_TOOL_OPTIONS | NODE_PATH | SHELLOPTS | BASHOPTS | IFS)
        refuse "'${name}', which changes how a later process starts"
        ;;
esac

[[ "$value" =~ ^[A-Za-z0-9._:/@+=,-]*$ ]] || refuse "${name}: its value contains a character outside the safe set"

: "${GITHUB_ENV:?safe-env: GITHUB_ENV is not set}"
printf '%s=%s\n' "$name" "$value" >> "$GITHUB_ENV"
