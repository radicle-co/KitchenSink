# 0068 — Sign-out refuses while the device is offline

- **Status:** Accepted
- **Date:** 2026-10-23
- **Relates to:** [ADR-0009](0009-clerk-signout-load-gate.md): sign-out still goes through one command that proves the
  session ended, and that command gains a precondition.

## Context

On Android, signing out with no network left the app on the sign-in gate's "Checking your session…" instead of the
localized failure. The gate (`AuthGate.tsx`) shows that while Clerk is not loaded. Clerk dropped into that state while
its sign-out call waited for a network that was not there. The app built before this change did the same.

On reconnect the app returned to Home, still signed in. The session stayed active at Clerk, measured through Clerk's
backend API on the test signer before and after the same Android run. So the attempt never claimed a sign-out that did
not happen, which is the defect ADR-0009 guards against. But the cook saw a spinner and no message.

## Decision

1. **The shared sign-out command refuses while the device is offline**, before it asks Clerk. `signOutAndVerify` takes a
   required `isOnline` in its third argument, beside `endDeviceSession`, so no caller can leave it out.
2. **Both platform adapters pass TanStack's `onlineManager.isOnline`**, the app's one connection signal: NetInfo on
   mobile (`installOnlineManager`), the browser's online events on web. Each caller shows its existing localized
   failure, "We couldn’t sign you out. Try again.", under the offline notice the app already shows.
3. **Proof by tier.** The command's unit test proves an offline refusal never reaches `signOut` or the device state.
   The two adapters' tests prove each platform passes the signal. `offline/signOutWhileOffline.yaml` proves it on an
   Android device: offline, the failure shows and the cook stays signed in, and back online the same control signs out.

## Consequences

- **A device that reports a connection but has no internet passes the precondition.** Clerk then shows the spinner until
  the network truly returns, and the cook lands on Home, still signed in, with no message.
- **The connection signal lags the radio** by up to a few seconds after a reconnect, so a tap in that window is refused
  once more. The cook sees the failure and taps again.
- **The failure copy is not specific to being offline.** The offline notice above it says why.
