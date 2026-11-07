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
   users. Adding a lane is an owner step with `poolAdmin`.
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
request. Both identity caps equal the number of lanes whose signer and co-author exist, because a lane signs in once.
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

### 5. Android lanes use the app with the bundle inside

`buildTestApp.sh android` builds a release APK with the JavaScript bundle and the `EXPO_PUBLIC_*` values inside it.
Turbo caches it by content. This removes the Metro launch race, the debug-only Tamagui toast, and N Metro servers.
It is the same kind of binary that CI and iOS use. The local build points at the loopback origins on ports 3000 to
3002 and at the sandbox publishable key. `buildTestApp.sh verify-manifest` checks this.

One open question is whether a release build reaches `http://localhost:3000` through `adb reverse`, because Android
blocks cleartext traffic in release builds by default. A spike on one emulator answers it. If the answer is no, the
test-app build alone allows cleartext to the loopback host. A shipping profile never does.

The Metro and debug path stays for one job: `local:maestro -- flows <flow>` on one lane, the edit and rerun loop.

### 6. iOS lanes run the runner on WSL and the devices on the Mac

The runner needs the local database for resets, so it runs on WSL. Only the device commands go to the Mac over ssh.
The host comes from `LOCAL_MAESTRO_IOS_HOST`. With none set, the iOS door refuses.

- A shim named `maestro` and a shim named `xcrun` sit first on `PATH`. They forward every argument with `printf %q`
  because manifest values hold spaces. They rewrite the flow path to the Mac's synced tree. They never read a
  manifest on the Mac.
- A script on the Mac creates or reuses a simulator named `ks-maestro-lane-<k>`, boots it, erases it and installs the
  app. It also reports the Mac's CPU and memory, read with `sysctl` and `vm_stat`.
- The run opens one ssh connection that all lanes share, and one reverse tunnel for ports 3000 to 3002.
- The orchestrator computes the content key of the test app on WSL and looks for that key on the Mac. A missing or
  different key is refused with the build command. A stale app is never driven.
- iOS lanes provision as `--platform ios --shard k`. The old workaround that set `MAESTRO_PLATFORM=android` is removed.
- The most lanes on the Mac is 5, by the owner's ruling.

## Alternatives rejected

- **Run each lane's services itself.** N queue consumers on one queue repeat the adoption defect.
- **Let the orchestrator pack flows.** Two packers for one fact drift apart.
- **Create lane users during the run.** Clerk seats are limited, and a failed run leaves users behind. Adding a lane
  stays a visible owner step.
- **Skip the role flows to avoid the lock.** A skip looks like a pass.

## Consequences

- A full run takes about the old time divided by the lane count, until the Clerk seats or the machine cap it.
- The first lanes need an owner step. The suggestion is Android lanes 2 to 4 and iOS lanes 1 to 3, which uses 12 of
  the 16 free seats and keeps 4 for erasure and the downgraded owner.
- A crash leaves a lock file. The next run reclaims it if the process is dead.

## Residual risk

- The cleartext spike and the CPU and memory cost of one emulator are not measured yet. The lane cost constants are
  placeholders until the first device run.
- Two orchestrators on two machines share one Clerk tenant and one sandbox. The host lock covers only one machine.
- The simulator count on the Mac is bound by the owner's ruling and not by a measurement.
