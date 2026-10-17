#!/usr/bin/env bash
#
# Run the Playwright suite locally with NO cloud infrastructure.
#
# ⛔ WHY THIS SCRIPT EXISTS. Four things about a local browser run are easy to get wrong, each costs real
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
#   4. The suite drives the PRODUCTION server (`next start`), not `next dev`. In dev mode two mechanisms
#      put false reds in the report: Next compiles a route ON DEMAND inside the first assertion that
#      requests it (measured history in tests/e2e/utils/webServerMode.ts: a link-click spec at 18.3s,
#      three failed attempts on 6e40d66a), and React StrictMode double-invokes effects, which breaks the
#      suite's "exactly once" network-contract assertions (recipeCalories' batch count, ssrPrefetch's
#      library read) on the coin flip of whether the re-fire lands inside the batch window — the report
#      then says "flaky", not "the server is in dev mode". CI drives the production build for the same
#      reasons (webE2eProductionBuild.test.ts History 1: dev 56.4s with a retry-rescued failure, start
#      27.0s clean). The lane therefore BUILDS first — through turbo, so the artifact is what CI's build
#      task makes and an unchanged rerun is a cache hit — and `E2E_WEB_SERVER=dev` restores the no-build
#      iteration loop for a developer editing app code between runs.
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

# ── Which server the run drives ─────────────────────────────────────────────────────────────────────
# `start` (a real production build) by default — the same mode CI drives, and for the same reliability
# reasons (header bullet 4). An explicit `E2E_WEB_SERVER` from the caller wins, so the dev-server
# iteration loop stays one env var away; an unrecognised value is passed through untouched and rejected
# by the config itself (InvalidWebServerModeError names the fix), not re-spelled here.
MODE="${E2E_WEB_SERVER:-start}"
export E2E_WEB_SERVER="${MODE}"

if [[ "${MODE}" == 'start' ]]; then
    # `next start` SERVES a build; it does not make one (playwright.config.ts). Built through turbo — the
    # same task, inputs and outputs CI's build job runs — so the artifact is the one CI makes and an
    # unchanged rerun is a cache hit rather than a rebuild.
    #
    # The build ALSO needs the three backend origins inlined: `NEXT_PUBLIC_*` is frozen into the client
    # bundle at build time (src/config/env.ts validates them while collecting page data and throws without
    # them — a production build does not read `.env.development`). The defaults are the same ports the
    # local compose sandbox publishes and the same ones `tests/e2e/utils/serviceUrls.ts` hands the
    # server at runtime — recipe 3000, identity 3001, food 3002 — so the baked client and the server
    # agree. A caller's explicit values win (the `:-` keeps any override), matching serviceUrls.ts
    # precedence.
    export NEXT_PUBLIC_RECIPE_API_URL="${NEXT_PUBLIC_RECIPE_API_URL:-http://localhost:3000}"
    export NEXT_PUBLIC_IDENTITY_API_URL="${NEXT_PUBLIC_IDENTITY_API_URL:-http://localhost:3001}"
    export NEXT_PUBLIC_FOOD_API_URL="${NEXT_PUBLIC_FOOD_API_URL:-http://localhost:3002}"
    npx turbo run build --filter=@commise/web
fi

LOG="$(mktemp -t playwright-local-XXXXXX.log)"

echo "▶ port           : ${PORT}"
echo "▶ server         : ${MODE}"
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
