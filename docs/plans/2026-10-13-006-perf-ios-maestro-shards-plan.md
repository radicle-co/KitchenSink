---
title: 'perf: cut the fixed cost of each iOS Maestro flow'
type: perf
date: 2026-10-13
---

# Faster iOS Maestro shards

## Owner ruling (2026-10-13)

Work on iOS speed now, not later.

## Measurement

The numbers come from the iOS and Android shard logs of runs 38433716728 and 38447859313. Per-flow times use only the
flows that passed (20 iOS, 17 Android).

- An iOS shard takes 2702 to 3758 s. The slowest shard sets the wall time: 59 min in one run and 63 min in the other.
- Setup takes 486 to 565 s on six of eight shards. About 211 s of that is `setup-node`, about 221 s is `npm ci`, and
  about 130 s is everything else. Two shards took 1156 s and 1594 s, and their unrelated steps were also slow, so
  those were slow hosts.
- The flow's own steps take the same time on both platforms. The gap is fixed cost: about 86 s per flow on iOS against
  about 23 s on Android.

| Part of one flow (median s)                   | iOS  | Android |
| --------------------------------------------- | ---- | ------- |
| Before Maestro starts (driver stop, DB reset) | 5.6  | 2.5     |
| Maestro start until "Running on"              | 46.8 | 7.4     |
| Sign-in section                               | 23.6 | 11.8    |
| After the last step                           | 10.1 | 1.2     |

- Of the 46.8 s, about 9 s is the Maestro JVM start. A median of 34.9 s (range 23 to 72 s) is Maestro restarting the
  XCUITest runner through `xcodebuild test-without-building`.
- `maestro_reset_driver` in `runMaestroFlows.sh` terminates and uninstalls the runner before every flow, so the restart
  happens every time. The app relaunch is only about 10 s.
- `auth/loginFlow` runs on every shard and costs 258 to 350 s on iOS, against 106 s on Android. The first flow also
  pays a cold Simulator launch and a slower driver start.
- The early Simulator start does not slow setup. The boot finishes long before it is needed ("Wait for boot" is 4 to
  11 s). Keep it.
- The npm cache restore in `setup-node` downloads 616 MB at 3 to 5 MB/s and takes 122 to 350 s. `npm ci` still takes
  3 to 4 min after it.

## Cuts, in order

1. Set `package-manager-cache: false` on the iOS job's `setup-node`. The expected saving is about 200 s per shard.
   Measure `npm ci` without the cache in the same change, because it was not timed.
2. Keep the XCUITest runner across flows. Skip the terminate and uninstall unless the previous flow failed, and pass
   `--no-reinstall-driver` (present in Maestro 2.6.1). The expected saving is 400 to 600 s per shard. Prove it with a
   one-shard comparison first. The risk is a runner left broken by a crashed flow, which the failure rule covers.
3. Balance the iOS shards by cost. The Android weights do not count the extra 65 s an iOS flow costs, so shards range
   from 2103 to 2935 s. The expected saving is 170 to 260 s off the slowest shard, with no isolation risk.
4. Fold the AutoFill shutdown and reboot into the early boot step, so it leaves the critical path. The estimate is 30
   to 90 s and is not timed.
5. Small items: cache the pinned Maestro CLI (10 to 20 s), set `MAESTRO_CLI_NO_ANALYTICS=1`, and look at the 21 to
   60 s "Complete job" step.

Two cuts are not recommended, because they weaken test isolation. One `maestro test` call over several read-only
flows loses the database reset between flows. `launchApp` with `stopApp: false` leaves the app's cache stale after the
reset.
Running `auth/loginFlow` on one shard only saves 260 to 350 s on three shards, but it drops the per-lane sign-in check.
It needs an owner decision.

## Files

`.github/workflows/_ci-heavy.yml` (the iOS job), `packages/apps/commise/mobile/scripts/runMaestroFlows.sh`, and the
guards that read them: `packages/infra/global/__tests__/maestroIosTier.test.ts` and the other Maestro guard suites.
Each change gets its guard first.

## Proof

A CI run with the iOS shards, compared shard by shard with run 38447859313. A cut whose saving does not show in the
logs is reverted.
