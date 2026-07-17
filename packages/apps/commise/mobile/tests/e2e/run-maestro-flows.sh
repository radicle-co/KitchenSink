#!/usr/bin/env bash
# Runs the Maestro mobile flows on the booted emulator with PER-FLOW DB isolation. Invoked as a single line
# from the reactivecircus/android-emulator-runner `script:` (that runner executes each script LINE as its own
# `sh -c`, so multi-line constructs like this loop must live in a file, not inline).
#
# For each flow: reset the recipe DB to the clean seed fixture (so a flow never inherits an earlier flow's
# mutated state), then run just that flow. Every flow runs even if one fails; the job fails if any did.
set -uo pipefail

APK=packages/apps/commise/mobile/android/app/build/outputs/apk/release/app-release.apk

adb install -r "$APK"
adb reverse tcp:3000 tcp:3000 || true
# The soft-keyboard spell checker/suggestions mangle Maestro inputText (duplicated chars, e.g. "collectionn").
adb shell settings put secure spell_checker_enabled 0 || true

# Re-provision the shared sign-in user right before the flows: the parallel web-E2E job's globalTeardown
# (deleteAllE2EUsers) deletes it ~45min earlier, so the job's early provision step is stale by now.
node packages/apps/commise/mobile/tests/e2e/ensure-signin-user.mjs

export DATABASE_URL=postgres://postgres:postgres@localhost:5432/recipe_maestro

# `auth/login-flow` + `home` first, then the recipe stories; `delete` last (its own "run me last" note).
FLOWS="auth/login-flow home recipes/rating recipes/list-detail recipes/search-navigation recipes/edit recipes/visibility recipes/discover-clone recipes/conflict-merge recipes/collections recipes/create recipes/accessibility recipes/delete"

RC=0
for f in $FLOWS; do
    echo "::group::maestro flow ${f}"
    adb logcat -c || true # clear the ring buffer so a failing flow's dump is scoped to just this flow
    if ! node packages/apps/commise/mobile/tests/e2e/reseed.mjs; then
        echo "reseed failed before ${f}"
        RC=1
    fi
    if ! maestro test "packages/apps/commise/mobile/.maestro/${f}.yaml"; then
        echo "FLOW FAILED: ${f}"
        # Native crashes (app -> launcher) leave no trace in the Maestro log; dump the RN/runtime errors so
        # the CI log shows the actual exception rather than only the downstream "element not visible".
        echo "--- logcat (errors + RN JS + native crashes) for ${f} ---"
        adb logcat -d -t 2000 '*:E' ReactNativeJS:V AndroidRuntime:E System.err:W 2>&1 | tail -120 || true
        echo "--- end logcat for ${f} ---"
        RC=1
    fi
    echo "::endgroup::"
done

exit "$RC"
