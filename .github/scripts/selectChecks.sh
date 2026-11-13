#!/usr/bin/env bash
# The CI side of the changed-only fast tiers (ADR-0091): what changed, and whether everything must run.
#
#   bash .github/scripts/selectChecks.sh            # in CI: measures the change, writes $GITHUB_OUTPUT
#   bash .github/scripts/selectChecks.sh decide     # pure: changed paths on stdin (one per line), EVENT_NAME set
#
# Outputs:
#   full    empty, or the reason every check must run. Anything but a pull request runs everything, so a push to
#           main is always fully verified.
#   files   the changed paths as a JSON array. The selector (`npm run scope`, `@kitchensink/e2e-plan`) turns them into
#           packages through turbo's graph; this script attributes nothing itself.
#   python  `true` when the Python checks must run: any Python file or Python tool config changed, or a path outside
#           every package (a workflow, the lockfile, a root config) that nothing can attribute.
#
# It needs git and jq only, so `select-checks` runs before the dependency install finishes.
set -euo pipefail

# The list reaches each job as ONE environment variable, and Linux refuses to start a process whose single environment
# string exceeds 128 KiB (MAX_ARG_STRLEN), so every step of the job would fail to start. A longer list runs everything.
readonly MAX_LIST_BYTES=100000

# What ruff and mypy read: Python sources, their settings wherever they sit, and the pinned interpreter and packages.
# This is NOT the selector's package attribution (`checkScope.ts`) and does not try to be: it answers a narrower
# question, and its other branch below runs Python for any path outside `packages/` that is not prose, so where the two
# differ this one only ever runs more.
readonly PYTHON_INPUTS='\.pyi?$|(^|/)(pyproject\.toml|setup\.cfg|mypy\.ini|\.?ruff\.toml|requirements[^/]*\.txt|pythonVersion\.txt)$'

decide() {
    local files
    files="$(grep -v '^$' || true)"

    local count=0
    local json='[]'
    if [ -n "$files" ]; then
        count="$(printf '%s\n' "$files" | wc -l | tr -d ' ')"
        json="$(printf '%s\n' "$files" | jq -R -s -c 'split("\n") | map(select(length > 0))')"
    fi

    local full=''
    if [ "${EVENT_NAME:-}" != 'pull_request' ]; then
        full="a ${EVENT_NAME:-run with no event} checks everything, so main is always fully verified"
    elif [ "$(printf %s "$json" | wc -c)" -gt "$MAX_LIST_BYTES" ]; then
        full="the change touches ${count} files, a list longer than ${MAX_LIST_BYTES} bytes cannot be passed to a job"
    fi

    local python=false
    if [ -n "$full" ]; then
        python=true
    elif printf '%s\n' "$files" | grep -Eq "$PYTHON_INPUTS"; then
        python=true
    elif printf '%s\n' "$files" | grep -v '^packages/' | grep -v '\.md$' | grep -q .; then
        python=true
    fi

    if [ -n "$full" ]; then
        json='[]'
    fi

    printf 'full=%s\nfiles=%s\npython=%s\n' "$full" "$json" "$python"
}

if [ "${1:-}" = 'decide' ]; then
    decide
    exit 0
fi

: "${GITHUB_OUTPUT:?selectChecks.sh writes the decision to GITHUB_OUTPUT}"

if [ "${EVENT_NAME:-}" = 'pull_request' ]; then
    : "${BASE_REF:?a pull request run needs BASE_REF}"
    base="$(git merge-base HEAD "origin/${BASE_REF}")"
    # Renames off: a rename arrives as a delete and an add, so both names are attributed (as gitChangeSet does).
    decision="$(git -c core.quotePath=false diff-tree -r --no-renames --name-only "$base" HEAD | decide)"
else
    decision="$(printf '' | decide)"
fi

printf '%s\n' "$decision" >>"$GITHUB_OUTPUT"
{
    echo '### Changed-only checks'
    printf '%s\n' "$decision" | sed -n 's/^full=\(..*\)$/- Everything runs: \1/p'
    printf '%s\n' "$decision" | sed -n 's/^python=/- Python checks run: /p'
} >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
