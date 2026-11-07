#!/usr/bin/env bash
#
# The `test:e2e` entry: the deployed/CI tier unchanged, the local tier port-safe.
#
# WHY THIS SCRIPT EXISTS. `npm run test:e2e` is what CI calls (`_ci.yml` and `deployedE2eTiers.yml` both
# spell `npm run test:e2e --workspace=@commise/web`, and `webE2eProductionBuild.test.ts` pins that
# spelling), and it is also what the ROOT `npm run test:e2e` reaches through turbo when a developer runs
# the full local suite against the `local:up` sandbox. Those two callers need different port behaviour:
#
#   · CI / deployed: `PLAYWRIGHT_BASE_URL` is set (deployed previews — the config then declares NO
#     webServer of its own) or `CI` is set (a dedicated runner owns its port), so the raw
#     `playwright test` is correct and must stay byte-identical, with args passed straight through.
#   · Local with the sandbox up: the compose tier publishes the three services on 3000/3001/3002, and
#     playwright.config.ts defaults PORT to 3000 with `reuseExistingServer: !CI` — a raw local run
#     therefore REUSES whatever answers on 3000, which is the RECIPES CONTAINER, and drives the browser
#     at the recipe API: every auth spec then dies waiting for a Clerk widget the JSON never renders
#     (measured 2026-10-06: signIn.spec.ts waiting for the email textbox until the run was torn down).
#     `e2eLanes.ts` splits the suite across parallel lanes (E2E_LANES=1 for one run); each lane is `e2eLocal.sh`, which owns the local flow — a free port in 3010-3060, the `.env.local` guards, the
#     production-build lane, and exit-code hygiene — so this script hands over to it.
#
# Usage is `npm run test:e2e [-- <playwright args>]`; nothing else changes about either tier.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -n "${PLAYWRIGHT_BASE_URL:-}" || -n "${CI:-}" ]]; then
    # CI selection (ADR-0087): `select-e2e` writes the tests to run into a list file. The count check runs first, so a
    # list that no longer holds what the selection counted stops the run before it signs in as anyone.
    selected=()
    if [[ -n "${E2E_TEST_LIST:-}" ]]; then
        selected=(--test-list "$E2E_TEST_LIST")
    fi
    if [[ -n "${E2E_EXPECTED_TESTS:-}" ]]; then
        npx tsx scripts/e2eCountCheck.ts "$E2E_EXPECTED_TESTS" ${selected[@]+"${selected[@]}"} || exit 1
    fi
    exec npx playwright test ${selected[@]+"${selected[@]}"} "$@"
fi

exec npx tsx scripts/e2eLanes.ts "$@"