#!/usr/bin/env bash
# Runs the Maestro mobile flows on the booted emulator with PER-FLOW DB isolation. Invoked as a single line
# from the reactivecircus/android-emulator-runner `script:` (that runner executes each script LINE as its own
# `sh -c`, so multi-line constructs like this loop must live in a file, not inline).
#
# For each flow: reset the recipe DB to the clean seed fixture (so a flow never inherits an earlier flow's
# mutated state), then run just that flow. Every flow runs even if one fails; the job fails if any did.
#
# ## PER-VERTICAL FLOW SELECTION (why this script has subcommands at all)
#
# Measured on nightly run 31471786779, this job is 52.75m: 17.3m of FIXED setup (12.9m Gradle release-APK
# build + ~1.5m emulator/AVD boot + install + ~2.9m checkout/deps/service build/seed) and 35.5m of FLOW
# EXECUTION. The variable half dominates the fixed half 2:1, so which FLOWS run is the lever — not Gradle or
# AVD caching, which target the smaller fixed half (~2.8%, refuted; do not re-propose it).
# `recipes/collections-pagination` alone is 7.75m, 22% of all flow time.
#
# Since commit 5832ce7c the tier auto-triggers on the mobile surface, so a large share of PRs pay the
# emulator. `heavy-e2e.yml` therefore computes WHICH VERTICALS a PR could plausibly break (from
# `dorny/paths-filter`), threads the answer through `_ci-heavy.yml`'s `maestro_flow_selector` input into
# `MAESTRO_FLOW_SELECTOR`, and this script narrows the run to those verticals plus the SPINE.
#
# The asymmetry is deliberate and load-bearing: **running MORE is safe, running less silently is not.** So
# the full set is both the DEFAULT and the FALLBACK — an absent selector, a malformed one, an unknown key, an
# unreadable value, or a selector that implicates NO vertical all run every flow. Attribution failure is
# never allowed to look like "there was nothing to do"; a Maestro job reporting green over flows it never
# executed is exactly the absence-of-work-behind-a-status class this repo has already paid for. Every skipped
# flow is printed (`skipped: …`), so a narrowed run can never be mistaken for a complete one in the log.
#
# `maestro_select_flows` is PURE — plan + selector pairs in, verdict out; no adb, no network, no device — and
# it is regression-tested by EXECUTING this file (never by re-implementing it) from
# `packages/infra/global/__tests__/maestroFlowSelection.test.ts`, which also owns the inventory assertion
# that every committed `.maestro` flow is planned, is a `runFlow` sub-flow, is inert for a stated reason, or
# is a recorded gap. That guard exists because `recipes/ingredient-catalog-blend.yaml` was committed and then
# executed by nothing for months: `FLOWS` was a hand-maintained list and nobody added it.
#
# Usage:
#     run-maestro-flows.sh                              # run mode (what the emulator job invokes)
#     run-maestro-flows.sh select      <name>=true|false …
#     run-maestro-flows.sh select-plan <plan> <name>=true|false …   # test seam; CI never uses it
#     run-maestro-flows.sh plan | verticals
set -uo pipefail

APK=packages/apps/commise/mobile/android/app/build/outputs/apk/release/app-release.apk

# ── THE PLAN — every flow CI runs, in execution order, each labelled with its vertical ────────────────────
#
# ONE authoritative list: the order and the vertical membership cannot drift apart, and a narrowed run is
# this list FILTERED (never a concatenation of per-vertical lists), so it is always a subsequence of the full
# run and the ordering below holds for every selection.
#
# Order is deliberate:
#   - `auth/login-flow` FIRST, and it is the SPINE: every narrowed run includes it. It is the only
#     SIGNED-OUT flow — it launches with `clearState`, asserts the app opens directly on the sign-in form,
#     walks the sign-up entry and back, then signs in via the shared `auth/signin.yaml` sub-flow (which is
#     also what crosses Home into the recipes surface). So it re-establishes a session from cleared state for
#     everything after it AND exercises the app shell, the auth gate, Clerk, the Home widget surface and the
#     recipes-list crossing that EVERY other flow composes. That is what makes narrowing safe: a change to
#     the shared entry path is still proven on every run, whatever vertical was selected. (It absorbed
#     `auth/welcome-flow`, deleted with the welcome screen itself by owner decision on 2026-07-28.)
#   - `home` next, then the recipe stories.
#   - `recipes/discover-browse` sits with the other read-only discovery flows (it types and clears a query but
#     mutates nothing, so it is order-independent).
#   - `recipes/ingredient-catalog-blend` sits with the other CREATE-wizard flows: it publishes a recipe, so it
#     belongs in the mutating cluster rather than among the read-only ones. It is the F2 (degraded-catalog)
#     contract — this job boots recipe-service and deliberately NOT the food service, so the blended
#     typeahead degrades deterministically here, which is the one Stage-2 behaviour this environment can
#     prove for real. See the flow's own docblock.
#   - `account-danger-zone` late but BEFORE `delete`: it walks Profile → Account settings and CANCELS both
#     destructive actions (it deliberately never confirms), so it must not run against a state a later flow
#     assumes, and it must not be stranded after the delete flow's mutations.
#   - `account-erasure` immediately AFTER it, because it is the same surface's story with the cancel removed:
#     it CONFIRMS the erasure and ends the Clerk session. Both of its effects are contained — the recipe
#     erasure only reaches the database this loop truncates and re-seeds before every flow, the identity
#     erasure is answered by `profile-stub-server.mjs` (the real call would delete the SHARED fixture user at
#     Clerk), and the signed-out state it leaves is absorbed by `auth/signin-home.yaml`, which is idempotent
#     and which every later flow composes. Ordering it before `delete` keeps the pair adjacent and keeps the
#     "run me last" flow last.
#   - `recipes/delete` last (its own "run me last" note).
#   - `recipes/empty-library` sits next to `list-detail` (its populated sibling). It is the ONE flow that
#     runs against an EMPTY library — see EMPTY_LIBRARY_FLOWS below — and it mutates nothing, so the next
#     iteration's normal reset restores the seed for everything after it.
#
# NOT in this plan, and each for a stated reason (the inventory test enforces that the list of reasons stays
# exhaustive):
#   - `auth/signin.yaml` / `auth/signin-home.yaml` — reusable `runFlow` SUB-flows, not stories. They are
#     covered as part of every story that composes them; running one alone would prove nothing new.
#   - `visual/*` — the U10b `assertScreenshot` flows plus their baseline recorder. `assertScreenshot` has no
#     record mode, so a missing reference PNG is the hard error "Screenshot file not found": they are inert
#     BY CONSTRUCTION until baselines are recorded on the pinned emulator profile and committed. The
#     inventory test asserts that reason against the live state of `visual/baselines/`, so the day the PNGs
#     land it fails and asks for the activation instead of leaving four flows quietly dead.
#   - `homeRecentRecipeTap` and `recipes/source-tabs` — real story flows that have never executed in CI.
#     Recorded (with their intended verticals) in that test's `KNOWN_UNRUN_FLOWS`; promoting a flow whose
#     only proof is an emulator run belongs in a PR whose Maestro tier is watched.
FLOW_PLAN="spine:auth/login-flow
home:home
recipes:recipes/rating
recipes:recipes/list-detail
recipes:recipes/empty-library
recipes:recipes/search-navigation
recipes:recipes/edit
recipes:recipes/versions
recipes:recipes/visibility
discovery:recipes/discover-browse
discovery:recipes/discover-recent-searches
discovery:recipes/discover-clone
recipes:recipes/conflict-merge
collections:recipes/collections
collections:recipes/collections-pagination
collections:recipes/collections-visibility
collections:recipes/collections-clone
collections:recipes/collections-pull
recipes:recipes/create
recipes:recipes/ingredient-catalog-blend
recipes:recipes/photos
recipes:recipes/accessibility
auth:account-danger-zone
auth:account-erasure
recipes:recipes/delete"

# The vertical tokens a selector may name. `spine` is deliberately NOT among them: it is unconditional, so
# accepting it as a key would let a caller believe it had selected something when it had selected nothing.
# `heavy-e2e.yml` composes exactly these names (plus `full`), and the guard suite asserts the two agree —
# which is what turns a typo'd vertical name from "silently never fires" into a red test.
MAESTRO_VERTICALS='auth home collections discovery recipes'

# Flows whose state under test is a GENUINELY EMPTY library (the first-run screen a new account opens on).
# The reset truncates for every flow; for these it also SKIPS the re-seed, which is the only way to reach
# that state — and the seeded fixture being universal is exactly what hid a first-run defect from this
# suite. Space-padded on both sides so the membership test below matches whole names only.
EMPTY_LIBRARY_FLOWS=" recipes/empty-library "

# maestro_select_flows <plan> [<name>=true|false …]
#
# The whole selection decision, as a PURE function. Prints exactly one `reason=` line, then one `flow=` line
# per selected flow and one `skipped=` line per excluded flow, in PLAN ORDER. Nothing else goes to stdout.
#
# Recognised keys: `full` plus every token in MAESTRO_VERTICALS. `full=true` (the schedule, a dispatch, or a
# PR carrying the `heavy-e2e` label) means the whole plan.
#
# Anything this function cannot read WIDENS the run and says why: a malformed pair, an unknown key, a
# non-boolean value, no pairs at all, or pairs that implicate no vertical. The ONLY hard failure (exit 2) is
# an empty plan, because "no flows to choose from" is a broken script rather than a selection — and
# answering "run nothing" there would report success over an empty suite.
maestro_select_flows() {
    if [ "$#" -lt 1 ]; then
        echo "usage: run-maestro-flows.sh select-plan <plan> [<name>=true|false …]" >&2

        return 2
    fi

    local plan="$1"
    shift

    if [ -z "${plan//[[:space:]]/}" ]; then
        echo 'run-maestro-flows.sh: the flow plan is EMPTY — refusing to report a green run over no flows' >&2

        return 2
    fi

    local full=false invalid='' selected=' ' pair name value
    for pair in "$@"; do
        name="${pair%%=*}"
        value="${pair#*=}"

        # `<name>` with no `=` leaves `name` equal to the whole argument (same shape as deploy-gate.sh's
        # `<name>=<STATUS>` pairs). An empty name is the `=true` case.
        if [ -z "$name" ] || [ "$name" = "$pair" ]; then
            invalid="malformed selector pair '${pair}' (expected <name>=true|false)"
            continue
        fi

        # Space-padded on BOTH sides so membership is a WHOLE-token match: `recipe` must not match `recipes`,
        # and `recipes_extra` must not either. A substring match here would accept a typo and then narrow the
        # run to something nobody asked for.
        case " full ${MAESTRO_VERTICALS} " in
            *" ${name} "*) ;;
            *)
                invalid="unknown selector key '${name}' (expected full or one of: ${MAESTRO_VERTICALS})"
                continue
                ;;
        esac

        case "$value" in
            true | false) ;;
            *)
                invalid="invalid selector value in '${pair}' (expected true or false)"
                continue
                ;;
        esac

        [ "$value" = 'true' ] || continue

        if [ "$name" = 'full' ]; then
            full=true
        else
            selected="${selected}${name} "
        fi
    done

    local reason
    if [ -n "$invalid" ]; then
        full=true
        reason="${invalid} — running EVERY flow (a selector this script cannot read must never narrow the run)"
    elif [ "$#" -eq 0 ]; then
        full=true
        reason='no selector supplied — running EVERY flow (the default for callers that do not pass one)'
    elif [ "$full" = 'true' ]; then
        reason='full run requested (schedule, dispatch, the heavy-e2e label, or an unattributable change)'
    elif [ "$selected" = ' ' ]; then
        full=true
        reason='the selector implicated NO vertical, so attribution failed — running EVERY flow'
    else
        reason="verticals:${selected% } (plus the spine)"
    fi

    printf 'reason=%s\n' "$reason"

    local entry vertical flow
    # Word-split on the plan's whitespace deliberately: entries are `<vertical>:<flow>` with no spaces.
    for entry in $plan; do
        vertical="${entry%%:*}"
        flow="${entry#*:}"

        if [ "$full" = 'true' ] || [ "$vertical" = 'spine' ]; then
            printf 'flow=%s\n' "$flow"
            continue
        fi

        case "$selected" in
            *" ${vertical} "*) printf 'flow=%s\n' "$flow" ;;
            *) printf 'skipped=%s\n' "$flow" ;;
        esac
    done
}

# maestro_run_flows
#
# Install the APK, prepare the device and the shared test user, resolve the selection, then run each selected
# flow against a freshly reset database. Returns non-zero if any flow (or any reseed) failed.
#
# @sideEffect Drives adb/the emulator, mutates the recipe database, calls Clerk, and runs Maestro.
maestro_run_flows() {
    adb install -r "$APK"
    adb reverse tcp:3000 tcp:3000 || true
    # The soft-keyboard spell checker/suggestions mangle Maestro inputText (duplicated chars, e.g. "collectionn").
    adb shell settings put secure spell_checker_enabled 0 || true
    # With a hardware keyboard (see _ci-heavy.yml `enable-hardware-keyboard`), suppress the on-screen soft
    # keyboard so text fields never raise it. The flows therefore need no `hideKeyboard`, whose BACK keypress
    # otherwise pops the nav stack / exits the app whenever no soft keyboard is open.
    adb shell settings put secure show_ime_with_hard_keyboard 0 || true

    # Re-provision the shared sign-in user right before the flows: the parallel web-E2E job's globalTeardown
    # (deleteAllE2EUsers) deletes it ~45min earlier, so the job's early provision step is stale by now.
    node packages/apps/commise/mobile/tests/e2e/ensure-signin-user.mjs

    export DATABASE_URL=postgres://postgres:postgres@localhost:5432/recipe_maestro

    # `MAESTRO_FLOW_SELECTOR` is `<name>=<bool>` pairs (see maestro_select_flows). Unset/empty is the
    # fail-safe full run, so `read -a` on an empty string yielding an empty array is a correct default. The
    # `${pairs[@]+…}` guard keeps `set -u` happy for that empty case WITHOUT passing an empty argument, which
    # the selector would (rightly) report as a malformed pair.
    local pairs=()
    read -r -a pairs <<<"${MAESTRO_FLOW_SELECTOR:-}"

    local verdict
    if ! verdict=$(maestro_select_flows "$FLOW_PLAN" ${pairs[@]+"${pairs[@]}"}); then
        echo "::error::maestro flow selection failed — refusing to run an unknown subset of the suite"

        return 1
    fi

    echo "::notice::maestro flows — $(printf '%s\n' "$verdict" | sed -n 's/^reason=//p')"

    local flows skipped
    flows=$(printf '%s\n' "$verdict" | sed -n 's/^flow=//p' | tr '\n' ' ')
    skipped=$(printf '%s\n' "$verdict" | sed -n 's/^skipped=//p' | tr '\n' ' ')

    # A selection that ran nothing must be a RED job, not a green one. Unreachable through the pure function
    # (every fallback widens), so this is the post-condition that keeps it that way if that ever changes.
    if [ -z "${flows//[[:space:]]/}" ]; then
        echo '::error::maestro selected NO flows — that is a broken selector, not a passing test run'

        return 1
    fi

    # Say out loud what did NOT run. A narrowed run must never read like a complete one.
    if [ -n "${skipped//[[:space:]]/}" ]; then
        echo "skipped by selection: ${skipped% }"
    fi

    local rc=0 f reseed_mode
    for f in $flows; do
        echo "::group::maestro flow ${f}"
        adb logcat -c || true # clear the ring buffer so a failing flow's dump is scoped to just this flow
        case "$EMPTY_LIBRARY_FLOWS" in
            *" ${f} "*) reseed_mode=empty ;;
            *) reseed_mode=seeded ;;
        esac
        if ! RESEED_MODE="$reseed_mode" node packages/apps/commise/mobile/tests/e2e/reseed.mjs; then
            echo "reseed failed before ${f}"
            rc=1
        fi
        if ! maestro test "packages/apps/commise/mobile/.maestro/${f}.yaml"; then
            echo "FLOW FAILED: ${f}"
            # Native/Hermes crashes (app -> launcher) leave NO Java/AndroidRuntime trace and release builds strip
            # the JS console, so a narrow filter shows nothing. Dump the full tail and grep every crash-carrying
            # tag (native SIGSEGV/abort via libc/DEBUG, Hermes, Java via AndroidRuntime/FATAL, and our own app tag)
            # so the CI log shows the ACTUAL fault rather than only the downstream "element not visible".
            echo "--- logcat (crash tags) for ${f} ---"
            adb logcat -d -t 4000 2>&1 | grep -aiE "FATAL|AndroidRuntime|hermes|SIGSEGV|SIGABRT|\blibc\b|DEBUG   |abort message|Exception|io\.commise|ReactNativeJS|ReactNative:|unhandled" | tail -160 || true
            echo "--- end logcat for ${f} ---"
            rc=1
        fi
        echo "::endgroup::"
    done

    return "$rc"
}

# CLI dispatch — only when executed directly, never when sourced. No arguments is RUN MODE, because that is
# how the emulator-runner invokes this file (`bash run-maestro-flows.sh`, one line, no arguments).
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    case "${1-}" in
        '')
            maestro_run_flows
            ;;
        select)
            shift
            maestro_select_flows "$FLOW_PLAN" "$@"
            ;;
        select-plan)
            shift
            maestro_select_flows "$@"
            ;;
        plan)
            # Unquoted on purpose: one plan entry per line of output.
            # shellcheck disable=SC2086
            printf '%s\n' $FLOW_PLAN
            ;;
        verticals)
            # shellcheck disable=SC2086
            printf '%s\n' $MAESTRO_VERTICALS
            ;;
        *)
            echo "usage: run-maestro-flows.sh [select|select-plan|plan|verticals] …" >&2
            exit 2
            ;;
    esac
fi
