# Contract: The sign-in gates

Owners: `mobile/src/components/AuthGate.tsx` on mobile, and the signed-in layout's gate on web. Pattern: Visitor, as an exhaustive switch over `AuthState`.

**Status**: depends on spec OQ-1. Web needs the `held` state under every option. Mobile needs it only if OQ-1 does
not choose Clerk's cache.

| State             | Renders                                                      |
| ----------------- | ------------------------------------------------------------ |
| `loading`         | The waiting screen, "Checking your session…" (unchanged).    |
| `held`            | NEW. The app, over local data only, with the offline notice. |
| `authenticated`   | The app (unchanged).                                         |
| `unauthenticated` | The sign-in surfaces (unchanged).                            |
| `blocked`         | The blocked notice (unchanged).                              |
| `error`           | The error notice (unchanged).                                |

## Rules

- In `held`, every query reads the read cache and the outbox projection. No request goes to the network for data,
  and no token is asked for.
- In `held` with the device online, the app shows the offline notice's reconnecting copy until Clerk loads.
- A held cook with no admissible pointer is not held. The app shows `loading`, and offline it adds the copy "Signing in
  needs the network" (FR-027).
- Both gates follow this table. On web, the service-worker shell renders the gate, so it runs with no server and no
  middleware.
