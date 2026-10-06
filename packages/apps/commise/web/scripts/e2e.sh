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
#     `e2eLocal.sh` owns the local flow — a free port in 3010-3060, the `.env.local` guards, the
#     production-build lane, and exit-code hygiene — so this script hands over to it.
#
# Usage is `npm run test:e2e [-- <playwright args>]`; nothing else changes about either tier.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -n "${PLAYWRIGHT_BASE_URL:-}" || -n "${CI:-}" ]]; then
    exec npx playwright test "$@"
fi

exec bash scripts/e2eLocal.sh "$@"