# 0069 — An offline cold start waits for Clerk, and Clerk's resource cache stays off

- **Status:** Accepted
- **Date:** 2026-10-24
- **Relates to:** [ADR-0057](0057-editor-device-draft-and-outbox-format.md): the device draft and the outbox keep the
  cook's work across a restart. [ADR-0068](0068-signout-refuses-while-offline.md): sign-out while offline.

## Context

When the mobile app starts with no network, the sign-in gate (`AuthGate.tsx`) shows "Checking your session…" until
Clerk loads. Clerk cannot load without the network, so an offline cold start shows that screen until the network
returns. The cook cannot open a recipe, and cannot see that a change is still waiting to sync.

`@clerk/expo` offers a fix: pass `__experimental_resourceCache` (from `@clerk/expo/resource-cache`) to `ClerkProvider`.
Clerk then starts from its cached state. This was built and measured on Android on 2026-10-23, with a timed copy of
`offline/offlineSurvivesRestart.yaml`:

- **The offline start worked.** The app opened offline, showed the recipe and the pending change, and Clerk logged
  "continuing with cached Clerk state".
- **The reconnect did not.** In about 2 runs of 3, the app stayed stuck after the network returned: no session token,
  "Syncing 1 change…" and Home skeletons, for at least 3 minutes. That happened on `@clerk/expo` 4.6.0 and 4.14.1 alike.
  In both sets of runs, the first run in a lane drained and later runs stuck. The cause is not known. The next step
  was to record what Clerk's `getToken` returns after the reconnect.

The owner rules that offline is a pause. A spinner ends when the network returns. A change left "Syncing" forever
does not end, so it breaks that rule worse. The API is also marked experimental, so it can change in any release.

## Decision

1. **The mobile `ClerkProvider` does not pass `__experimental_resourceCache`.** An offline cold start shows "Checking
   your session…" until the network returns, and then the app loads as normal.
2. **The cook's work stays on the device in that wait.** The outbox and the device draft are stored on the device
   (ADR-0057), so a restart does not erase a queued change. Its send after an offline cold start was not measured in
   this investigation.
3. **The change that turns the resource cache back on must show all three of these, and must amend this ADR:**
    - The cause of the stuck reconnect is named, with evidence.
    - `offline/offlineSurvivesRestart.yaml` passes 10 runs in a row on Android, each in a fresh lane, on the
      `@clerk/expo` version that ships.
    - That version still offers the API, read from its own source, because an experimental API can change in any
      release.

## Consequences

- **An offline cold start shows a spinner, not the app.** The cook cannot read a recipe offline after the app was
  killed. A running app that loses the network keeps working, because Clerk is already loaded.
- **`offline/offlineSurvivesRestart.yaml` cannot pass on the shipped app.** After the offline relaunch it expects the
  "not synced" notice, and the app shows the gate instead. It stays a hand-run flow (`KNOWN_UNRUN_FLOWS` in
  `maestroFlowSelection.test.ts`), and it is the test the second condition above names.
- **Nothing proves on a device that a queued change survives a kill.** That flow is the only device test of it, and the
  gate blocks it. The outbox's persistence is proved by its own unit and integration tests, not on a device.
- **Residual risk:** nobody measured whether the stuck reconnect also hits a cold start with the network on, after a
  long time offline. If it does, it is a Clerk defect outside the resource cache.
