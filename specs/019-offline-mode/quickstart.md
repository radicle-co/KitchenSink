# Quickstart: Validating Offline Mode (019)

This guide proves the feature end to end. It names the tests by tier. Contracts and formats are in `contracts/` and
`data-model.md`.

## Prerequisites

- Node from `$HOME/.nvm/versions/node/v24.20.0/bin`.
- For device runs: the Android SDK in `~/android-sdk` and the Mac lanes for iOS (see the Maestro memory notes). Each
  SC-002 run uses a fresh emulator or simulator.
- A sandbox that is up, started by hand with Sandbox Up, for DEPLOYED Playwright and Maestro runs.

## 1. Unit and integration tiers (CI)

```bash
npm run test --workspace=packages/apps/commise/features/account   # deriveAuthState, the held state
npm run test --workspace=packages/apps/commise/query              # triggers, send gate, read-cache adapter
npm run test --workspace=packages/shared/sync                     # removeMember, save-as-new mutation
npm run test --workspace=packages/apps/commise/mobile             # AuthGate render map, pointer adapter
```

Expected:

- the held state renders the app over local data, and no token is asked for in `held`
- a parked `401` drains on the move to `authenticated`
- a wipe removes only the cook's prefix

## 2. Web offline (Playwright)

Run against a preview with the sandbox up. The browser context goes offline with `context.setOffline(true)`.

- Load the app once online, close the page, go offline and open it again: the shell opens to the recipes.
- Edit a recipe offline, close the browser, reopen it offline: the change is still there and still not synced.
- Open two tabs offline, edit in one, then reconnect: the change reaches the server once.

- Edit a recipe offline: the item shows "not synced", and the notice counts one change.
- Go online: the mark clears within SC-004's 30 seconds.
- An action that needs the network shows its notice before it starts.

## 3. Mobile offline start (Maestro)

- `offline/offlineSurvivesRestart.yaml`: start offline, make a change, restart offline, reconnect. Expected: the app
  opens to the recipes, the change shows as not synced, and after reconnecting it syncs.
- `offline/signOutWhileOffline.yaml` (ADR-0068): unchanged, still passes.
- New flows for "This recipe needs the network" and "Signing in needs the network".

## 4. The exit gate (SC-001 to SC-003)

1. **SC-001**: run the instrumented reconnect (research R2) and record what the token call returns after the network
   returns, on both mobile platforms and on web. Write the named cause, with the evidence, into the ADR that amends ADR-0069.
2. **SC-002**: run `offline/offlineSurvivesRestart.yaml` 10 times in a row on Android and 10 on iOS, each on a fresh
   device, and the matching Playwright test 10 times in a fresh browser profile, on the build that ships. All 30 runs
   must sync the change.
3. **SC-003**: read the shipped `@clerk/expo` source and record that the load path the gate depends on is present and
   supported in that exact version.

## 5. Sign-out and data on the device

Sign in, use the app offline, reconnect, sync, then sign out. Start the app with no network. Expected: the sign-in
screen, and none of the previous cook's recipes, drafts or photos (SC-008).
