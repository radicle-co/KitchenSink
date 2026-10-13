---
title: 'perf: cut the deployed Maestro tier from two hours to about forty minutes'
type: perf
date: 2026-10-13
---

# Faster deployed Maestro tier

## Owner rulings (2026-10-13)

- "Do all three": iOS gets its own Clerk pool lanes, each app is built once per platform, and each platform runs four
  shards instead of two.
- "Do 2 and 3": when the inputs of a built app did not change, reuse it. Make rebuilds faster.
- "Do item 1 too": the CI test APK builds only `x86_64`. These builds are test-only (debug keystore, Simulator SDK,
  sandbox origins). A shipping build uses `eas.json`'s `production` profile, which no workflow runs today.
- The owner authorized the coordinator to run `poolAdmin --apply`. DONE 2026-10-13: 12 users created, pool healthy.

## Measured today (run 38322183404)

| Phase               | Android (2 shards)                          | iOS (2 shards)                                                       |
| ------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| Heavy `install`     | 2.9 min, unconditional `npm ci`             | same                                                                 |
| App build per shard | 18.4 / 14.3 min (4 ABIs. Native is 8.5 min) | 17.5 / 26.2 min, after 2-3 min `npm ci` and a 2-3 min Simulator boot |
| Flows               | 46.0 / 35.5 min (stale weight table)        | shard 1: 54.3 min for 23 flows. Median per-flow launch gap 46 s      |
| Wall clock          | 00:10 to 01:18                              | 01:18 to 02:38, queued behind Android by the shared lane             |

The build bakes in four values: `EXPO_PUBLIC_RECIPE_API_URL`, `EXPO_PUBLIC_FOOD_API_URL`,
`EXPO_PUBLIC_IDENTITY_API_URL` (no default, `src/config/env.ts:37-49`) and `EXPO_PUBLIC_IDP_PUBLISHABLE_KEY` (from
`load-secrets`, secret `kitchensink/sandbox/identity/keys`). The Actions cache is at 11.54 GB, above the 10 GB cap.
iOS prebuilt React Native core and precompiled Expo modules are already on by default (RN `react_native_pods.rb:92-93`,
Expo SDK 57).

## Recorded decisions this plan amends (rewrite each in the commit that changes what it governs)

- `.github/workflows/_ci-heavy.yml:608-613` ("the APK build is not hoisted"). Its premise was a build inside the tier.
  The build moves into each door, where it overlaps the deploy (36.6 min on run 38322183404).
- `runMaestroFlows.sh:12-15` ("not Gradle or AVD caching"). Still true for those two. Content-addressed reuse removes
  the whole build on a hit, which is a different lever. Add one sentence saying so.
- `_ci-heavy.yml:1534-1536` ("never DerivedData or the built app"). DerivedData stays refused. A built app is reused
  only on an exact content-key match, which means identical inputs already compiled, so the proof still stands.
- `_ci-heavy.yml:1265-1271` ("the same pool lane as Android"). The owner took the three-part act. Replace the header.
- `testPool.ts:263-281` (the erasure lease contract shared by Android and iOS on lane 1). Each platform's lane 1 now
  excludes only that platform's own erasure set.

Unchanged and binding:

- k6 never runs automatically.
- The sandbox starts only by hand (ADR-0060).
- `maestroStageGuard`'s sandbox-only refusal, the liveness re-probe, and the per-shard reset before and after stay.
- `deployedE2eTiers.yml` is the one caller of the tier.
- The Maestro CLI stays pinned.

## Decisions

| Lever                                                                | Verdict                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS lanes of its own                                                 | IN                                                                                                                                                                                                      |
| Build once per platform, in the door, beside the deploy              | IN                                                                                                                                                                                                      |
| Four shards per platform                                             | IN                                                                                                                                                                                                      |
| `-PreactNativeArchitectures=x86_64`                                  | IN                                                                                                                                                                                                      |
| Reuse the app by content key (artifacts, not cache)                  | IN                                                                                                                                                                                                      |
| Heavy `install` skips `npm ci` on an exact cache hit                 | IN                                                                                                                                                                                                      |
| Start booting the Simulator before `npm ci`                          | IN                                                                                                                                                                                                      |
| Refresh `MAESTRO_FLOW_WEIGHTS` from this run's passing Android flows | IN                                                                                                                                                                                                      |
| Gradle build cache, Android ccache                                   | DECLINED pending owner: after the hoist the Android build is off the critical path, `setup-gradle` is read-only off the default branch, and a 1-2 GB entry evicts `node_modules` from an over-cap cache |
| Xcode DerivedData cache, AVD snapshot cache                          | DECLINED (refused in-file. Boot is 1.3 min)                                                                                                                                                             |
| Fewer iOS per-flow launches (46 s median)                            | DEFERRED: the next lever, needs its own design (bound to the per-flow reset)                                                                                                                            |

## A. Pool lanes per platform (TypeScript, pure)

- `packages/tools/e2e-fixtures/src/testPool.ts`
    - The roster append is ALREADY in the working tree and the users exist: after `coauthor02`, in this order,
      `signer03, coauthor03, signer04, coauthor04, iossigner01, ioscoauthor01, iossigner02, ioscoauthor02, iossigner03,
ioscoauthor03, iossigner04, ioscoauthor04`. Do not reorder.
    - Add `MAESTRO_PLATFORMS = ['android', 'ios'] as const` and `type MaestroPlatform`.
    - Replace `MAESTRO_SHARD_LANES` with `MAESTRO_PLATFORM_LANES: Record<MaestroPlatform, { signer, coauthor, erasure }>`:
      Android signers `[signer, signer02, signer03, signer04]`, co-authors `[coauthor, coauthor02, coauthor03,
coauthor04]`, erasure `erasure01-05`. IOS signers `iossigner01-04`, co-authors `ioscoauthor01-04`, erasure
      `erasure06-10` (existing users, no new erasure users).
    - Signatures: `maestroShardCapacity(platform)`, `maestroSlotForShard(role, platform, shard)`,
      `maestroErasureSlots(platform, shard)`. `MAESTRO_ERASURE_SHARD = 1` stays and means shard 1 of each platform.
    - Must not know about workflows.
- `packages/tools/e2e-seed/src/shard.ts`: `resolveMaestroPlatform(env)` reads `MAESTRO_PLATFORM`. Absent means
  `android` (the runner's own rule, `runMaestroFlows.sh` PLATFORMS). An unknown value throws. Add
  `assertPlatformsAgree(flagged, env)`, mirroring `assertShardsAgree`.
- `packages/tools/e2e-seed/src/sessionState.ts`: `SessionState.platform` is required and parsed strictly, like
  `shard`.
- Thread the platform through `provision.ts` (from env), `resetPool.ts` (`--platform` REQUIRED for `--tier maestro`,
  must agree with env), `testReset.ts` (session platform equals env when set), `poolAdmin.ts`
  (`--maestro-erasure` requires `--platform` and `--shard`), `leaseSession.ts`, and
  `packages/tools/local-sandbox/bin/localMaestro.sh` plus `alignIdentities.ts` (state `android` explicitly).
- `packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh`: `MAESTRO_MAX_SHARDS=4`.
  `APK="${MAESTRO_ANDROID_APK:-<old path>}"` (the old path stays the default for local runs). Refresh the weights.
  rewrite the header at lines 12-15 and the erasure-lane text.

## B. Test-app build

- `packages/apps/commise/mobile/scripts/buildTestApp.sh`, the one home of the build recipe. Move the bodies out of
  `_ci-heavy.yml:1056-1098` (Android) and `:1568-1625` (iOS). Subcommands:
    - `android`: unset the secrets, `expo prebuild`, the `:app:tasks` retry, then `assembleRelease
-PreactNativeArchitectures=x86_64` with ProGuard and resource shrinking off and `SENTRY_DISABLE_AUTO_UPLOAD=true`.
    - `ios`: the same unset list, prebuild, the `pod install` retry, then `xcodebuild -configuration Release -sdk
iphonesimulator -destination 'generic/platform=iOS Simulator' ARCHS=arm64 ONLY_ACTIVE_ARCH=NO`, then `tar -czf`
      the `.app` (upload-artifact drops the executable bit).
    - `content-key <platform>`: `turbo run testApp:<platform> --filter=@commise/mobile --dry=json`, print that task's
      hash. Empty output is an error.
    - `verify-manifest <file> <platform>`: pure. Reads `EXPECT_*` from the env.
    - Output to `dist-testApp/<platform>/{app.apk | app.tar.gz, testApp.manifest}`. Add `dist-testApp/` to
      `.gitignore`.
- `testApp.manifest`: exact `key=value` lines `platform`, `contentKey`, `recipeOrigin`, `foodOrigin`,
  `identityOrigin`, `publishableKeySha256`, `abis` (Android) or `xcodeVersion` (iOS), `builtFromSha`, `builtInRun`.
  Verification refuses a missing, unknown or different key. `builtFromSha` is provenance only and never compared.
- `packages/apps/commise/mobile/package.json`: scripts `testApp:android` and `testApp:ios` (`bash
scripts/buildTestApp.sh <p>`).
- `turbo.json`: add `"transit": { "dependsOn": ["^transit"] }` so dependencies without a build script are in the
  hash.
- `packages/apps/commise/mobile/turbo.json` (new, `extends: ["//"]`): tasks `testApp:android` and `testApp:ios`, each
  `dependsOn: ["^transit"]`, `cache: false`, inputs `["$TURBO_DEFAULT$", "!.maestro/**", "!tests/**",
"!**/__tests__/**", "!android/**", "!ios/**", "!dist/**", "!dist-testApp/**",
"$TURBO_ROOT$/.github/workflows/_mobileAppBuild.yml"]`, env: the three origins, `EXPO_PUBLIC_IDP_PUBLISHABLE_KEY`,
  `TEST_APP_CACHE_EPOCH`, and on iOS `DEVELOPER_DIR`. CI calls the script directly, never through turbo (strict env
  mode will strip `JAVA_HOME` and the SDK paths). If `--dry=json` emits no hash for a `cache: false` task, drop
  `cache: false` and declare `outputs: ["dist-testApp/<p>/**"]`.
- `.github/workflows/_mobileAppBuild.yml` (new). Inputs: `stage` and the three origins. Secrets: the AWS pair.
  Workflow env: `DEVELOPER_DIR` (must equal the iOS shard's literal) and `TEST_APP_CACHE_EPOCH: '1'`. Jobs:
    1. `plan` (`ubuntu-latest`, `contents: read, actions: read`): checkout, `target_scope_assert`, restore
       `node_modules` (fallback `npm ci`), `load-secrets` for sandbox (no AWS credentials: notice, `eligible=false`,
       exit 0), compute both content keys, then for each platform look up `commise-test-app-<p>-<key>` with `gh api
repos/$GITHUB_REPOSITORY/actions/artifacts?name=...`, keeping only unexpired artifacts whose
       `workflow_run.head_repository_id` and `repository_id` equal `$GITHUB_REPOSITORY_ID` (shuts out a fork's
       artifact). On a hit: download it (`actions/download-artifact`, pinned by SHA, `run-id` + `github-token`),
       re-upload into this run under the same name with `overwrite: true`, output `<p>_reused=<name>`.
    2. `android` (`ubuntu-latest`), `needs: plan`, only if eligible and not reused: restore deps and the UI dist,
       `load-secrets`, JDK 17, recompute the key and refuse if it differs from `plan`'s, run `buildTestApp.sh android`,
       upload (`overwrite: true`, `retention-days: 7`). Its last step outputs `artifact=<name>`.
    3. `ios` (`macos-26`): the same shape, starting with the pinned-Xcode check.
       Outputs: `android_test_app: ${{ jobs.plan.outputs.android_reused || jobs.android.outputs.artifact }}`, and the same
       for iOS.

## C. Wiring

- `_ci.yml`: new job `mobile-app-build` ("Build the mobile test apps"), `uses: ./.github/workflows/_mobileAppBuild.yml`,
  `needs: [install, build-ui, sandbox-status, resolve-sandbox]`, `if:` = the `branch == 'run'` test AND the exact
  `contains(labels, 'mobile-e2e')` expression from about line 1254 AND `resolve-sandbox.outputs.stage != ''`.
  `permissions: { contents: read, actions: read }`, and `ci-pr.yml`'s `ci` job adds `actions: read`.
  `deployed-tiers` adds it to `needs`. Its `if:` becomes `!cancelled() && needs.install.result == 'success' &&
needs.build-ui.result == 'success' && needs.resolve-sandbox.result == 'success' &&
needs.detect-mobile-flows.result == 'success' && <branch> && needs.deploy-preview.result == 'success'`, and it passes
  `android_test_app` / `ios_test_app` from the build's outputs. Do NOT gate `deployed-tiers` on the build's result: a
  failed build will then skip every deployed tier, and a skip renders green. The shards' own refusal makes a missing
  app red.
- `deployedE2e.yml`: the same job (`needs: resolve`, only if `live && run_mobile_maestro && target != 'prod'`), same
  grant, same `deployed-tiers` pattern.
- `deployedE2eTiers.yml`: new string inputs `android_test_app` and `ios_test_app` (default `''`), relayed to
  `_ci-heavy.yml`.
- `_ci-heavy.yml`:
    - the same two inputs.
    - `install` fast path: `actions/cache/restore` with `lookup-only: true`. Skip `npm ci` and the save on an exact hit.
    - both Maestro jobs: right after the stage refusal, refuse when the platform's input is empty (message points at
      the build job). Remove the app-build, Gradle, CocoaPods-cache and `turbo build --filter=@commise/mobile^...`
      steps and build `--filter=@kitchensink/e2e-seed^...` instead. After the secrets valve and BEFORE `resetBefore`,
      download the exact name, untar on iOS, and run `buildTestApp.sh verify-manifest` against
      `resolve-mobile-target`'s origins, `sha256(EXPO_PUBLIC_IDP_PUBLISHABLE_KEY)`, the platform, the content key in the
      artifact name, and `xcodebuild -version` on iOS. JDK 17 stays (the Maestro CLI needs it). Every seed, reset and
      refill step binds `MAESTRO_PLATFORM` and passes `--platform`. IOS concurrency becomes
      `test-pool-sandbox-maestro-ios-${{ matrix.shard }}` (Android keeps `test-pool-sandbox-maestro-${{ matrix.shard
}}`, which still excludes old-code runs on other branches). Split the Simulator step into "create and start
      booting" right after the Xcode check and "wait for boot" (`bootstatus -b`) before the run. Timeouts Android 60
      min, iOS 75 min.
    - rewrite the recorded decisions listed above.
- `ci-full.yml`: leave alone.

## Tests to write first (red, then green)

New:

- `packages/infra/global/__tests__/mobileTestAppBuild.test.ts`: (a) every caller that turns Maestro on through
  `deployedE2eTiers` needs a job calling `_mobileAppBuild.yml` and relays its two outputs. (b) the build job's label
  term is the same string as `run_mobile_maestro`'s. (c) `deployed-tiers`' `if:` lists every earlier need as
  `result == 'success'` and never gates on the build. (d) no `_ci-heavy.yml` step runs `gradlew`, `xcodebuild ...
build` or `expo prebuild`. (e) run the refusal step's body with the input empty and set: it refuses when empty, and
  it sits after the stage refusal and before checkout. (f) download and verification sit before `resetBefore`. (g)
  `DEVELOPER_DIR` is the same literal in both files. (h) the iOS upload ships a tarball and every upload sets
  `overwrite: true` and a retention. (i) the `plan` lookup filters on `head_repository_id`.
- `buildTestAppManifest.test.ts`: execute `verify-manifest` over a fixture table: each field mutated, a missing file,
  an unknown key, an exact match.
- `testAppContentKey.test.ts`: read turbo's resolved `--dry=json` (as `turboGlobalHash.test.ts` does): dependencies
  include `@commise/features-recipes#transit`. Inputs include `scripts/buildTestApp.sh` and `_mobileAppBuild.yml` and
  exclude `.maestro/` and `tests/`. Changing each declared env variable changes the hash.
- `testPool.test.ts`: capacity 4 per platform, equal to the shell's max. All 8 lanes disjoint. Erasure sets disjoint
  with union `consumableSlots('maestro')`. Non-erasure shards get none. Android shard 1 is still `signer`/`coauthor`.
  an unknown platform throws.
- `shard.test.ts`, `resetPool` and `poolAdmin` argument parsing, and `sessionState` (missing or invalid `platform`
  throws).

Rewrite: `maestroShardPartition.test.ts` (group literal per platform at about line 557, platform-aware capacity, a
`--platform` binding on every seed and reset step, defaults of 4), `maestroIosTier.test.ts` (build assertions move to
the build workflow and script. `MAESTRO_IOS_APP` comes from the untar step), `androidSdkInstall.test.ts` (reads the
script), `runtimeUserCreation.test.ts:184` (both refill command lines), `testPoolWorkflowWiring.test.ts:287` (also
match `-ios-`), `deployedE2eTiers.test.ts` and its snapshot, `workflowProvenance.test.ts` (the new pinned action),
`depsCacheOrdering.test.ts` (new restore jobs need `install`), `maestroFlowSelection.test.ts` (`APK` override),
`localMaestro.test.ts`, `workflowInvariants.test.ts` (new job names are constants with no E2E claim). Each rewrite
says in its doc comment what new behavior it proves.

## Build order (each phase leaves the tree green. Tests fail first)

1. Lanes per platform (section A plus the workflow `--platform` / `MAESTRO_PLATFORM` bindings and the iOS group
   rename). `MAESTRO_MAX_SHARDS` and the roster move together. Shard defaults stay `'2'`.
2. Build once (section B without reuse: `plan` always reports a miss) plus section C, the shard download and
   verification, and removal of every per-shard build. Rewrite the recorded decisions here.
3. Content reuse: the `plan` lookup and re-upload, and the `actions: read` grants.
4. Cheap wins: heavy `install` fast path, Simulator boot overlap, seed-closure build, timeouts, refreshed weights.
5. Raise `maestro_shards` to `'4'` in `_ci-heavy.yml`, `deployedE2eTiers.yml` and the `deployedE2e.yml` form, together.
   Rollback is setting it back to `2`. Measure on one labelled run: per-shard wall clock, Clerk 429s, recipe-service
   5xx and timeouts, artifact sizes, download time.

## Risks

- Eight devices against one 0.5-vCPU Spot recipe task and the shared micro database (phase 5 measures it).
- Clerk dev instance: 100 users (76 used after this plan), Backend API 100 requests per 10 s across all suites.
- GitHub Free: 5 concurrent macOS jobs. Four iOS shards plus the iOS build is five.
- An old-code Android-1 run on another branch draws from all ten erasure subjects and can collide with a new iOS-1 run
  on `erasure06-10` until those branches pick up the change. It can fail a run, never erase a non-test account.
- Unverified until phase 5: the iOS flow total (shard 2 never ran), artifact sizes, the turbo dry-run hash for a
  `cache: false` task, and an ad-hoc-signed Simulator app built on one Mac keeping keychain access on another.

## Pattern register

- `testPool.ts`: Object Pool partitioned by (platform, shard) lane. A concurrency group is a named mutex per lane.
- `shard.ts`: parse, don't validate. Two channels per fact, checked for agreement.
- turbo `testApp:*`: memoization key. Intent satisfied by turbo's hashing, no hasher of our own.
- `plan` job: cache-aside over content-addressed artifacts.
- `buildTestApp.sh`: Builder (one recipe per platform) plus Specification (`verify-manifest`).
- Shard refusal steps: guard clause. No app means red, never green.
- `shard-matrix`: preserved as the one authority for the shard count.
