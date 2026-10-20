#!/usr/bin/env bash
# Runs the Maestro mobile flows on the booted emulator (Android) or Simulator (iOS) with PER-FLOW DB isolation.
# On Android it is invoked as a single line from the reactivecircus/android-emulator-runner `script:` (that
# runner executes each script LINE as its own `sh -c`, so multi-line constructs like this loop must live in a
# file, not inline); on iOS it is an ordinary `run:` step on the macOS runner.
#
# For each flow: reset the recipe DB to the clean seed fixture (so a flow never inherits an earlier flow's
# mutated state), then run just that flow. Every flow runs even if one fails; the job fails if any did.
#
# ## PER-VERTICAL FLOW SELECTION (why this script has subcommands at all)
#
# Measured on nightly run 31471786779, this job is 52.75m: 17.3m of FIXED setup (12.9m Gradle release-APK
# build + ~1.5m emulator/AVD boot + install + ~2.9m checkout/deps/service build/seed) and 35.5m of FLOW
# EXECUTION. The variable half dominates the fixed half 2:1, so which FLOWS run is the lever — not Gradle or
# AVD caching, which target the smaller fixed half (~2.8%, refuted; do not re-propose it). That still holds for those
# two. What changed on 2026-10-13 is a DIFFERENT lever on the same fixed half: the app is no longer built per shard at
# all — it is built once, beside the deploy, and reused whole when its content key matches an earlier build
# (`_mobileAppBuild.yml`) — which removes the build rather than speeding it up.
# `recipes/collectionsPagination` alone is 7.75m, 22% of all flow time.
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
# `packages/tools/repoGuards/__tests__/maestroFlowSelection.test.ts`, which also owns the inventory assertion
# that every committed `.maestro` flow is planned, is a `runFlow` sub-flow, is inert for a stated reason, or
# is a recorded gap. That guard exists because a flow (`recipes/ingredientCatalogBlend.yaml`, since deleted) was
# committed and then executed by nothing for months: `FLOWS` was a hand-maintained list and nobody added it.
#
# ## SHARDING — the other half of the same lever (`maestroShardPartition.test.ts`)
#
# Selection narrows the flow half when a change can be ATTRIBUTED. Sharding divides it when it cannot, which
# is exactly the full-run case selection is powerless against: `_ci-heavy.yml` runs this tier as a matrix and
# each shard runs a DISJOINT part of the selection on its own emulator. Measured on run 35220684252 —
# 15.0m fixed per runner, 32.2m of flows — two shards take a 47m job to ~33m.
#
# Three rules make that safe, and none of them is optional:
#
#   1. **Disjoint identities.** Every flow signs in as the tier's FIXED Clerk pool slots and the per-flow reset
#      RECONCILES that signer's library to the run manifest, so two shards on one signer delete each other's
#      fixtures mid-flow. `maestroSlotForShard` (testPool.ts) partitions the roster by PLATFORM and then by shard
#      (Android and iOS each have eight disjoint lanes), and `MAESTRO_MAX_SHARDS` below is the shell-side copy of what
#      EACH platform's lanes can reach. A platform's erasure subjects are NOT partitioned across its shards: they all
#      belong to that platform's `MAESTRO_ERASURE_SHARD`, and every flow in `MAESTRO_ERASING_FLOWS` is pinned there
#      (see below).
#   2. **The SPINE runs on every shard.** Each shard installs the APK on its own emulator and nothing wipes the
#      app between flows, so a shard that skipped `auth/loginFlow` would start every flow signed out.
#   3. **A flow runs on exactly ONE shard.** Asserted over the UNION of the shards, because "a flow that runs
#      on no shard" is the same green-over-nothing sin as an under-selecting selector.
#
# ## PLATFORMS — one plan, one runner, two devices (`maestroPlatformExclusions.test.ts`)
#
# `MAESTRO_PLATFORM` is `android` or `ios`; UNSET means `android`, because every caller that predates iOS —
# the Android CI step until it named itself, and `local-sandbox/bin/localMaestro.sh`, which SOURCES this file —
# relies on that. Any other value is REFUSED (exit 2 in the pure doors, a red run in run mode): a platform this
# script does not know is a broken caller, and guessing one would drive the wrong device's commands.
#
# The plan is the same on both. What differs is (a) the device adapter — install, driver reset, log scoping,
# diagnostics — chosen by platform in the `maestro_*` functions below, and (b) the flows a platform CANNOT run,
# which are EXCLUDED by `MAESTRO_PLATFORM_EXCLUSIONS` after selection and before sharding, and printed as
# `excluded=` lines exactly as a narrowed run prints `skipped=`. The guard derives the Android-only set from
# the flows' own YAML and holds this table to it in both directions, so a flow cannot be dropped silently and
# cannot be dropped for nothing.
#
# Usage:
#     runMaestroFlows.sh                              # run mode (what the emulator job invokes)
#     runMaestroFlows.sh select      <name>=true|false …
#     runMaestroFlows.sh select-plan <plan> <name>=true|false …   # test seam; CI never uses it
#     runMaestroFlows.sh shard       <index> <count> <flow> …
#     runMaestroFlows.sh shard-plan  <plan> <index> <count> <flow> …   # test seam; CI never uses it
#     runMaestroFlows.sh shard-matrix <requested> [<name>=true|false …]       # reads MAESTRO_PLATFORM
#     runMaestroFlows.sh shard-selection <index> <count> [<name>=true|false …] # reads MAESTRO_PLATFORM
#     runMaestroFlows.sh platform-flows <platform> <flow> …
#     runMaestroFlows.sh exclusions <platform>
#     runMaestroFlows.sh erasure-subject <flow>                  # reads MAESTRO_FIXTURE_ENV_FILE
#     runMaestroFlows.sh plan | verticals | platforms | max-shards | erasure-shard | erasing-flows | weights | default-weight
set -uo pipefail

# The APK to install. CI hands the one `_mobileAppBuild.yml` built, downloaded and verified (`MAESTRO_ANDROID_APK`);
# the default is the Gradle output path, which only a developer's own local build produces, so a local run is unchanged.
APK="${MAESTRO_ANDROID_APK:-packages/apps/commise/mobile/android/app/build/outputs/apk/release/app-release.apk}"

# ── THE PLAN — every flow CI runs, in execution order, each labelled with its vertical ────────────────────
#
# ONE authoritative list: the order and the vertical membership cannot drift apart, and a narrowed run is
# this list FILTERED (never a concatenation of per-vertical lists), so it is always a subsequence of the full
# run and the ordering below holds for every selection.
#
# Order is deliberate:
#   - `auth/loginFlow` FIRST, and it is the SPINE: every narrowed run includes it. It is the only
#     SIGNED-OUT flow — it launches with `clearState`, asserts the app opens directly on the sign-in form,
#     walks the sign-up entry and back, then signs in via the shared `auth/signin.yaml` sub-flow (which is
#     also what crosses Home into the recipes surface). So it re-establishes a session from cleared state for
#     everything after it AND exercises the app shell, the auth gate, Clerk, the Home widget surface and the
#     recipes-list crossing that EVERY other flow composes. That is what makes narrowing safe: a change to
#     the shared entry path is still proven on every run, whatever vertical was selected. (It absorbed
#     `auth/welcome-flow`, deleted with the welcome screen itself by owner decision on 2026-07-28.)
#   - `home` next, then the recipe stories.
#   - `recipes/viewSetting` sits right after `listDetail`: same populated seed. The list's grid/list choice is an ACCOUNT
#     setting (ADR-0059), and the flow clears the app to prove it lives on the server. It writes the signer's setting, so
#     its last step chooses the list again, the phone default's own layout, for every later flow on that account.
#   - `recipes/landscape` sits next to `listDetail`: the same story rotated to LANDSCAPE (WCAG 2.2 SC 1.3.4), on
#     the same populated seed. It discards its draft, so it mutates nothing, and its `onFlowComplete` puts the
#     emulator back in portrait for every later flow, pass or fail.
#   - `recipes/servingScale` sits next to `listDetail`: same populated seed, and read-only in the strongest
#     sense — the serving scale it drives is session-only display state that never reaches the service, so it
#     cannot perturb any later flow's fixture.
#   - `recipes/detailCooking` follows `servingScale`: the same populated seed, and it writes nothing the service keeps —
#     its checks, current step and Screen on are in-memory session state that the next flow's relaunch drops.
#   - `recipes/deferredCalories` sits next to `listDetail`: same populated seed, read-only, and it crosses
#     into Discover at the end, so it wants the same settled library. It is in the `recipes` vertical rather
#     than `discovery` because its subject is the CARD's deferred figure, which every card surface shares.
#     Note what it can prove here: this job runs NO food service (see `deploy`/`_ci-heavy.yml`'s
#     `FOOD_SERVICE_URL`), so no calorie figure can render — the flow asserts the invariant instead, that the
#     placeholder always comes down. Its own docblock says so; do not "fix" it by asserting a number.
#   - `recipes/discoverBrowse` sits with the other read-only discovery flows (it types and clears a query but
#     mutates nothing, so it is order-independent).
#   - `recipes/discoverIngredientCap` (curated U9) sits with them for the same reason: the filter is screen state, so
#     it writes nothing. It filters on six foods the seed authors as the signer (`E2E_CAP_FOOD_PREFIX`), because the
#     filter's search returns only foods the caller has a binding for.
#   - `recipes/addIngredientLine` (slice 8) sits immediately after `addIngredientLoop`: the quantity-first add field,
#     and the device proof that Hermes runs the leading-measure reader's Unicode property escapes (blueprint A1). It
#     picks the probe food `Flour` and discards its draft.
#   - `recipes/pasteList` (slice 8, which replaced the paste-and-review flow) follows `create`: Paste a list in the
#     editor's Ingredients section, polled to completion by the parse worker. It discards its draft.
#   - `recipes/ingredientUnmatched` (plan 002 US1) sits immediately after `addIngredientLine`: it shares the
#     create editor's freeform prelude, and it DISCARDS its draft, so it leaves the library as it found it.
#   - `recipes/ingredientNutritionPanel` (plan 002 US5) follows it for the same reasons; it picks the seeded probe
#     food `Flour` rather than creating one.
#   - `recipes/ingredientRemove` (plan 002 US6) follows them: the same freeform prelude, twice, and a discard.
#   - `recipes/ingredientArrival` (`docs/design/uiOverhaul/ingredientArrival.md`) follows it: eight lines declared "as written"
#     through `recipes/common/addDeclaredLine.yaml`, then one look at the page with no scroll command. It needs NO food
#     service and discards its draft.
#   - `recipes/ingredientAddDetails` (curated U15) sits after `createAuthoredFood`: it picks a KTD-16 root from the
#     stage's food catalog, so it needs the food service and the catalog seed, and it discards its draft.
#   - `recipes/ingredientVariantSearch` (curated AE3) and `recipes/ingredientRowVariant` (curated U15) follow it, for
#     the same reasons: they search the same KTD-16 roots in the stage's catalog, and each discards its draft.
#   - `recipes/ingredientRowEditor` (plan 002 V1 B7) follows them: the same catalog root, Change food and the R7
#     refusal; it saves one draft, which the next flow's reset deletes.
#   - `recipes/ingredientCandidates` (row 6, plan 002 S7.9) follows it: the same probe food and Change food, then a
#     by-name line and a remote pick from its glyph's list; it saves one draft, which the next flow's reset deletes.
#   - `recipes/ingredientRemoteFoods` (plan 002 S7.8, which replaced `ingredientUsdaSearch`) follows them: remote
#     foods flowing into the add row's list and Change food's, two remote picks, and a publish the next reset deletes.
#   - `recipes/privateFoodStandIn` sits right after `discoverDetailSaveCopy`: it reaches the co-author's recipe the same
#     way and saves a copy, so it leaves one copy in the signer's library, which the next flow's reset deletes. It is
#     labelled `recipes`, not `discovery`, because what it tests — the nameless line and the copy banner — lives
#     in `features/recipes/src/detail/**`, which the `recipes` path filter owns.
#   - `recipes/quantityRange` sits with the other CREATE-editor flows and immediately after `create`: it
#     publishes (twice), so it mutates the library, and it shares `create`'s "as written" prelude.
#   - `recipes/preparationGroups` (U26/U27) sits immediately after `quantityRange`, for the same three
#     reasons: it publishes (so it mutates the library and belongs in the mutating cluster), it shares
#     `create`'s "as written" prelude, and — like `quantityRange` — its subject is a per-LINE field on
#     the create editor, so the two want the same fixture and the same position. It needs NO food service:
#     the line is declared "as written", exactly as `create` and `quantityRange` do.
#   - `recipes/addIngredientLoop` (U28) sits immediately after `preparationGroups`, for the same
#     three reasons again: it publishes, it shares `create`'s "as written" prelude, and its subject
#     is the create editor's step 2. It needs NO food service. It is deliberately its own flow rather
#     than three more steps inside `create`: its FIRST assertions are that an empty recipe has NO row and
#     that typed text is refused rather than appended (B8), and folding those into a flow whose job is to
#     reach a published recipe would bury the checkpoint that distinguishes typed text from a line.
#   - `dataSources` just before `accountDangerZone`, in the `auth` vertical: the same walk, avatar → Profile (the one
#     page that replaced the Account settings hub), and it only reads (curated U25). `flows_auth` lists both its entry point and its feature folder. It needs a stage
#     whose catalog seed has run and cites USDA and Ciqual (ADR-0051).
#   - `accountDangerZone` late but BEFORE `delete`: it walks avatar → Profile and CANCELS both
#     destructive actions (it deliberately never confirms), so it must not run against a state a later flow
#     assumes, and it must not be stranded after the delete flow's mutations.
#   - `recipes/delete` next (its own "run me last" note — it is now last but one).
#   - `accountErasure` LAST, and it moved when the tier began driving a DEPLOYED stage. It used to sit
#     beside `accountDangerZone` because its identity leg was answered by a runner-local stub that
#     destroyed nothing. There is no stub now: it really erases, through identity, the deletion queue, the
#     worker and Clerk. What makes that safe is its SUBJECT — a CONSUMABLE test-pool slot `e2e-seed`
#     leases solely to be erased, which owns nothing and which no other flow signs in as. Nothing may
#     follow it: it ends a Clerk session and leaves the app signed out, and the next flow would pay for
#     that.
#   - `recipes/createEntry` (slice 8, which replaced the SpeedDial flow) sits immediately BEFORE `create`, as the first
#     of the CREATE-editor block: it is the shortest flow that enters the editor, it mutates nothing (one tap in, ×
#     out, having typed nothing), and putting it first means a broken create entry fails on a 30-second flow rather
#     than four minutes into `create`.
#   - `recipes/emptyLibrary` sits next to `listDetail` (its populated sibling). It is the ONE flow that
#     runs against an EMPTY library — see EMPTY_LIBRARY_FLOWS below — and it mutates nothing, so the next
#     iteration's normal reset restores the seed for everything after it.
#   - `recipes/systemBackGuard` sits between `createEntry` and `create`, at the head of the CREATE-editor block,
#     for the reasons `createEntry` is there: it enters the editor, and it LEAVES THE LIBRARY AS FOUND — the draft
#     its Back creates is discarded through the editor, and the edit leg's device changes are discarded too.
#   - `recipes/paidFeaturesByRole` (plan 2026-10-14-009 D12) sits right after `recipes/visibility`, its premium-only
#     sibling. It READS only (it types no title, so the editor saves nothing, and the `roles` tier is read-only by
#     rule), so it leaves the library as found. It signs in four times — as the `roles` tier's default, premium, vip
#     and superuser users — each after a `clearState`, and its `onFlowComplete` clears the device again so the next
#     flow signs back in as the shard's signer. That spends up to FIVE Clerk email-code verifications per platform per
#     run (the budget the guard in `maestroFlowSelection.test.ts` names). ⛔ It runs on BOTH platform lanes, not one:
#     the only per-platform door is `MAESTRO_PLATFORM_EXCLUSIONS`, which `maestroPlatformExclusions.test.ts` holds
#     EQUAL to the flows that reach an Android-only command, so an entry made to save sign-ins would fail that guard
#     — and it would be the silent narrowing it exists to refuse: a green iOS lane over a role check nobody ran.
#   - `recipes/editorSections` (slice 7) follows it: read-only (it types nothing, so nothing is saved), it proves
#     the one-page editor's sections and the phone's section-index bar on a real layout.
#     It is the only tier that can raise a real `KEYCODE_BACK`: `react-native-web`'s `BackHandler` is an inert
#     stub, so the component tiers can only drive a fake dispatcher, and NOTHING but a device can observe that
#     an open RN `Modal` consumes the key itself before any `BackHandler` subscription is reached.
#
# NOT in this plan, and each for a stated reason (the inventory test enforces that the list of reasons stays
# exhaustive):
#   - `auth/signin.yaml` / `auth/signinHome.yaml` / `recipes/common/clearTitle.yaml` — reusable `runFlow` SUB-flows,
#     not stories. They are covered as part of every story that composes them; running one alone would prove
#     nothing new.
#   - `visual/*` — the U10b `assertScreenshot` flows plus their baseline recorder. `assertScreenshot` has no
#     record mode, so a missing reference PNG is the hard error "Screenshot file not found": they are inert
#     BY CONSTRUCTION until baselines are recorded on the pinned emulator profile and committed. The
#     inventory test asserts that reason against the live state of `visual/baselines/`, so the day the PNGs
#     land it fails and asks for the activation instead of leaving four flows quietly dead.
#   - `homeRecentRecipeTap` and `recipes/sourceTabs` — real story flows that have never executed in CI.
#     Recorded (with their intended verticals) in that test's `KNOWN_UNRUN_FLOWS`; promoting a flow whose
#     only proof is an emulator run belongs in a PR whose Maestro tier is watched.
FLOW_PLAN="spine:auth/loginFlow
home:home
recipes:recipes/rating
recipes:recipes/listDetail
recipes:recipes/viewSetting
recipes:shell/tabBar
recipes:recipes/landscape
recipes:recipes/servingScale
recipes:recipes/detailCooking
recipes:recipes/detailBack
recipes:recipes/deferredCalories
recipes:recipes/emptyLibrary
recipes:recipes/searchNavigation
recipes:recipes/edit
recipes:recipes/versions
recipes:recipes/visibility
recipes:recipes/paidFeaturesByRole
recipes:recipes/makePublicConfirm
discovery:recipes/discoverBrowse
discovery:recipes/discoverRecentSearches
discovery:recipes/discoverIngredientCap
discovery:recipes/discoverSaveCopy
discovery:recipes/discoverDetailSaveCopy
recipes:recipes/privateFoodStandIn
recipes:recipes/conflictMerge
collections:recipes/collections
collections:recipes/collectionAddRemoveUndo
collections:recipes/collectionsPagination
collections:recipes/collectionsVisibility
collections:recipes/collectionsSaveCopy
collections:recipes/collectionsPull
collections:recipes/newCollectionSheet
recipes:recipes/createEntry
recipes:recipes/systemBackGuard
recipes:recipes/editorSections
recipes:recipes/editorDescriptionLimit
recipes:recipes/create
recipes:recipes/publishFeedback
recipes:recipes/cuisineField
recipes:recipes/pasteList
recipes:recipes/pasteListSettle
recipes:recipes/quantityRange
recipes:recipes/preparationGroups
recipes:recipes/ingredientGroups
recipes:recipes/addIngredientLoop
recipes:recipes/addIngredientLine
recipes:recipes/addStepFocus
recipes:recipes/ingredientUnmatched
recipes:recipes/ingredientNutritionPanel
recipes:recipes/ingredientRemove
recipes:recipes/ingredientArrival
recipes:recipes/createAuthoredFood
recipes:recipes/ingredientAddDetails
recipes:recipes/ingredientVariantSearch
recipes:recipes/ingredientRowVariant
recipes:recipes/ingredientRowEditor
recipes:recipes/ingredientCandidates
recipes:recipes/ingredientRemoteFoods
recipes:recipes/pinnedActionBar
recipes:recipes/ambiguityReview
recipes:recipes/photos
recipes:recipes/accessibility
auth:dataSources
auth:profileUsername
auth:accountDangerZone
auth:sessionHandoff
recipes:recipes/delete
auth:accountErasure"

# The vertical tokens a selector may name. `spine` is deliberately NOT among them: it is unconditional, so
# accepting it as a key would let a caller believe it had selected something when it had selected nothing.
# `heavy-e2e.yml` composes exactly these names (plus `full`), and the guard suite asserts the two agree —
# which is what turns a typo'd vertical name from "silently never fires" into a red test.
MAESTRO_VERTICALS='auth home collections discovery recipes'

# ── PLATFORMS, and the flows a platform cannot run ─────────────────────────────────────────────────────────
#
# The device kinds this script can drive. Space-padded membership tests below match whole tokens only.
MAESTRO_PLATFORMS='android ios'

# `<platform>|<flow>|<class>|<reason>`, one per line. The plan is the ANDROID plan, so Android excludes nothing.
#
# The iOS entries are every planned flow that reaches Maestro's SYSTEM back key — `back` or `pressKey: Back`,
# directly or through a `runFlow` sub-flow — which Maestro implements on Android only. The guard derives that
# set from the YAML; this table must equal it. The CLASS is the honest part:
#
#   - `android-behaviour` — the flow's SUBJECT is Android system-back behaviour; iOS has nothing to test.
#   - `coverage-gap` — the subject is cross-platform and the back key is INCIDENTAL. These are real iOS gaps.
#     Six ingredient-story flows used to share one cause (`recipes/common/raiseDiscardGuard.yaml` raised the
#     editor's discard dialog with the system back key). Slice 7 retired that dialog: those flows now discard
#     their scratch draft through `recipes/common/discardDraft.yaml`, the editor's header menu, which both
#     platforms render, so they left this table.
#
# ⛔ Never add an entry to get an iOS run green. A flow that fails on iOS for any other reason is a finding
# about the app or the flow, and this table is not where it goes; the guard refuses an entry with no
# Android-only command behind it.
MAESTRO_PLATFORM_EXCLUSIONS="ios|recipes/discoverBrowse|coverage-gap|closes the filter sheet with Maestro's 'back', which is Android only; Discover browse is untested on iOS until the flow closes the sheet through a control both platforms render
ios|shell/tabBar|coverage-gap|its Android Back leg presses Maestro's 'back' (Android only) to prove Back from the Recipes root goes Home; the iOS path is the edge swipe, in shell/iosSwipeBack
ios|recipes/privateFoodStandIn|coverage-gap|leaves the copy's untouched editor with Maestro's 'back' (Android only) to reach the copy's detail and its private-food banner; the stand-in and the copy banner are untested on iOS until the flow leaves the editor through a control both platforms render
ios|recipes/systemBackGuard|android-behaviour|its subject is Android's SYSTEM back key (KEYCODE_BACK) reaching an open Modal before any BackHandler; iOS has no system back key, so there is nothing to test"

# Maestro's iOS XCUITest runner, as Maestro names it (`LocalXCTestInstaller.UI_TEST_RUNNER_APP_BUNDLE_ID`, read
# at the pinned tag `cli-2.6.1`). Maestro reinstalls it at the start of every session unless it is told
# `--no-reinstall-driver` (a `maestro test` option in 2.6.1: "on iOS, reinstalls xctestrunner driver"), and this
# script now tells it so for a flow that follows a flow that PASSED - see `maestro_run_flow_list`. Anywhere else
# the runner is removed first, which costs one reinstall.
MAESTRO_IOS_DRIVER_BUNDLE='dev.mobile.maestro-driver-iosUITests.xctrunner'

# The ID of the app under test, per platform: what `launchApp` names. Every flow reads it as `appId: ${APP_ID}` and
# `maestro_run_flow_list` passes it with `-e`. These are COPIES of `IOS_BUNDLE_IDENTIFIER` and `ANDROID_PACKAGE` in
# app.config.ts (a bash script cannot import them), and `maestroAppId.test.ts` asserts they agree.
MAESTRO_IOS_APP_ID='com.radicle-co.commise'
MAESTRO_ANDROID_APP_ID='io.commise.mobile'

# maestro_app_id <platform>
#
# Prints the app ID `platform` runs; refuses an unknown platform (exit 2). Pure.
maestro_app_id() {
    case "${1-}" in
        ios) printf '%s\n' "$MAESTRO_IOS_APP_ID" ;;
        android) printf '%s\n' "$MAESTRO_ANDROID_APP_ID" ;;
        *)
            echo "runMaestroFlows.sh: no app ID for platform '${1-}'" >&2

            return 2
            ;;
    esac
}

# ── SHARDING: how many runners the plan may be split across, and what each flow costs ────────────────────
#
# ⛔ `MAESTRO_MAX_SHARDS` IS A COPY OF `maestroShardCapacity(platform)` (packages/tools/e2e-fixtures/src/testPool.ts),
# and `maestroShardPartition.test.ts` asserts the two agree FROM DISK, for EACH platform. It is a copy because neither
# language can typecheck the other and this script must answer "how many shards" without a node process — the same
# cross-language-contract posture `maestroFixtureVariables.test.ts` takes for the fixture key set. One number serves
# both platforms because both have eight lanes (Android signer/signer02-08, iOS iossigner01-08); if they ever differ
# this becomes a per-platform table and the guard says so. Raising it is a THREE-part act: append signer/co-author lanes
# to `POOL_ROSTER`, have the owner run `poolAdmin --apply` so those Clerk users exist, and raise this number. Raising it
# alone produces a shard whose very first pool lease fails with "run poolAdmin --apply".
MAESTRO_MAX_SHARDS=8

# ⛔ THE POOL IS NOT THE ONLY CEILING, AND THIS ONE IS A RUNNER LIMIT. A Simulator job runs on a macOS runner and GitHub
# caps a Team plan at FIVE concurrent macOS jobs (this organisation's plan is `team`). More iOS shards than that do not
# run faster, they QUEUE behind the first five: eight shards of ~30 minutes finish at ~60 minutes, as four did, after
# four more Simulator setups billed at the macOS rate. So the iOS matrix stops here while Android, on a Linux runner,
# reaches the pool. The pool keeps eight lanes per platform so raising this is a one-line change if the plan changes.
# It is not a copy of anything in `testPool.ts` and must never exceed the pool (`maestroShardPartition.test.ts`).
MAESTRO_IOS_RUNNER_CEILING=5

# maestro_runner_ceiling <platform>
#
# How many shards of one platform the RUNNERS can run at once, which is at most what the pool can identify. Pure.
maestro_runner_ceiling() {
    case "${1-}" in
        ios) printf '%s\n' "$MAESTRO_IOS_RUNNER_CEILING" ;;
        android) printf '%s\n' "$MAESTRO_MAX_SHARDS" ;;
        *)
            echo "runMaestroFlows.sh: no runner ceiling for platform '${1-}'" >&2

            return 2
            ;;
    esac
}

# ── THE ERASURE LANE — which shard erases, and which flows erase ───────────────────────────────────────────
#
# ⛔ `MAESTRO_ERASURE_SHARD` IS A COPY OF `MAESTRO_ERASURE_SHARD` in testPool.ts, asserted equal from disk by
# `maestroShardPartition.test.ts`. That module gives each platform's erasure subjects to this one shard of that
# platform (`maestroErasureSlots` states the lease contract), so every flow that erases is PINNED here rather than
# packed: this shard's concurrency group is the only thing that keeps two jobs from leasing the same subject, and a
# flow packed onto another shard would erase on another lane. It is shard 1 because shard 1 is the only index every
# matrix holds — Android's and iOS's are sized separately, so "the last shard" would differ between them.
MAESTRO_ERASURE_SHARD=1

# The flows that REALLY erase a pool slot — each interpolates `${E2E_ERASURE_EMAIL}`. Space-padded, whole-token
# membership. The guard derives this set from the flows' own YAML and holds this list to it in both directions.
MAESTRO_ERASING_FLOWS=' accountErasure '

# What each flow COSTS, in seconds, per platform. The table lives in `maestroFlowSeconds.tsv` beside this script (its header
# records the columns, how a row is measured and which runs it came from), NOT in this file: it is DATA that a measurement
# refreshes, and an iOS flow is timed on iOS rather than modelled as its Android time plus a constant. REPLACED 2026-10-20:
# the table used to be an Android-only list from run 38322183404 plus `MAESTRO_IOS_FLOW_OVERHEAD`, packed least-loaded-first
# in PLAN order, which left the Android shards 17 to 26 minutes apart on today's times (the heaviest flow had doubled).
# The packing is now longest-processing-time-first over this table, in `maestro_pack_flows`.
#
# ⚠️ A STALE OR MISSING ROW COSTS BALANCE, NEVER CORRECTNESS: every flow still runs on exactly one shard whatever the table
# says, and a flow with no row for its platform is packed at that platform's `*` row. What the guard
# (`maestroShardPartition.test.ts`) does forbid is a runnable flow with no row (a new flow must be timed or added at the
# median) and a row naming a flow the plan does not run (a rename nobody followed through).
#
# `MAESTRO_FLOW_SECONDS_FILE` points the packer at another table: a test seam, never set by CI.
MAESTRO_E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAESTRO_FLOW_SECONDS_FILE="${MAESTRO_FLOW_SECONDS_FILE:-${MAESTRO_E2E_DIR}/maestroFlowSeconds.tsv}"

# Flows whose state under test is a GENUINELY EMPTY library (the first-run screen a new account opens on).
# The reset truncates for every flow; for these it also SKIPS the re-seed, which is the only way to reach
# that state — and the seeded fixture being universal is exactly what hid a first-run defect from this
# suite. Space-padded on both sides so the membership test below matches whole names only.
# ⛔ THE DRIVER PORT IS PINNED, AND THE NUMBER'S ONLY IMPORTANT PROPERTY IS THE RANGE IT AVOIDS.
#
# Maestro picks this port on the HOST — `TestCommand.selectPort()` is `ServerSocket(0).use { it.localPort }`,
# commented "guarantees no collision" — and then imposes it on the DEVICE via `am instrument -e port $port`,
# where the driver does `NettyServerBuilder.forPort(port).start()`. The guarantee holds on the host and means
# nothing on the emulator: two machines, two independent sets of bound ports. When the number is already taken
# device-side the driver throws and there is NO retry and NO fallback, so the flow dies before its first
# command. That is what killed `recipes/discoverClone` in run 32182061356:
#
#     E TestRunner: java.io.IOException: Failed to bind to address ::/[::]:35579
#     E TestRunner: Caused by: java.net.BindException: Address already in use
#
# Confirmed against Maestro's source at the pinned CI version and unchanged in 2.7.0/2.8.0 — upgrading does
# not fix it. All 26 ports that run chose were inside the kernel's ephemeral range (32768-60999), which is the
# pool `bind(0)` and outbound `connect()` both draw from. 7001 sits BELOW that range, so the kernel can never
# hand it to anything else by chance: the collision class is removed rather than made rarer.
#
# ⚠️ A fixed port is only safe BECAUSE of `maestro_reset_driver` below. Do not keep one without the other.
#
# ⚠️ AND IT IS SAFE UNDER SHARDING ONLY BECAUSE EACH SHARD IS ITS OWN RUNNER. A matrix shard is a separate VM,
# so 7001 is uncontended and there is nothing here to parameterise. ⛔ It would NOT be safe inside one
# `maestro` process: read at the pinned tag, `TestCommand.selectPort` is called PER SHARD (inside
# `runShardSuite`) and returns `--driver-host-port` unconditionally, so `--shard-split N` hands every shard
# the same pinned port and the `isPortAvailable` loser raises `CliError` for the whole run. 2.6.1 exposes ONE
# `--driver-host-port` per invocation, so a per-shard value is not expressible — which is why the override
# below is an ENV var (a caller that ever needs distinct ports must run distinct processes, one per port).
# The full four-part reasoning for declining `--shard-split` is in `_ci-heavy.yml`'s matrix note.
MAESTRO_DRIVER_PORT="${MAESTRO_DRIVER_PORT:-7001}"

# Maestro's on-device driver. It reinstalls this every invocation, so removing it between flows costs nothing.
MAESTRO_DRIVER_PACKAGE="dev.mobile.maestro"

EMPTY_LIBRARY_FLOWS=" recipes/emptyLibrary "
# The flows whose reset also seeds the gate-AMBIGUOUS probe recipe (`reset.ts --mode ambiguity`). Only these hold it, so
# every other flow's `^3 recipes$` count stays true (plan 013 C3, owner decision 2026-10-19).
AMBIGUITY_FLOWS=" recipes/ambiguityReview "

# Where `e2e-seed provision` writes this run's fixture MANIFEST, and how it reaches the flows.
#
# The manifest is `KEY=VALUE` lines — the run's identities and its run-scoped recipe titles — and every
# flow is run with each pair as a `maestro test -e` argument, which is how a YAML selector interpolates
# `${E2E_RECIPE_LAMB}`. `$RUNNER_TEMP` on CI, the system temp dir locally; it survives between the
# provision step and every per-flow reset, which are separate processes.
#
# ⛔ The key set is a CONTRACT across three languages and none can typecheck against the others, so it is
# asserted from disk in both directions by
# `packages/tools/repoGuards/__tests__/maestroFixtureVariables.test.ts`: a key no flow reads is dead weight, and
# a `${E2E_…}` nothing supplies renders on screen as its own literal text and fails like an app defect.
MAESTRO_FIXTURE_ENV_FILE="${MAESTRO_FIXTURE_ENV_FILE:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/e2e-seed/fixture.env}"

# Load the manifest into MAESTRO_FIXTURE_ENV_ARGS as `-e KEY=VALUE` arguments, in file order. Leaves the
# array EMPTY when no manifest exists, so the `run-one` test seam works without one.
#
# ⛔ THIS POPULATES AN ARRAY AND MUST NOT GO BACK TO PRINTING. It printed the pairs and the call site
# expanded the command substitution UNQUOTED, which word-splits on every space and not merely on newlines.
# Every value here is a run-scoped recipe TITLE, so every one of them contains spaces:
# `E2E_RECIPE_LAMB=Mediterranean Grilled Lamb pr-91` became four arguments, Maestro took the first stray
# word as its positional, and run 34007779812 died on all thirty flows with
# `Flow path does not exist: …/Mediterranean` — roughly two seconds each, before the app was ever driven.
# A string cannot carry argument boundaries; only an array can.
#
# @sideEffect Reads the manifest file; assigns the global MAESTRO_FIXTURE_ENV_ARGS.
maestro_load_fixture_env_args() {
    MAESTRO_FIXTURE_ENV_ARGS=()
    [ -f "$MAESTRO_FIXTURE_ENV_FILE" ] || return 0

    local pair
    while IFS= read -r pair; do
        [ -n "$pair" ] || continue
        MAESTRO_FIXTURE_ENV_ARGS+=(-e "$pair")
    done <"$MAESTRO_FIXTURE_ENV_FILE"
}

# maestro_erasure_subject_check <flow>
#
# Exit 0 when <flow> may run against the manifest at MAESTRO_FIXTURE_ENV_FILE; exit 1, with an `::error::` line,
# when <flow> is an ERASING flow and the manifest names no erasure subject (absent file, absent key, or a blank
# value). Reads the manifest; touches no device and no network.
#
# ⛔ It exists because only `MAESTRO_ERASURE_SHARD` leases a subject, so every other shard's manifest omits
# `E2E_ERASURE_EMAIL` — and what Maestro does with an unresolved `${E2E_ERASURE_EMAIL}` in `signinHome.yaml`'s `env:`
# override is not something this script controls. If it fell back to the parent's `E2E_SIGNIN_EMAIL`, the flow
# would erase the SIGNER. So the runner refuses first, rather than trusting the pin alone.
maestro_erasure_subject_check() {
    local flow="${1-}" line subject=''

    case "$MAESTRO_ERASING_FLOWS" in
        *" ${flow} "*) ;;
        *) return 0 ;;
    esac

    if [ -f "$MAESTRO_FIXTURE_ENV_FILE" ]; then
        while IFS= read -r line; do
            case "$line" in
                E2E_ERASURE_EMAIL=*) subject="${line#E2E_ERASURE_EMAIL=}" ;;
            esac
        done <"$MAESTRO_FIXTURE_ENV_FILE"
    fi

    if [ -z "$subject" ]; then
        echo "::error::${flow} ERASES a pool slot, but the fixture manifest names no erasure subject — only maestro shard ${MAESTRO_ERASURE_SHARD} leases one. Refusing to run it, so it cannot erase anyone else."

        return 1
    fi
}

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
        echo "usage: runMaestroFlows.sh select-plan <plan> [<name>=true|false …]" >&2

        return 2
    fi

    local plan="$1"
    shift

    if [ -z "${plan//[[:space:]]/}" ]; then
        echo 'runMaestroFlows.sh: the flow plan is EMPTY — refusing to report a green run over no flows' >&2

        return 2
    fi

    local full=false invalid='' selected=' ' pair name value
    for pair in "$@"; do
        name="${pair%%=*}"
        value="${pair#*=}"

        # `<name>` with no `=` leaves `name` equal to the whole argument (same shape as deployGate.sh's
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

# maestro_known_platform <platform>
#
# True when the value is one of MAESTRO_PLATFORMS. Pure; says nothing on failure (callers word the refusal).
maestro_known_platform() {
    case " ${MAESTRO_PLATFORMS} " in
        *" ${1-} "*) [ -n "${1-}" ] ;;
        *) return 1 ;;
    esac
}

# maestro_platform
#
# The platform this process drives: `MAESTRO_PLATFORM`, or `android` when it is unset or empty. Prints it, or
# refuses an unknown value with exit 2 — never a default for a value that was SET to something else.
maestro_platform() {
    local platform="${MAESTRO_PLATFORM:-android}"

    if ! maestro_known_platform "$platform"; then
        echo "runMaestroFlows.sh: unknown MAESTRO_PLATFORM '${platform}' (expected one of: ${MAESTRO_PLATFORMS}) — refusing to guess which device to drive" >&2

        return 2
    fi

    printf '%s\n' "$platform"
}

# maestro_platform_exclusions <platform>
#
# The platform's rows of MAESTRO_PLATFORM_EXCLUSIONS as `<flow>|<class>|<reason>` lines. Pure.
maestro_platform_exclusions() {
    if ! maestro_known_platform "${1-}"; then
        echo "runMaestroFlows.sh: unknown platform '${1-}' (expected one of: ${MAESTRO_PLATFORMS})" >&2

        return 2
    fi

    local platform rest
    while IFS='|' read -r platform rest; do
        [ "$platform" = "$1" ] || continue
        printf '%s\n' "$rest"
    done <<<"$MAESTRO_PLATFORM_EXCLUSIONS"
}

# maestro_platform_flows <platform> <flow> …
#
# THE PLATFORM FILTER, as a PURE function. Prints one `flow=` line per flow the platform runs and one
# `excluded=` line per flow it cannot, both in the order given (plan order). Nothing else goes to stdout.
#
# The only hard failures (exit 2) are an unknown platform and an empty flow list — both a broken caller, and
# answering "run nothing" to either is the green-over-no-work outcome this script refuses everywhere else.
maestro_platform_flows() {
    if [ "$#" -lt 1 ] || ! maestro_known_platform "$1"; then
        echo "runMaestroFlows.sh: unknown platform '${1-}' (expected one of: ${MAESTRO_PLATFORMS})" >&2

        return 2
    fi

    local platform="$1"
    shift

    if [ "$#" -eq 0 ]; then
        echo 'runMaestroFlows.sh: no flows to filter for the platform — refusing to report a run over no flows' >&2

        return 2
    fi

    # Space-padded so membership is a whole-name match: `recipes/edit` must not match `recipes/editX`.
    local excluded=' ' row flow
    while IFS= read -r row; do
        [ -n "$row" ] || continue
        excluded="${excluded}${row%%|*} "
    done < <(maestro_platform_exclusions "$platform")

    for flow in "$@"; do
        case "$excluded" in
            *" ${flow} "*) printf 'excluded=%s\n' "$flow" ;;
            *) printf 'flow=%s\n' "$flow" ;;
        esac
    done
}

# maestro_shard_selection <platform> <index> <count> [<name>=true|false …]
#
# The whole "which flows run on THIS runner" decision, as a PURE composition: select (the selector) → filter
# (the platform) → partition (the shard). Prints `selection-reason=` and `shard-reason=` lines, then `flow=`
# for this shard's flows, `skipped=` for flows the selector did not choose, `excluded=` for flows the platform
# cannot run, and `deferred=` for flows another shard runs. Run mode consumes exactly this, and the guards
# execute it, so the composition CI runs is the composition that is tested.
#
# Exit 2 on any stage's refusal, with that stage's reason on stderr and NOTHING on stdout — a partial verdict
# must not be readable as a whole one.
maestro_shard_selection() {
    if [ "$#" -lt 3 ]; then
        echo 'usage: runMaestroFlows.sh shard-selection <index> <count> [<name>=true|false …]' >&2

        return 2
    fi

    local platform="$1" index="$2" count="$3"
    shift 3

    local verdict filtered sharded kept
    verdict=$(maestro_select_flows "$FLOW_PLAN" "$@") || return 2
    # shellcheck disable=SC2046 # one flow name per word, and flow names carry no whitespace
    filtered=$(maestro_platform_flows "$platform" $(printf '%s\n' "$verdict" | sed -n 's/^flow=//p')) || return 2
    kept=$(printf '%s\n' "$filtered" | sed -n 's/^flow=//p' | tr '\n' ' ')

    if [ -z "${kept//[[:space:]]/}" ]; then
        echo "runMaestroFlows.sh: ${platform} can run NONE of the selected flows — refusing to report a run over no flows" >&2

        return 2
    fi

    # shellcheck disable=SC2086 # `kept` is a space-separated list of flow names
    sharded=$(maestro_pack_flows "$platform" "$FLOW_PLAN" "$index" "$count" $kept) || return 2

    printf 'selection-reason=%s\n' "$(printf '%s\n' "$verdict" | sed -n 's/^reason=//p')"
    printf 'shard-reason=%s\n' "$(printf '%s\n' "$sharded" | sed -n 's/^reason=//p')"
    printf '%s\n' "$sharded" | grep -E '^(flow|deferred)=' || true
    printf '%s\n' "$verdict" | grep '^skipped=' || true
    printf '%s\n' "$filtered" | grep '^excluded=' || true
}

# maestro_positive_integer <value>
#
# True when the value is a decimal positive integer. Pure. Written out rather than reaching for `[ "$x" -gt 0 ]`,
# which under bash treats a non-numeric string as an ARITHMETIC EXPRESSION and can evaluate a variable name.
maestro_positive_integer() {
    case "${1-}" in
        '' | *[!0-9]*) return 1 ;;
    esac

    [ "$1" -ge 1 ]
}

# maestro_seconds_rows <platform>
#
# The platform's rows of the seconds table as `<flow><TAB><seconds>` lines, comments and blank lines dropped. Pure (reads
# the table, writes nothing). A missing or unreadable table is a hard failure (exit 2): packing on no data would answer
# "every flow costs the same" and look like a working planner.
#
# Matched by whole-field EQUALITY in awk, the platform passed through the ENVIRONMENT: `awk -v` would interpret backslash
# escapes in a value, and a flow name contains `/`, so a regex over it is one escaping mistake from weighting the wrong flow.
maestro_seconds_rows() {
    if [ ! -r "$MAESTRO_FLOW_SECONDS_FILE" ]; then
        echo "runMaestroFlows.sh: cannot read the flow-seconds table '${MAESTRO_FLOW_SECONDS_FILE}' - refusing to pack shards on no measurements" >&2

        return 2
    fi

    MAESTRO_ROWS_PLATFORM="$1" awk -F '\t' '
        /^#/ || NF < 3 { next }
        $1 == ENVIRON["MAESTRO_ROWS_PLATFORM"] { print $2 "\t" $3 }
    ' "$MAESTRO_FLOW_SECONDS_FILE"
}

# maestro_default_weight <platform>
#
# What a flow with no row of its own costs on the platform: the table's `*` row. Pure. Exit 2 when the table has none,
# because a default of zero would make the packer ignore every untimed flow.
maestro_default_weight() {
    local rows seconds
    rows="$(maestro_seconds_rows "$1")" || return 2
    seconds="$(printf '%s\n' "$rows" | awk -F '\t' '$1 == "*" { print $2; exit }')"

    if ! maestro_positive_integer "$seconds"; then
        echo "runMaestroFlows.sh: the flow-seconds table has no usable '*' row for '${1}' - refusing to cost an untimed flow as free" >&2

        return 2
    fi

    printf '%s\n' "$seconds"
}

# maestro_flow_cost <platform> <plan-free flow name>
#
# What the PACKER charges a shard for running the flow on that platform: the platform's measured row for it, else the
# platform's `*` row. Pure. The platform is a PARAMETER, never read from the environment, so the packer's answer is a
# function of its arguments, and an unknown platform is refused (exit 2) instead of costed as Android.
maestro_flow_cost() {
    if [ "$#" -ne 2 ] || ! maestro_known_platform "$1"; then
        echo "runMaestroFlows.sh: unknown platform '${1-}' (expected one of: ${MAESTRO_PLATFORMS}) - refusing to cost a flow for a device it does not know" >&2

        return 2
    fi

    local rows seconds
    rows="$(maestro_seconds_rows "$1")" || return 2
    seconds="$(MAESTRO_COST_FLOW="$2" awk -F '\t' '$1 == ENVIRON["MAESTRO_COST_FLOW"] { print $2; exit }' <<<"$rows")"

    if maestro_positive_integer "$seconds"; then
        printf '%s\n' "$seconds"
    else
        maestro_default_weight "$1"
    fi
}

# maestro_shard_flows <plan> <index> <count> [<flow> …]
#
# THE PARTITION, as a PURE function: plan + shard coordinates + the selected flows in, this shard's flows out.
# Prints exactly one `reason=` line, then one `flow=` line per flow THIS shard runs and one `deferred=` line
# per selected flow another shard runs — both in the order they were given, which is plan order because that
# is what `maestro_select_flows` emits. Nothing else goes to stdout.
#
# ⛔ SPINE FIRST, ON EVERY SHARD. A spine flow is not packed; it is emitted by every shard, because a shard
# that did not re-establish a session from cleared state would run every later flow signed out. That is also
# what makes an empty shard impossible for any selection the selector can produce.
#
# ⛔ AN ERASING FLOW IS PINNED TO `MAESTRO_ERASURE_SHARD`, never packed (see the erasure lane above). Its weight is
# charged to that shard BEFORE the packing starts, so the packer balances the rest around it, and it keeps its plan
# position — `accountErasure` is last in the plan, so it stays last on its shard.
#
# ⛔ The packing is LONGEST-PROCESSING-TIME-FIRST over the measured seconds table: the packable flows are sorted heaviest
# first (ties by flow NAME, byte order) and each goes to the least-loaded shard (ties to the lowest index). It is
# DETERMINISTIC — every shard of a run computes the identical assignment from the identical inputs, so no
# shard has to be told what the others took. Walking the PLAN order instead (the previous packer) strands the big flows
# late in the walk, when every shard is already loaded; heaviest-first is the classic 4/3-approximation for the makespan,
# which is the wall clock. Round-robin was rejected earlier on the measurement and still is.
#
# The only hard failures (exit 2) are a broken matrix (`index`/`count` not a shard of anything) and an empty
# flow list — both are a broken caller rather than a selection, and answering "run nothing" to either is the
# green-over-no-work outcome this script exists to refuse.
maestro_shard_flows() {
    maestro_pack_flows android "$@"
}

# maestro_pack_flows <platform> <plan> <index> <count> [<flow> …]
#
# `maestro_shard_flows` for a stated platform: the same pure partition, each flow charged `maestro_flow_cost` for that
# platform. `maestro_shard_flows` is the Android answer; `maestro_shard_selection` passes its own platform here, so the iOS
# shards are packed on what an iOS flow costs.
maestro_pack_flows() {
    if [ "$#" -lt 4 ]; then
        echo 'usage: runMaestroFlows.sh shard-plan <plan> <index> <count> [<flow> …]' >&2

        return 2
    fi

    local platform="$1" plan="$2" index="$3" count="$4"
    shift 4

    if ! maestro_positive_integer "$index" || ! maestro_positive_integer "$count" || [ "$index" -gt "$count" ]; then
        echo "runMaestroFlows.sh: '${index}/${count}' is not a shard of a matrix — refusing to run an unknown subset of the suite" >&2

        return 2
    fi

    if [ "$#" -eq 0 ]; then
        echo 'runMaestroFlows.sh: no flows to shard — refusing to report a green shard over no flows' >&2

        return 2
    fi

    # One shard is the IDENTITY, stated explicitly rather than falling out of the packing: an unsharded run
    # must be byte-identical to what ran before sharding existed.
    if [ "$count" -eq 1 ]; then
        printf 'reason=%s\n' 'single shard — every selected flow runs here'
        printf 'flow=%s\n' "$@"

        return 0
    fi

    # Spine membership comes from the PLAN, space-padded so the test is a whole-token match.
    local spine=' ' entry
    for entry in $plan; do
        case "$entry" in
            spine:*) spine="${spine}${entry#spine:} " ;;
        esac
    done

    local loads=() position
    for ((position = 0; position < count; position += 1)); do
        loads+=(0)
    done

    # The spine runs on EVERY shard, so it adds the same to each load and cannot change who gets what; it is charged so
    # the reason line states the shard's whole predicted time.
    local flow weight spine_seconds=0
    for flow in "$@"; do
        case "$spine" in
            *" ${flow} "*)
                weight="$(maestro_flow_cost "$platform" "$flow")" || return 2
                spine_seconds=$((spine_seconds + weight))
                ;;
        esac
    done
    for ((position = 0; position < count; position += 1)); do
        loads[position]=$((loads[position] + spine_seconds))
    done

    # An erasing flow is pinned to the erasure shard and charged to it BEFORE the packing starts.
    local packable=''
    for flow in "$@"; do
        weight="$(maestro_flow_cost "$platform" "$flow")" || return 2
        case "$spine" in
            *" ${flow} "*) continue ;;
        esac
        case "$MAESTRO_ERASING_FLOWS" in
            *" ${flow} "*)
                loads[MAESTRO_ERASURE_SHARD - 1]=$((loads[MAESTRO_ERASURE_SHARD - 1] + weight))
                continue
                ;;
        esac
        packable="${packable}${weight}"$'\t'"${flow}"$'\n'
    done

    # Longest first; equal weights by flow NAME in byte order (`LC_ALL=C`, so the locale of the runner cannot reorder
    # them), then each to the least-loaded shard, the lowest index on a tie. `owned` holds `<flow>\t<shard>` lines.
    local owned='' lightest line
    while IFS=$'\t' read -r weight flow; do
        if [ -z "$flow" ]; then
            continue
        fi

        lightest=0
        for ((position = 1; position < count; position += 1)); do
            if [ "${loads[position]}" -lt "${loads[lightest]}" ]; then
                lightest="$position"
            fi
        done
        loads[lightest]=$((loads[lightest] + weight))
        owned="${owned}${flow}"$'\t'"$((lightest + 1))"$'\n'
    done < <(printf '%s' "$packable" | LC_ALL=C sort -t $'\t' -k1,1nr -k2,2)

    local mine=() theirs=() owner
    for flow in "$@"; do
        case "$spine" in
            *" ${flow} "*)
                mine+=("$flow")
                continue
                ;;
        esac

        case "$MAESTRO_ERASING_FLOWS" in
            *" ${flow} "*)
                owner="$MAESTRO_ERASURE_SHARD"
                ;;
            *)
                owner=''
                while IFS=$'\t' read -r line position; do
                    if [ "$line" = "$flow" ]; then
                        owner="$position"
                    fi
                done <<<"$owned"
                ;;
        esac

        if [ "$owner" = "$index" ]; then
            mine+=("$flow")
        else
            theirs+=("$flow")
        fi
    done

    printf 'reason=shard %s/%s — %s flows, ~%ss of measured flow time (the spine runs on every shard)\n' \
        "$index" "$count" "${#mine[@]}" "${loads[index - 1]}"
    # `${a[@]+…}` rather than a bare expansion: under `set -u` an EMPTY array is an unbound variable on
    # bash 3.2, and a bare `printf 'flow=%s\n' "${mine[@]}"` on an empty array would print one EMPTY `flow=`
    # line — a phantom flow the caller would then try to run.
    if [ "${#mine[@]}" -gt 0 ]; then
        printf 'flow=%s\n' "${mine[@]}"
    fi
    if [ "${#theirs[@]}" -gt 0 ]; then
        printf 'deferred=%s\n' "${theirs[@]}"
    fi
}

# maestro_shard_matrix <requested> [<name>=true|false …]
#
# The GitHub matrix, as a JSON array of 1-based shard indices — `[1]`, `[1,2]`, …. Pure.
#
# Clamped from above by three things, and by the SMALLEST of them: what the caller asked for,
# MAESTRO_MAX_SHARDS (what the Clerk pool can give disjoint identities to), and how many non-spine flows the
# selector actually chose (so a narrowed run never boots an emulator to run only the spine).
#
# ⛔ AN UNREADABLE REQUEST CLAMPS TO ONE SHARD — the opposite direction from the SELECTOR's fail-safe, and
# deliberately so. Selection widens because running MORE flows is safe; shard count does NOT, because a shard
# count the pool cannot identify is a shard signing in as another shard's user. One shard is always safe.
#
# ⛔ PER PLATFORM (`MAESTRO_PLATFORM`): the packable count is taken AFTER the platform filter, because a matrix
# sized for Android's flows would hand an iOS shard nothing but the spine whenever iOS excludes enough of a
# narrowed selection. An unknown platform is refused (exit 2, nothing on stdout) — there is no matrix for it.
maestro_shard_matrix() {
    local requested="${1-}" count=1 platform
    shift || true

    platform=$(maestro_platform) || return 2

    if maestro_positive_integer "$requested"; then
        count="$requested"
    fi

    if [ "$count" -gt "$MAESTRO_MAX_SHARDS" ]; then
        count="$MAESTRO_MAX_SHARDS"
    fi

    # The runner ceiling for THIS platform: the pool may identify more shards than the runners can run at once.
    local ceiling
    ceiling=$(maestro_runner_ceiling "$platform") || return 2
    if [ "$count" -gt "$ceiling" ]; then
        count="$ceiling"
    fi

    # How many flows are actually PACKABLE: the selection minus the spine, which every shard runs anyway.
    #
    # ⛔ THE SPINE COUNT COMES FROM THE PLAN, never from the name `auth/loginFlow`. A literal here would be a
    # second statement of "which flow is the spine" — the plan already carries it as a `spine:` label, and
    # `maestro_shard_flows` reads it from there, so a literal would let the two disagree the day the spine is
    # renamed or a second spine flow is added. That drift is silent in the worst direction: the matrix would
    # be sized against the wrong number and a shard could hold nothing but the spine.
    local verdict packable spine_count selected_count
    if verdict=$(maestro_select_flows "$FLOW_PLAN" "$@"); then
        # shellcheck disable=SC2086
        spine_count=$(printf '%s\n' $FLOW_PLAN | grep -c '^spine:' || true)
        # Counted over what THIS platform runs, never over the raw selection (see the note above).
        # shellcheck disable=SC2046 # one flow name per word, and flow names carry no whitespace
        selected_count=$(maestro_platform_flows "$platform" $(printf '%s\n' "$verdict" | sed -n 's/^flow=//p') |
            grep -c '^flow=' || true)
        packable=$((selected_count - spine_count))

        # PACKABLE = 0 CLAMPS TO ONE SHARD. `maestro_positive_integer` is false for 0, so a selection of
        # nothing but the spine used to fall through with `count` unchanged, giving two runners that each boot
        # an emulator and build a release APK to run the spine and nothing else.
        #
        # ⚠️ DEFENSIVE, NOT A FIX FOR AN OBSERVED DEFECT — stated precisely because a review reported it as
        # live and the reproduction did not hold. `shard-matrix 2 full=false auth/loginFlow=true` does return
        # `[1,2]`, but `auth/loginFlow` is not a SELECTOR KEY (the keys are `full` and the verticals), and an
        # unknown key deliberately fails OPEN to every flow — so that `[1,2]` is correct behaviour, not
        # waste. Every vertical holds at least one flow besides the spine (`runMaestroFlows.sh verticals`
        # lists them), so `packable` is at least 1 under every valid selector and 0 is UNREACHABLE today.
        #
        # It is kept because it becomes reachable the day a vertical contains only the spine, and because an
        # unreadable `packable` should clamp DOWN to one — the safe direction for a shard whose flow set the
        # script cannot size.
        if [ "$count" -gt "$packable" ] 2>/dev/null; then
            if maestro_positive_integer "$packable"; then
                count="$packable"
            else
                count=1
            fi
        fi
    fi

    local out='[1]' position
    for ((position = 2; position <= count; position += 1)); do
        out="${out%]},${position}]"
    done

    printf '%s\n' "$out"
}

# ── THE DEVICE ADAPTERS — one per platform, chosen by `maestro_platform` ───────────────────────────────────
#
# Every function below that touches a device dispatches on the platform and keeps the two bodies apart. The
# Android bodies are the ones this tier has always run, unchanged, and they still call bare `adb`/`maestro` —
# `local-sandbox/bin/localMaestro.sh` sources this file and SHADOWS both to pin its emulator serial, which only
# works while nothing here names a path to either binary. The iOS bodies name their Simulator by UDID
# (`MAESTRO_IOS_UDID`, set by the workflow step that created and booted it), so they never act on "whatever
# is booted".

# maestro_require_device <platform>
#
# Refuse to drive a device this process was not told about. Android needs nothing (adb's one device, or the
# caller's shadow); iOS needs the Simulator's UDID, and the app bundle when installing.
#
# @sideEffect Prints an `::error::` annotation on refusal.
maestro_require_device() {
    if [ "$1" = 'ios' ] && [ -z "${MAESTRO_IOS_UDID:-}" ]; then
        echo '::error::MAESTRO_PLATFORM=ios needs MAESTRO_IOS_UDID — the Simulator to drive is never guessed'

        return 1
    fi
}

# maestro_android_input_settings
#
# Settle the Android device's input settings. CI's `maestro_prepare_device` and the local runner
# (`packages/tools/local-sandbox/bin/localMaestro.sh`) both call this, so the two devices cannot differ.
#
# @sideEffect Writes device settings and prints the IME setting back.
maestro_android_input_settings() {
    # The soft-keyboard spell checker/suggestions mangle Maestro inputText (duplicated chars, e.g. "collectionn").
    adb shell settings put secure spell_checker_enabled 0 || true
    # "Show virtual keyboard while a physical keyboard is active" (Settings.Secure `show_ime_with_hard_keyboard`).
    # The AVD `avdmanager` builds from the pixel_6 profile can report a hardware keyboard (`_ci-heavy.yml` rewrites
    # it to `hw.keyboard=no` before launch); with one reported, `0` here keeps the IME down and every flow that
    # needs the keyboard up (pinnedActionBar, keyboardReveal, the sign-in footer pin) never sees it. `1` is
    # harmless without a hardware keyboard. Printed back so the log says what the device holds.
    adb shell settings put secure show_ime_with_hard_keyboard 1 || true
    echo "show_ime_with_hard_keyboard=$(adb shell settings get secure show_ime_with_hard_keyboard | tr -d '\r')"
}

# maestro_prepare_device <platform>
#
# Install the app and settle the device's input settings, once per run.
#
# @sideEffect Installs the app on the device and writes device settings.
maestro_prepare_device() {
    case "$1" in
        android)
            adb install -r "$APK"
            adb reverse tcp:3000 tcp:3000 || true
            maestro_android_input_settings
            ;;
        ios)
            # The keyboard's own settings (autocorrect, prediction, capitalisation) are written by the workflow
            # BEFORE the Simulator boots, because the keyboard reads them at boot; this runs after it. What is
            # left here is the install, which is the iOS half of `adb install -r`.
            if [ -z "${MAESTRO_IOS_APP:-}" ] || [ ! -d "$MAESTRO_IOS_APP" ]; then
                echo "::error::MAESTRO_IOS_APP ('${MAESTRO_IOS_APP:-}') is not a built .app bundle — the iOS build must run first"

                return 1
            fi
            xcrun simctl install "$MAESTRO_IOS_UDID" "$MAESTRO_IOS_APP"
            ;;
    esac
}

# Remove any driver left over from a previous flow, so the pinned port is free.
#
# ⛔ This is the half that makes a STATIC port an improvement rather than a hazard. Maestro closes its driver
# from a JVM shutdown hook gated on a session heartbeat; in the failing run 21 of 26 flows logged no cleanup
# at all and the other 5 stopped at `[Start] Uninstall driver` with no `[Done]`. If a driver ever outlives its
# flow, a fixed port hands it straight to the next one — a deterministic red instead of a 1-in-188 flake,
# which would be strictly worse than the random draw this replaces. So the runner does not trust the hook.
#
# ⚠️ ON iOS THE HAZARD HAS A DIFFERENT SHAPE, and the reset is the same answer to it. The Simulator shares the
# HOST's network, so the pinned port is a host port, and Maestro's iOS `start()` (read at `cli-2.6.1`,
# `LocalXCTestInstaller.startXCTestRunner`) returns early when a runner ALREADY answers on it - a runner that
# survived a crashed flow is INHERITED by the next flow rather than colliding with it. Terminating and
# uninstalling it first means every flow starts the runner Maestro just installed.
#
# ⚠️ THAT RESET IS NO LONGER UNCONDITIONAL ON iOS (plan 2026-10-13-006, cut 2). It cost every flow Maestro's full
# runner install and start, a median 34.9 s of the 46.8 s before "Running on". The hazard it answers is a runner that
# outlived a CRASHED flow, so `maestro_run_flow_list` calls this only when the previous flow did NOT pass (or there was
# none) and otherwise keeps the runner and passes `--no-reinstall-driver`. This function is still the reset itself and
# always does it; the decision to skip lives in the loop that knows how the last flow ended. Android is unchanged.
#
# Runs BEFORE each flow that needs it, never only after: a run that dies mid-flow is exactly the case that leaks a
# driver, and cleanup that only happens on the way out never executes then.
#
# @sideEffect Uninstalls the driver packages and stops any surviving driver process on the device.
maestro_reset_driver() {
    case "$(maestro_platform 2>/dev/null)" in
        ios)
            xcrun simctl terminate "$MAESTRO_IOS_UDID" "$MAESTRO_IOS_DRIVER_BUNDLE" >/dev/null 2>&1 || true
            xcrun simctl uninstall "$MAESTRO_IOS_UDID" "$MAESTRO_IOS_DRIVER_BUNDLE" >/dev/null 2>&1 || true
            ;;
        *)
            adb shell pm uninstall "$MAESTRO_DRIVER_PACKAGE" >/dev/null 2>&1 || true
            adb shell pm uninstall "${MAESTRO_DRIVER_PACKAGE}.test" >/dev/null 2>&1 || true
            adb shell am force-stop "$MAESTRO_DRIVER_PACKAGE" >/dev/null 2>&1 || true
            ;;
    esac
}

# Scope the device log to the flow about to run.
#
# Android clears logcat's ring buffer. iOS's unified log has no ring to clear, so the flow's START TIME is
# recorded instead and the failure dump reads from it.
#
# @sideEffect Clears logcat (Android) or assigns the global MAESTRO_IOS_LOG_START (iOS).
maestro_scope_device_log() {
    case "$(maestro_platform 2>/dev/null)" in
        ios) MAESTRO_IOS_LOG_START="$(date '+%Y-%m-%d %H:%M:%S')" ;;
        *) adb logcat -c || true ;;
    esac
}

# Print the device's crash-carrying log lines for a failed flow. Best-effort: a diagnostic that fails the job
# it is diagnosing is worse than no diagnostic.
#
# @sideEffect Reads the device log (and, on iOS, the host's crash reports).
maestro_dump_device_log() {
    local f="$1"

    case "$(maestro_platform 2>/dev/null)" in
        ios)
            # The app's process name is its bundle EXECUTABLE, read out of the built bundle rather than typed here:
            # it is derived from the Expo app name by `expo prebuild`, and a literal would rot silently on a rename.
            local executable
            executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "${MAESTRO_IOS_APP:-}/Info.plist" 2>/dev/null || true)"
            echo "--- simulator log (process '${executable:-unknown}') for ${f} ---"
            if [ -n "$executable" ]; then
                xcrun simctl spawn "$MAESTRO_IOS_UDID" log show --style compact \
                    --start "${MAESTRO_IOS_LOG_START:-}" --predicate "process == \"${executable}\"" 2>&1 | tail -160 || true
                echo "--- crash reports for ${executable} ---"
                local reports
                reports="$(find "$HOME/Library/Logs/DiagnosticReports" -maxdepth 1 -name "${executable}*" 2>/dev/null | head -5)"
                printf '%s\n' "${reports:-(none)}"
            fi
            # Maestro's XCTest runner log is printed HERE, to the masked console, because the workflow keeps it out
            # of the uploaded report: the runner inherits this step's environment, which holds the Clerk secret.
            local runner_log
            runner_log="$(find "$HOME/.maestro/tests" -name 'xctest_runner_*.log' -type f 2>/dev/null | sort | tail -1)"
            if [ -n "$runner_log" ]; then
                echo "--- tail of ${runner_log##*/} ---"
                tail -80 "$runner_log" 2>/dev/null || echo '(unreadable)'
            fi
            echo "--- end simulator log for ${f} ---"
            ;;
        *)
            # Native/Hermes crashes (app -> launcher) leave NO Java/AndroidRuntime trace and release builds strip
            # the JS console, so a narrow filter shows nothing. Dump the full tail and grep every crash-carrying
            # tag (native SIGSEGV/abort via libc/DEBUG, Hermes, Java via AndroidRuntime/FATAL, and our own app tag)
            # so the CI log shows the ACTUAL fault rather than only the downstream "element not visible".
            echo "--- logcat (crash tags) for ${f} ---"
            adb logcat -d -t 4000 2>&1 | grep -aiE "FATAL|AndroidRuntime|hermes|SIGSEGV|SIGABRT|\blibc\b|DEBUG   |abort message|Exception|io\.commise|ReactNativeJS|ReactNative:|unhandled" | tail -160 || true
            echo "--- end logcat for ${f} ---"
            ;;
    esac
}

# Name whatever is holding the driver port, and any driver that survived a previous flow.
#
# ⛔ Diagnosing the original failure meant downloading the run artifact and unzipping per-flow logs just to
# learn which port each flow used. That is why this prints the port on the happy path too. On failure it also
# dumps the device socket table: `LISTEN` vs `TIME_WAIT` is the exact distinction that separates "a leftover
# server" from "ordinary traffic residue", and not having it is what left the last investigation unresolved.
#
# On iOS the port is a HOST port (the Simulator shares the host's network), so the host's own socket table is
# the one to read.
#
# Every probe is best-effort — a diagnostic that fails the job it is diagnosing is worse than no diagnostic.
#
# @sideEffect Reads socket and process tables from the device (Android) or the host (iOS).
maestro_dump_port_owner() {
    if [ "$(maestro_platform 2>/dev/null)" = 'ios' ]; then
        echo "--- who holds host port ${MAESTRO_DRIVER_PORT} (the iOS Simulator shares the host's network) ---"
        lsof -nP -iTCP:"${MAESTRO_DRIVER_PORT}" 2>/dev/null || echo "(nothing holds ${MAESTRO_DRIVER_PORT} now)"
        echo "--- surviving maestro processes/apps ---"
        pgrep -fl maestro 2>/dev/null || echo "(none)"
        xcrun simctl listapps "$MAESTRO_IOS_UDID" 2>/dev/null | grep -i maestro || echo "(none installed)"
        echo "--- end port diagnostics ---"

        return 0
    fi

    echo "--- who holds device port ${MAESTRO_DRIVER_PORT} ---"
    # ⛔ "the tool is missing" and "the port is not held" are DIFFERENT answers and must not share a branch.
    # A `cmd | grep port || fallback` chain conflates them: a free port makes grep exit non-zero and silently
    # demotes you to the next tool, so the log ends up showing a raw hex dump that reads like `ss` failed.
    # Observed on a real API-34 image, which is why this is written out longhand.
    local table
    table="$(adb shell ss -tan 2>/dev/null || true)"

    if [ -z "${table//[[:space:]]/}" ]; then
        # `ss` is absent from some images. `/proc/net/tcp*` always exists — ports are HEX there, so name the
        # value we are looking for rather than making the reader convert it.
        printf '(ss unavailable — raw /proc/net/tcp; port %s is %04X in hex)\n' \
            "$MAESTRO_DRIVER_PORT" "$MAESTRO_DRIVER_PORT"
        adb shell cat /proc/net/tcp /proc/net/tcp6 2>/dev/null || echo "(no socket table available)"
    elif printf '%s\n' "$table" | grep -F ":${MAESTRO_DRIVER_PORT}"; then
        # Matched lines are printed by the grep above. `State` distinguishes a LISTENing server from
        # TIME_WAIT residue — the exact ambiguity that left the 35579 investigation unresolved.
        echo "(above: sockets on ${MAESTRO_DRIVER_PORT} — check State for LISTEN vs TIME_WAIT)"
    else
        # A real answer, not a failure: whatever held it has already gone. Say so, and show the full table so
        # the next reader can see what the device DID have open.
        echo "(nothing holds ${MAESTRO_DRIVER_PORT} now — the occupant released it before this ran)"
        printf '%s\n' "$table" | head -30
    fi
    echo "--- surviving maestro processes/packages ---"
    adb shell ps -A 2>/dev/null | grep -i maestro || echo "(none)"
    adb shell pm list packages 2>/dev/null | grep -i maestro || echo "(none installed)"
    echo "--- device ephemeral range (the pool the pinned port must sit outside) ---"
    adb shell cat /proc/sys/net/ipv4/ip_local_port_range 2>/dev/null || echo "(unavailable)"
    echo "--- end port diagnostics ---"
}

# maestro_run_flows
#
# Install the app, prepare the device, resolve which flows THIS runner runs (selection → platform → shard),
# then run each against a freshly reset database. Returns non-zero if any flow (or any reseed) failed.
#
# @sideEffect Drives the device, mutates the recipe database, calls Clerk, and runs Maestro.
maestro_run_flows() {
    local platform
    if ! platform=$(maestro_platform); then
        echo "::error::unknown MAESTRO_PLATFORM '${MAESTRO_PLATFORM:-}' — refusing to guess which device to drive"

        return 1
    fi

    maestro_require_device "$platform" || return 1
    maestro_prepare_device "$platform" || return 1

    # ⛔ THE FIXTURE MANIFEST MUST ALREADY EXIST. `e2e-seed provision` runs as its OWN job step, before the
    # emulator — it only talks to Clerk and the recipe service over HTTP, so it needs no device, and failing
    # there reports "provisioning failed" instead of "the emulator script failed". It is deliberately once
    # per run and never per flow: FAPI sign-in is per-IP rate limited, and thirty-five sign-ins from one
    # runner trips a multi-minute cool-down in the middle of a fifty-minute job.
    #
    # Refused here rather than tolerated: with no manifest every `${E2E_…}` in every flow would render as
    # its own literal text, and thirty-four flows would fail looking like app defects.
    if [ ! -s "$MAESTRO_FIXTURE_ENV_FILE" ]; then
        echo "::error::no fixture manifest at ${MAESTRO_FIXTURE_ENV_FILE} — \`e2e-seed provision\` must run first"

        return 1
    fi

    # `MAESTRO_FLOW_SELECTOR` is `<name>=<bool>` pairs (see maestro_select_flows). Unset/empty is the
    # fail-safe full run, so `read -a` on an empty string yielding an empty array is a correct default. The
    # `${pairs[@]+…}` guard keeps `set -u` happy for that empty case WITHOUT passing an empty argument, which
    # the selector would (rightly) report as a malformed pair.
    local pairs=()
    read -r -a pairs <<<"${MAESTRO_FLOW_SELECTOR:-}"

    # ── THIS RUNNER'S part of the suite: select → filter for the platform → partition for the shard ────────
    #
    # `MAESTRO_SHARD_INDEX`/`MAESTRO_SHARD_COUNT` default to 1/1, so an unsharded invocation runs the
    # selection unchanged. ANY refusal is a HARD failure, never a narrowed run: `_ci-heavy.yml` computes the
    # matrix from the same `shard-matrix` subcommand (for the same platform), so a coordinate this rejects
    # means the two disagree — and a job that then ran "some flows" would report a green shard over an unknown
    # subset. `maestro_shard_selection`'s stderr names the stage that refused.
    local verdict
    if ! verdict=$(maestro_shard_selection "$platform" "${MAESTRO_SHARD_INDEX:-1}" "${MAESTRO_SHARD_COUNT:-1}" \
        ${pairs[@]+"${pairs[@]}"}); then
        echo "::error::maestro could not decide which flows ${platform} shard ${MAESTRO_SHARD_INDEX:-1}/${MAESTRO_SHARD_COUNT:-1} runs — refusing to run an unknown subset of the suite"

        return 1
    fi

    echo "::notice::maestro flows — $(printf '%s\n' "$verdict" | sed -n 's/^selection-reason=//p')"
    echo "::notice::maestro shard — $(printf '%s\n' "$verdict" | sed -n 's/^shard-reason=//p')"

    local flows skipped deferred excluded row
    flows=$(printf '%s\n' "$verdict" | sed -n 's/^flow=//p' | tr '\n' ' ')
    skipped=$(printf '%s\n' "$verdict" | sed -n 's/^skipped=//p' | tr '\n' ' ')
    deferred=$(printf '%s\n' "$verdict" | sed -n 's/^deferred=//p' | tr '\n' ' ')
    excluded=$(printf '%s\n' "$verdict" | sed -n 's/^excluded=//p' | tr '\n' ' ')

    # A runner that runs nothing must be a RED job, not a green one. Unreachable through the pure functions
    # (every fallback widens, and the composition refuses an empty filter), so this is the post-condition
    # that keeps it that way if that ever changes.
    if [ -z "${flows//[[:space:]]/}" ]; then
        echo '::error::this maestro shard holds NO flows — that is a broken selector or matrix, not a passing test run'

        return 1
    fi

    # Say out loud what did NOT run here, and why. A narrowed run, a shard and a platform's subset must never
    # read like a complete suite.
    if [ -n "${skipped//[[:space:]]/}" ]; then
        echo "skipped by selection: ${skipped% }"
    fi
    if [ -n "${excluded//[[:space:]]/}" ]; then
        while IFS= read -r row; do
            [ -n "$row" ] || continue
            case " ${excluded} " in
                *" ${row%%|*} "*) echo "::notice::excluded on ${platform}: ${row%%|*} [$(printf '%s' "${row#*|}" | cut -d'|' -f1)] — ${row#*|*|}" ;;
            esac
        done < <(maestro_platform_exclusions "$platform")
    fi
    if [ -n "${deferred//[[:space:]]/}" ]; then
        echo "deferred to other shards: ${deferred% }"
    fi

    # Unquoted on purpose: `flows` is a space-separated list.
    # shellcheck disable=SC2086
    maestro_run_flow_list $flows
}

# maestro_sandbox_is_down
#
# Exit 0 ONLY when the probe named by MAESTRO_SANDBOX_STOPPED answers `stopped=true`. Exit 1 for everything else: a
# sandbox not proven stopped (including one that is up but unhealthy, which stays a RED), no probe configured (local runs and the `run-one` seam keep today's behaviour byte for byte), a
# probe that errored, and a probe that printed no verdict. UNKNOWN is never DOWN - a red is only converted into a
# skip on positive proof of absence, so a broken probe can hide nothing.
#
# The command is `.github/scripts/deployedSandboxLiveness.sh stopped …` in CI, the one authority for the question. It
# reads the STOP's own facts (the shared tier stopped, or this stage's stacks reclaimed), confirmed twice, and never
# health: a crash, a 503 or a redeploy the flow may have caused is not absence. The LAST `stopped=` line is the verdict.
#
# @sideEffect Runs the probe command (AWS reads and HTTP health requests in CI) and echoes its output.
maestro_sandbox_is_down() {
    [ -n "${MAESTRO_SANDBOX_STOPPED:-}" ] || return 1

    local out probe_rc=0 verdict
    out=$(bash -c "$MAESTRO_SANDBOX_STOPPED" 2>&1) || probe_rc=$?
    printf '%s\n' "$out"
    verdict=$(printf '%s\n' "$out" | sed -n 's/^stopped=//p' | tail -1)

    if [ "$probe_rc" -ne 0 ] || { [ "$verdict" != 'true' ] && [ "$verdict" != 'false' ]; }; then
        echo "::warning::the sandbox liveness probe gave no verdict (exit ${probe_rc}) - treating it as UNKNOWN and keeping the failure"

        return 1
    fi

    [ "$verdict" = 'true' ]
}

# maestro_announce_sandbox_stopped <what failed into the outage> <flows not run, space separated>
#
# The notice a shard prints in place of a failure when the sandbox stopped under it. A skip claims nothing: it is
# not a pass, and it names what was not driven so no reader mistakes it for coverage.
#
# @sideEffect Prints a `::notice::` annotation.
maestro_announce_sandbox_stopped() {
    echo "::notice::the sandbox stopped mid-shard (the stop probe now confirms it) - $1. Not run: $2. This is absence, not an app defect, so it is a SKIP and not a failure; failures recorded earlier, while the sandbox still answered, stand."
}

# maestro_seed_reset <mode>
#
# Reset the shard's seeded world before one flow (`e2e-seed reset --mode <mode>`: `seeded`, `empty` or `ambiguity`). The
# ONE place this script runs Node: it goes through `packages/tools/e2e-seed/runCli.sh`, which runs the bundle CI built
# when `E2E_SEED_CLI_DIR` is set (a Maestro shard installs no `node_modules`) and the source through `tsx` when it is not
# (a developer's machine). `maestroSeedCli.test.ts` holds that this is the script's only call to it.
#
# @sideEffect Reconciles the signer's library on the deployed stage through the recipe, food and identity APIs.
maestro_seed_reset() {
    bash packages/tools/e2e-seed/runCli.sh packages/tools/e2e-seed/src/reset.ts --mode "$1"
}

# True when a `maestro test` output file shows the iOS XCUITest driver NEVER STARTED, so no flow step ran. Pure: reads
# the one file it is given, prints nothing, answers by exit status (0 = never started).
#
# CI run 39376194588, iOS shard 4: the first flow (`auth/loginFlow`) died with
# `xcuitest.installer.LocalXCTestInstaller$IOSDriverTimeoutException: iOS driver not ready in time` after 5.7 minutes,
# before ANY step ran, and every later flow on the shard passed. That red says nothing about the app, so the loop
# retries it once. Both the exception class and its message are matched: either alone survives a reword of the other.
#
# @param $1 - The file holding the flow's combined stdout and stderr.
maestro_driver_never_started() {
    [ -r "${1-}" ] && grep -Eq 'IOSDriverTimeoutException|iOS driver not ready in time' "$1"
}

# Run each named flow through the full per-flow lifecycle.
#
# Split out of `maestro_run_flows` so the `run-one` subcommand — and therefore
# `tests/maestroDriverLifecycle.integration.test.ts` — exercises the SAME body CI runs, rather than a
# reimplementation that could drift away from it silently.
#
# @sideEffect Resets the driver, reseeds the database, runs Maestro, and dumps diagnostics on failure.
maestro_run_flow_list() {
    local rc=0 f reseed_mode flows="$*" platform app_id driver_args=() flow_log flow_rc

    if ! platform=$(maestro_platform); then
        echo "::error::unknown MAESTRO_PLATFORM '${MAESTRO_PLATFORM:-}' — refusing to guess which device to drive"

        return 1
    fi

    maestro_require_device "$platform" || return 1

    # Which device `maestro` drives. EMPTY on Android, so its argv is byte-identical to what it has always been
    # (and a caller's `maestro` shadow still decides the serial); the iOS Simulator is named, never inferred.
    local device_args=()
    if [ "$platform" = 'ios' ]; then
        device_args=(--device "$MAESTRO_IOS_UDID")
    fi

    # ⛔ iOS ONLY: whether the XCUITest runner the last flow left is safe to keep. True only when the previous flow's
    # `maestro test` EXITED 0 - a flow that failed, was skipped (its world could not be reset, or it had no erasure
    # subject) or does not exist yet (the first flow) leaves it unproven. It is set to 0 for every flow BEFORE the flow can
    # fail and back to 1 only on a pass, so no skip path can leave a stale 1 behind.
    local driver_trusted=0 runner_before='first flow of the run'

    # The flows not yet started, space-padded so one name is removed whole. `not_run` is this flow and every one
    # after it — what a stopped shard names as never driven.
    local pending=" ${flows} " not_run

    for f in $flows; do
        not_run="${pending}"
        pending="${pending/ ${f} / }"
        echo "::group::maestro flow ${f}"
        echo "driver port ${MAESTRO_DRIVER_PORT} (pinned below the ephemeral range) for flow ${f}"
        # ${driver_args[@]+…}: an EMPTY array is an unbound variable under `set -u` on bash 3.2 (macOS's system bash).
        driver_args=()
        if [ "$platform" = 'ios' ] && [ "$driver_trusted" -eq 1 ]; then
            echo "iOS XCUITest runner: kept (the previous flow passed) before ${f}"
            driver_args=(--no-reinstall-driver)
        else
            if [ "$platform" = 'ios' ]; then
                echo "iOS XCUITest runner: reset (${runner_before}) before ${f}"
            fi
            maestro_reset_driver
        fi
        driver_trusted=0
        runner_before='the previous flow did not pass'
        maestro_scope_device_log # so a failing flow's dump is scoped to just this flow
        # ⛔ Before the reset AND before Maestro: an erasing flow with no leased subject is not run at all.
        if ! maestro_erasure_subject_check "$f"; then
            rc=1
            echo "::endgroup::"
            continue
        fi
        case "$EMPTY_LIBRARY_FLOWS" in
            *" ${f} "*) reseed_mode=empty ;;
            *)
                case "$AMBIGUITY_FLOWS" in
                    *" ${f} "*) reseed_mode=ambiguity ;;
                    *) reseed_mode=seeded ;;
                esac
                ;;
        esac
        # ⛔ A FAILED RESET IS NEVER FOLLOWED BY ITS FLOW, and that is the lesson of run 101351873536. Every reset
        # there failed (`ECONNREFUSED 127.0.0.1:5432`) and every flow ran anyway, against whatever state happened to
        # exist — turning ONE root cause into twenty-four reds that each read like an app defect.
        # ⛔ AND IT STOPS THE SHARD. A reset fails for the stage, identity, Clerk or the pool slot, never for the flow
        # it precedes, so the next reset meets the same cause: a later run's signers had no roles, every reset
        # answered `400 INVALID_VISIBILITY`, and skipping flow by flow still reported one red per flow. A FLOW's
        # failure below is that flow's own result and does not stop the loop. `maestroDriverLifecycle.integration.test.ts`
        # holds both directions.
        if ! maestro_seed_reset "$reseed_mode"; then
            # `pending` is single-space padded, so trimming one space from each end leaves the list.
            not_run="${not_run# }"
            not_run="${not_run% }"
            # ⛔ A reset fails for the stage, and the stage can be GONE: the midnight stop lands mid-shard. Only a
            # probe that CONFIRMS it is down turns this into a skip (a notice, never an `::error::` annotation);
            # failures already recorded stay.
            if maestro_sandbox_is_down; then
                echo "e2e-seed reset failed before ${f} - the flow was NOT run"
                maestro_announce_sandbox_stopped "the reset before ${f} failed into it" "$not_run"
                echo "::endgroup::"

                return "$rc"
            fi
            echo "::error::e2e-seed reset failed before ${f} — the flow was NOT run"
            echo "::error::a failed reset is the stage failing, not ${f}, so the next reset would fail the same way — stopping this shard. Not run: ${not_run}"
            echo "::endgroup::"

            return 1
        fi
        maestro_load_fixture_env_args
        app_id=$(maestro_app_id "$platform") || return 1
        # `${a[@]+"${a[@]}"}` rather than a bare `"${a[@]}"`: under `set -u` an EMPTY array is an unbound
        # variable on bash 3.2 (still the system bash on macOS), and the `run-one` seam runs with no
        # manifest. Every element stays individually quoted, so titles keep their spaces.
        # The output is teed to a file so the decision below can read it; maestro's status is PIPESTATUS[0], not tee's.
        flow_log="$(mktemp)"
        maestro ${device_args[@]+"${device_args[@]}"} test ${driver_args[@]+"${driver_args[@]}"} ${MAESTRO_FIXTURE_ENV_ARGS[@]+"${MAESTRO_FIXTURE_ENV_ARGS[@]}"} -e "APP_ID=${app_id}" --driver-host-port "$MAESTRO_DRIVER_PORT" "packages/apps/commise/mobile/.maestro/${f}.yaml" 2>&1 | tee "$flow_log"
        flow_rc=${PIPESTATUS[0]}
        # ⛔ iOS ONLY, ONCE: a driver that never started ran no step, so the flow is retried on a freshly reset driver. The
        # world is NOT reseeded (nothing ran to dirty it). Any other failure, and every Android failure, is the flow's result.
        if [ "$flow_rc" -ne 0 ] && [ "$platform" = 'ios' ] && maestro_driver_never_started "$flow_log"; then
            echo "::warning::${f}: the iOS driver never started (IOSDriverTimeoutException), so no step ran - resetting the driver and running it once more"
            maestro_reset_driver
            maestro_scope_device_log
            : >"$flow_log"
            maestro ${device_args[@]+"${device_args[@]}"} test ${MAESTRO_FIXTURE_ENV_ARGS[@]+"${MAESTRO_FIXTURE_ENV_ARGS[@]}"} -e "APP_ID=${app_id}" --driver-host-port "$MAESTRO_DRIVER_PORT" "packages/apps/commise/mobile/.maestro/${f}.yaml"
            flow_rc=$?
        fi
        rm -f "$flow_log"
        if [ "$flow_rc" -eq 0 ]; then
            driver_trusted=1
            runner_before='the previous flow passed'
        else
            echo "FLOW FAILED: ${f}"
            maestro_dump_device_log "$f"
            maestro_dump_port_owner
            # ⛔ PER-FLOW ATTRIBUTION. A flow that fails after the sandbox went down failed for absence and is not
            # counted; one that failed while the probe still answered live is its own red, as is every earlier
            # flow's. The probe runs only on a failure, so a passing shard pays nothing.
            if maestro_sandbox_is_down; then
                pending="${pending# }"
                pending="${pending% }"
                maestro_announce_sandbox_stopped "${f} failed after it went down and is not counted" "${pending:-none}"
                echo "::endgroup::"

                return "$rc"
            fi
            rc=1
        fi
        echo "::endgroup::"
    done

    return "$rc"
}

# CLI dispatch — only when executed directly, never when sourced. No arguments is RUN MODE, because that is
# how the emulator-runner invokes this file (`bash runMaestroFlows.sh`, one line, no arguments).
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
        shard)
            shift
            maestro_shard_flows "$FLOW_PLAN" "$@"
            ;;
        shard-plan)
            shift
            maestro_shard_flows "$@"
            ;;
        shard-matrix)
            shift
            maestro_shard_matrix "$@"
            ;;
        shard-selection)
            # The run-mode composition, for the platform in MAESTRO_PLATFORM. Test seam AND the exact path CI
            # runs: `maestro_run_flows` consumes the same function.
            shift
            platform=$(maestro_platform) || exit 2
            maestro_shard_selection "$platform" "$@"
            ;;
        app-id)
            shift
            maestro_app_id "$@"
            ;;
        platform-flows)
            shift
            maestro_platform_flows "$@"
            ;;
        exclusions)
            shift
            maestro_platform_exclusions "$@"
            ;;
        platforms)
            # shellcheck disable=SC2086
            printf '%s\n' $MAESTRO_PLATFORMS
            ;;
        max-shards)
            printf '%s\n' "$MAESTRO_MAX_SHARDS"
            ;;
        runner-ceiling)
            shift
            maestro_runner_ceiling "$@"
            ;;
        erasure-shard)
            printf '%s\n' "$MAESTRO_ERASURE_SHARD"
            ;;
        erasing-flows)
            # shellcheck disable=SC2086 # one flow name per word
            printf '%s\n' $MAESTRO_ERASING_FLOWS
            ;;
        erasure-subject)
            shift
            maestro_erasure_subject_check "$@"
            ;;
        weights)
            # `<flow>=<seconds>` for the platform's measured rows (Android when none is named).
            maestro_seconds_rows "${2:-android}" | awk -F '\t' '$1 != "*" { print $1 "=" $2 }'
            ;;
        default-weight)
            maestro_default_weight "${2:-android}"
            ;;
        flow-cost)
            shift
            maestro_flow_cost "$@"
            ;;
        driver-port)
            printf '%s\n' "$MAESTRO_DRIVER_PORT"
            ;;
        run-one)
            # ONE flow through the REAL loop, so the lifecycle test exercises the code CI runs rather than a
            # reimplementation of it. Not used by CI itself.
            shift
            maestro_run_flow_list "$@"
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
            echo "usage: runMaestroFlows.sh [select|select-plan|shard|shard-plan|shard-matrix|shard-selection|platform-flows|exclusions|plan|verticals|platforms|max-shards|runner-ceiling|erasure-shard|erasing-flows|erasure-subject|weights|default-weight|flow-cost|driver-port|run-one] …" >&2
            exit 2
            ;;
    esac
fi
