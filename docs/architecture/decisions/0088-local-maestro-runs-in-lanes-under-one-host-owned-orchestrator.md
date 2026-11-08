# 0088: Local Maestro runs in lanes under one host-owned orchestrator

- **Status**: Accepted
- **Date**: 2026-11-07
- **Drivers**: The owner's law of 2026-11-06 says tests run at the most parallelism the machine allows. A full Android
  Maestro run took about 2 h 50 min on one emulator. A full iOS run took about 2 h 40 min on one simulator, and its
  three slices ran one after another. The Mac at 192.168.50.46 is the permanent iOS host and can run up to 5 simulators.
  The Android host is WSL, which has 20 CPUs.
- **Relates to**:
  [ADR-0086](0086-local-end-to-end-runs-select-by-impact.md) chooses which flows run. This record decides how the chosen
  flows run in parallel on a developer's machine.
  [ADR-0087](0087-ci-end-to-end-runs-select-by-impact.md) uses the same runner contract in CI.
  `docs/CODING_STANDARDS.md` section 7.1a says a LOCAL suite runs only on a developer's machine. Nothing here changes that.

## Context

The runner `runMaestroFlows.sh` already splits flows across shards. In CI each shard is its own job with its own
emulator. Locally there was one emulator and one shard. Three facts decide how to run many lanes on one machine.

1. **Identity is the real ceiling.** Lane k of a platform is shard k. It signs in as its own signer and co-author.
   `maestroSlotForShard` throws for a lane the pool does not declare. Clerk holds 84 of 100 seats. A lane needs a
   signer and a co-author, so 8 Android lanes and 5 iOS lanes need about 26 seats and 16 are free. A run never creates
   lane users. Adding a lane is an owner step with `poolAdmin`. A run creates exactly one Clerk user, its erasure
   subject (section 3).
2. **The "queued" resets had an ownership cause.** Run B reused the queue consumer that run A started. Run A exited and
   killed the consumer. Run B's purge job then sat in the queue with nothing to read it.
3. **Sign-in happens once per run.** Clerk limits sign-ins per IP, so lanes cannot all start at the same second.

## Decision

### 1. One orchestrator, in TypeScript, in `@kitchensink/local-sandbox`

That package already owns the local Maestro door, the queue consumers and the TypeScript bins. The orchestrator is a
Facade over one run. Each platform is a Strategy behind a `DeviceAdapter` port with two adapters, Android and iOS. A
Supervisor owns the shared services for their whole life. The lane count comes from the pure function `planLanes`.

The orchestrator never packs flows. The runner keeps its own packer through the new pure subcommand
`runMaestroFlows.sh pack`. Packing therefore has one copy, and the tests execute the real file.

The command is `npm run maestro:lanes --workspace=@kitchensink/local-sandbox`. The root doors are
`test:e2e:android`, `test:e2e:ios` and `test:e2e:mobile`. They call this command with `--platform android`, `ios` and
`both`. `FULL_SUITE=1` selects every flow. `--lanes N` can only lower the count the plan gives.

### 2. The lane count is the smallest of the caps

The caps are the CPUs left over, the free memory, the lanes that have users in Clerk, the work to do, and the caller's
request. A lane's CPU and memory cost is its measured PEAK, not its mean. On 2026-11-07 four Android lanes averaged 2.7
CPUs each. Load still peaked at 58.5 on the 20-CPU WSL host, and 9 of 70 flows ran out of their scroll budgets. One lane
alone peaked at 5.7, so an Android lane costs 5.5 CPUs and 5.5 GiB (`ANDROID_LANE_COST`). That plans 3 lanes on this
host, and at 3 lanes 69 of 70 flows passed. Both identity caps equal the number of lanes whose signer and co-author exist, because a lane signs in once.
Zero flows start no device and exit 0. The orchestrator reads the lanes that exist with
`poolAdmin --list-local-lanes`, which writes nothing.

### 3. One host owns the shared services, and nothing adopts another's

- The orchestrator takes a lock file that holds its process id. A second orchestrator is refused and told the holder's
  id. A lock whose process is dead is reclaimed.
- If a queue consumer or a parse worker is already running and this orchestrator did not start it, the run refuses and
  names the process. Using a process you do not own is the defect that caused the queued resets.
- A lane process is the runner's run mode. It starts nothing shared and kills nothing shared.
- Pool resets run one lane after another before any lane starts. They run again once every lane is done, while
  the services are still up. Only then do the services stop.
- Resets between flows stay parallel. They are scoped to the lane's signer.
- Two flows write as the shared role users, `recipes/makePublicConfirm` and `recipes/paidFeaturesByRole`. The runner
  takes `flock` on a lock in `MAESTRO_LOCK_DIR` for them, and the packer puts them on lane 1. The lock is host-wide,
  so it also covers a run on the other platform. Role flows are served, never skipped.
- A run creates exactly one Clerk user: the erasure subject of its platform. The erasure flow deletes its own user, and
  nothing local deletes an erased user from Clerk, so each run needs a fresh one. `runUsers.ts` makes it before any lane
  starts and records its id in `runUsers.<platform>.json` the moment Clerk returns it. The run always ends by deleting
  that recorded id and no other, even after a failure. If the user no longer holds the recorded address, the run deletes
  nothing. It never deletes by address or by pattern. When a run starts, it first deletes any id that a crashed run
  recorded. A subject that stands but is not recorded is refused, never adopted.

### 4. The runner contract is the same locally and in CI

The runner reads these variables: `MAESTRO_PLATFORM`, `MAESTRO_FLOW_SELECTOR`, `MAESTRO_SHARD_INDEX`,
`MAESTRO_SHARD_COUNT`, `COMMISE_E2E_SHARD`, `MAESTRO_DRIVER_PORT`, `ANDROID_SERIAL`, `MAESTRO_IOS_UDID`,
`MAESTRO_ANDROID_APK` and `MAESTRO_FIXTURE_ENV_FILE`. Locally it also reads `MAESTRO_LOCAL`, `MAESTRO_LOCK_DIR` and
`MAESTRO_SKIP_INSTALL`.

- `COMMISE_E2E_SHARD` equals `MAESTRO_SHARD_INDEX`, and a mismatch is refused.
- The driver port is `7000 + k`. Each lane is its own process, so a fixed port per lane is safe.
- Android serials are a literal table, 5556 to 5570 in steps of two. The serial 5554 is refused.
- A `flow:<id>=true` selector key selects exactly that flow plus the spine. Keys of different kinds join. An unknown
  flow runs the full set and says so. An empty selector means the full set.

### 5. Android lanes use the app with the bundle inside, and run on the Mac

`buildTestApp.sh android` builds a release APK with the JavaScript bundle and the `EXPO_PUBLIC_*` values inside it.
Turbo caches it by content. This removes the Metro launch race, the debug-only Tamagui toast, and N Metro servers.
It is the same kind of binary that CI and iOS use. The local build points at the loopback origins on ports 3000 to
3002 and at the sandbox publishable key. `buildTestApp.sh verify-manifest` checks this.

The Metro and debug path stays for one job: `local:maestro -- flows <flow>` on one lane, the edit and rerun loop.

**Where the emulators run.** Nested Android emulators on WSL crashed Windows twice (a hypervisor bugcheck, 2026-11-08),
so Android lanes run on the Mac by default (owner direction: "run the android emulator on the mac for now").
`LOCAL_MAESTRO_ANDROID_ON=wsl` opts back in. Bash (`local_maestro_android_host`) and TypeScript (`parseAndroidHost`)
read the variable alike, and `localMaestro.sh`'s one-emulator mode refuses to boot on WSL unless it says `wsl`.

- **One Android adapter, two hosts.** The adapter keeps the content key, the build, the verification, the serial table
  and the boot polling. An `AndroidHost` (a Bridge) does the boot, the install, the stop and the host facts. The local host
  is the WSL x86_64 emulator. The Mac host boots arm64-v8a emulators over ssh. The `DeviceAdapter` port is unchanged.
- **The test app is built on WSL for the host's ABI.** `TEST_APP_ANDROID_ABIS` is exactly one of `x86_64` (the default,
  so CI is unchanged) or `arm64-v8a`. It is a turbo `env` entry of `testApp:android`, so the ABI is part of the content
  key, and the default is left unset in the hash so CI's keys do not move. The content key, the build and
  `verify-manifest` all read the host's ABI.
- **What runs where.** Maestro, adb, the emulators and the logcat reader run on the Mac. The runner, the services, the
  database, the host lock and the run-user record stay on WSL. There is no remote adb server, because Maestro's
  `adb forward` binds on the server's host. An `adb` shim and a `maestro` shim forward every argument with `printf %q`;
  the lane serial travels as the remote variable `ANDROID_SERIAL`, never `-s`.
- **The tunnel.** One `ssh -R` carries the Mac ports back to the WSL services. The recipe service uses Mac port 13000,
  because Docker holds the Mac's own 3000, and the runner's `adb reverse tcp:3000` goes to it
  (`MAESTRO_LOCAL_RECIPE_HOST_PORT`). Identity and food keep ports 3001 and 3002.
- **The lane AVD.** `ks_lane_lean` is created on the Mac from `system-images;android-34;google_apis;arm64-v8a`. Its screen,
  density, cores, RAM and disk are copied from the WSL `ks_lane_lean` config, not restated. Emulators boot cold,
  read-only and headless. The GPU mode is `host`: in a spike on the Mac, 25 Settings launches with swipes used 15.8 CPU
  seconds with `-gpu host` and 57.5 with `swiftshader_indirect`, and both booted in about 19 seconds.
- **Before any boot, the run reaps.** An earlier run's emulator of the lane AVD is killed by its pid file, and only if its
  command line names the AVD, so a recycled pid is never killed.
- **The recorder's streaming logcat** goes through `ssh -tt`, the only call with a terminal, so killing the local
  reader hangs up the Mac process. After a one-lane run no `adb logcat`, `qemu-system` or `emulator` process was left on
  the Mac.
- **Planning.** `--platform both` runs Android then iOS as two turns, never both against the Mac at once (two tunnels on
  the same Mac ports, and both lane 1s on driver port 7001). The exit code is the worse of the two. Until measured, a
  Mac Android lane costs 5.5 CPUs and 5.5 GiB, the WSL peak. `maestro:macUsage android` measures it, and the WSL usage
  watcher is skipped for the Mac host.

### 6. iOS lanes run the runner on WSL and the devices on the Mac

The runner needs the local database for resets, so it runs on WSL. Only the device commands go to the Mac over ssh.
The host comes from `LOCAL_MAESTRO_IOS_HOST` (the name stays for now; Android lanes on the Mac read it too). With none set, the Mac doors refuse. A `MacSession` owns the per-run ssh config, the Mac's HOME, the lane scripts, the flow sync and the one reverse tunnel for both platforms.

- A shim named `maestro` and a shim named `xcrun` sit first on `PATH`. They forward every argument with `printf %q`
  because manifest values hold spaces. They rewrite the flow path to the Mac's synced tree. They never read a
  manifest on the Mac.
- A script on the Mac creates or reuses a simulator named `ks-maestro-lane-<k>`, boots it, erases it and installs the
  app. It also reports the Mac's CPU and memory, read with `sysctl` and `vm_stat`.
- The run opens one ssh connection that all lanes share, and one reverse tunnel for the ports the app was built with
  (13000 to 13002, because Docker holds the Mac's 3000). The ports on the WSL side come from `local_maestro_settings`.
- The orchestrator computes the content key of the test app on WSL and looks for that key on the Mac. A missing or
  different key is refused with the build command. A stale app is never driven.
- iOS lanes provision as `--platform ios --shard k`. The old workaround that set `MAESTRO_PLATFORM=android` is removed.
- The most lanes on the Mac is 5, by the owner's ruling.

## Alternatives rejected

- **Run each lane's services itself.** N queue consumers on one queue repeat the adoption defect.
- **Let the orchestrator pack flows.** Two packers for one fact drift apart.
- **Create lane users during the run.** Clerk seats are limited, and a failed run leaves users behind. Adding a lane
  stays a visible owner step. The erasure subject is the one user a run creates, because its flow deletes it. The
  recorded id is what makes the user safe to create: a run deletes only what it recorded.
- **Skip the role flows to avoid the lock.** A skip looks like a pass.

## Consequences

- A full run takes about the old time divided by the lane count, until the Clerk seats or the machine cap it.
- The first lanes need an owner step. The suggestion is Android lanes 2 to 4 and iOS lanes 1 to 3, which uses 12 of
  the 16 free seats and keeps 4 for erasure and the downgraded owner.
- A crash leaves a lock file. If its process is dead, the next run reclaims it.

## Residual risk

- The WSL Android lane cost is measured on one host (WSL, 20 CPUs, 2026-11-07), and the Mac's is not measured yet: it
  uses the same 5.5 CPUs and 5.5 GiB until `maestro:macUsage android` gives a number. One flow passed on one Mac
  emulator (arm64-v8a, `-gpu host`); no full Android suite has run on the Mac yet. The release test app reached the
  loopback services through `adb reverse` in the WSL runs, so the cleartext question is answered for Android.
- The Mac cannot host two platforms at once, so `--platform both` is slower than two machines would be. The `host` GPU
  was measured with one emulator; several lanes may contend for it, and `LOCAL_MAESTRO_ANDROID_ON=wsl` or
  `KS_ANDROID_GPU=swiftshader_indirect` are the fallbacks.
- Two orchestrators on two machines share one Clerk tenant and one sandbox. The host lock covers only one machine.
- The simulator count on the Mac is bound by the owner's ruling and not by a measurement.
