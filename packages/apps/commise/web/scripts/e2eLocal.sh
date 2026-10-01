#!/usr/bin/env bash
#
# Run the Playwright suite locally with NO cloud infrastructure.
#
# ⛔ WHY THIS SCRIPT EXISTS. Three things about a local browser run are easy to get wrong, each costs real
# time, and each has bitten us:
#
#   1. The sign-in identity is a FIXED Clerk test-pool slot (shard 1 when unsharded) that `poolAdmin` provisioned
#      on the dev instance, `external_id` included, so a local run needs no webhook and no cloud database. It
#      used to mint a user and wait on a `user.created` webhook that the stopped sandbox RDS could not serve,
#      which is what the removed `E2E_LOCAL_IDENTITY` stand-in existed to dodge. A slot that is not provisioned
#      is refused by the global setup, naming `poolAdmin --apply`.
#   2. Port 3000 is usually taken by a long-running local service. Playwright's own web server then dies
#      with EADDRINUSE before a single test runs. This picks a free port instead of assuming one.
#   3. `playwright test` piped through `tail`/`head` reports the PIPE's exit status, so a FAILING run can
#      look like a pass. Output goes to a file and the exit code is read from Playwright itself.
#
# ⚠️ WHAT A LOCAL RUN DOES NOT PROVE. Identity SYNC (the webhook → Lambda → identity-database chain) is not
# exercised by a run that signs in as an already-provisioned slot. Never read a green local run as covering it.
# ⚠️ And a local run shares the shard-1 slot with CI's shard 1: do not run it while CI is running.
#
# Usage:
#   scripts/e2eLocal.sh                                  # whole suite
#   scripts/e2eLocal.sh tests/e2e/recipeCreateDial.spec.ts
#   scripts/e2eLocal.sh tests/e2e/foo.spec.ts --headed
set -euo pipefail

cd "$(dirname "$0")/.."

# Clerk DEV-instance keys are required: a `pk_live` key is domain-locked and cannot run on localhost.
if [[ ! -f .env.local ]]; then
    echo "error: .env.local is missing. It needs NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY" >&2
    echo "       from the Clerk DEV instance (Secrets Manager: kitchensink/sandbox/identity/keys)." >&2
    exit 1
fi

if ! grep -q 'pk_test' .env.local; then
    echo "error: .env.local does not hold a pk_test key. Production Clerk keys are domain-locked and" >&2
    echo "       will not authenticate against localhost." >&2
    exit 1
fi

# A free port, rather than assuming 3000 is available. Playwright's config reads PORT for both the web
# server it starts and the baseURL it targets, so setting it once is enough.
find_free_port() {
    local candidate
    for candidate in $(seq 3010 3060); do
        if ! ss -ltn 2>/dev/null | grep -q ":${candidate}\b"; then
            printf '%s' "$candidate"
            return 0
        fi
    done
    echo "error: no free port in 3010-3060" >&2
    return 1
}

PORT="$(find_free_port)"
export PORT

LOG="$(mktemp -t playwright-local-XXXXXX.log)"

echo "▶ port           : ${PORT}"
echo "▶ identity       : the test-pool slot for shard ${COMMISE_E2E_SHARD:-1}"
echo "▶ output         : ${LOG}"
echo

# ⛔ NOT piped. `playwright test | tail` reports tail's exit status, so a failing run exits 0 and a
# truncated tail can read as a pass. `list` rather than `line` because line's in-place rewriting swallows
# console output from the tests themselves.
set +e
npx playwright test --reporter=list "$@" 2>&1 | tee "${LOG}"
status="${PIPESTATUS[0]}"
set -e

echo
echo "▶ playwright exit: ${status}   (full output: ${LOG})"
exit "${status}"
