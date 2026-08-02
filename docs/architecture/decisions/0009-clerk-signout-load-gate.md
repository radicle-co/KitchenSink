# 0009 — Sign-out goes through one command that verifies the session actually ended

- Status: Accepted
- Date: 2026-07-27 (mobile half added 2026-07-27)
- Deciders: web, mobile
- Related: [0001](0001-sandbox-front-end-addressing.md)

## Context

The web sign-out did not sign anybody out. Observed end-to-end on `/en/settings`: clicking **Sign out of your
account** navigated the viewer away from settings while their Clerk session stayed **active**, kept minting
fresh JWTs (`iat` advancing on every page load), and `__session` / `__client_uat` were untouched — the trace
below shows the viewer landing on `/en` still rendering the AUTHENTICATED Home surface (whose `<h1>` is
"Welcome to Commise"), because the root's auth gate saw a live session. On a shared device that is an
account-takeover window, and nothing in the flow reported a failure.

The cause is not in Clerk's session handling — it is `useClerk().signOut`. `useClerk()` returns
`IsomorphicClerk` (`@clerk/clerk-react`), whose `signOut` is the **raw** method:

```text
signOut = async (...args) => {
  const callback = () => this.clerkjs?.signOut(...args);
  if (this.clerkjs && this.loaded) { return callback(); }
  else { this.premountMethodCalls.set('signOut', callback); }   // queued — and RESOLVES
};
```

Before clerk-js has finished loading, `await signOut()` **resolves having done nothing**: no revoke request
reaches Clerk's Frontend API. The queued callback would run when clerk-js loads — except the caller's own
full-document navigation to the public entry destroys the page first. So the sequence
`await signOut(); navigateTo('/')` is silently unsafe during the load window.

Instrumented proof, captured at the instant of the click on `/en/settings` (Chromium, Next dev):

```
[state at click]  windowClerk=object  clerkLoaded=false  clerkStatus="loading"
                  client=<undefined>  hasSessionCookie=true
[FAPI after click] <<< NO /api/v1/client/sessions?_method=DELETE — no revoke was ever issued >>>
[after]           url=/en  h1="Welcome to Commise"  __client_uat=1785157346  __session present
```

The same click, taken **after** `Clerk.loaded === true`, issues
`POST /api/v1/client/sessions?_method=DELETE` → `200 {"sessions":[]}`, clears `__session`, sets `__client_uat=0`,
and the Backend API reports the session `status=removed`. Sign-out itself works — what was missing was waiting
for Clerk to load, and checking that the sign-out had actually taken effect before telling the viewer they left.

Four things make this easy to re-introduce:

1. **There are TWO `signOut`s and only one is load-safe.** `useAuth().signOut` is not the same function:
   `createSignOut` wraps the raw method in `await clerkLoaded(clerk)` and only then delegates. `useClerk().signOut`
   is the raw, premount-queuing one. Nothing in the type signatures or the docs distinguishes them.
2. **`useAuth().isLoaded` is NOT a load gate on web.** `ClerkContextProvider` calls
   `deriveState(clerk.loaded, state, initialState)`, and `@clerk/nextjs` supplies `initialState` from the
   server's `auth()`. While clerk-js loads, `clerk.loaded` is `false`, so the derivation falls back to the SSR
   initial state — which carries a `userId`/`sessionId` — and `isLoaded` reads **`true`**. `AccountStateGate`'s
   `state.status === 'loading'` branch therefore does **not** cover this gap on web (it does on mobile, where
   there is no `initialState` — one of two reasons the mobile sign-out is not exposed to this race; the other is
   that mobile uses `useAuth().signOut`).
3. **Clerk does not guard it either.** Its own `<SignOutButton>` is registered `renderWhileLoading: true` and
   calls the raw method, so "use the Clerk component" is not a fix.
4. **A landing-URL assertion is not enough to catch it.** The e2e went green/red on where the viewer ended up,
   which is only a proxy: a stale or just-expired `__session` cookie makes the redirect happen anyway while the
   session is still live at Clerk.

## Decision

**1. One sign-out command.** `packages/apps/commise/web/src/components/auth/useSignOutAndLeave.ts` is the single
authoritative representation of "end this viewer's session and leave the app" — Command behind a headless hook.
`LogoutButton`, `AccountCloseForm`, and `AccountEraseForm` all issue it. They previously carried three copies of
the sequence, and therefore three copies of this defect.

**2. The mechanism is Clerk's load-safe wrapper, `useAuth().signOut`** — never `useClerk().signOut`. An early
click then _waits_ for the bootstrap and signs out for real, rather than being swallowed or erroring.

**3. The command VERIFIES the outcome — the load-bearing guard, and ours.** After the sign-out resolves, Clerk
must be loaded and must hold no session; otherwise the command throws and the caller surfaces its localized
failure. This is deliberately not a re-statement of (2): `clerkLoaded` is an undocumented internal of Clerk's,
so the safety of this flow must not depend on it. The post-condition fails **closed** on _any_ silent no-op —
today's premount queue, or a future regression in Clerk's wrapper — and unlike a "did we call the right
function" check it is a unit-testable assertion about the actual security property.

**4. A failed Clerk is short-circuited before delegating.** `clerkLoaded` resolves only on status
`ready`/`degraded`; on `error` it **never settles**, which would leave the caller's busy state spinning forever
(B17). So `status === 'error'` throws immediately instead. Controls are therefore never disabled — a
permanently-disabled sign-out would be a worse dead end than a visible, retryable error.

**5. The e2e asserts the security property, not the landing.** `tests/e2e/signOut.spec.ts` decodes the `sid`
from the browser's `__session` cookie before signing out and afterwards asserts, via the Clerk **Backend API**,
that the session is no longer `active` (plus that the cookie is gone). That is the only assertion that fails
when a sign-out resolves without revoking.

## Update (2026-07-27) — the mobile half, and where the command actually lives

Mobile was **not** exposed to the load race above (it already used `useAuth().signOut`, and `AuthGate`
genuinely blocks the tree while Clerk loads because there is no SSR `initialState`). It was, however, exposed
to the other half of the problem: **both** of its session-ending controls were `void signOut()` —
fire-and-forget, nothing awaited, no failure path. `AccountSettings.tsx` did it on press, and
`AccountDangerZone.tsx` did it as a side effect of the erasure mutation's `onSuccess`. A sign-out that failed
left the viewer silently signed in and told nothing; in the danger-zone case there was nowhere to report it at
all. Not a security hole — a silent-failure hole.

So the decision above is now split by what is platform-neutral and what is not:

1. **`signOutAndVerify` (`@commise/features-account`, `src/session/`) owns the ordering, the
   `status: 'error'` short-circuit, and the fail-closed post-condition.** These are the same invariant on both
   platforms and there is exactly one implementation of them, raising one typed `SignOutNotVerifiedError`.
   Mobile keeps the post-condition even though it is not exposed to the premount queue: it is an assertion
   about the security property (rather than about which function was called), so it also fails closed if a
   future Clerk release regresses its own wrapper — on either platform, from the same code.
2. **Each platform's hook is a thin ADAPTER** that supplies its SDK's load-safe `signOut` plus the client to
   verify against: `useSignOutAndLeave` (web) and `useSignOutAndVerify` (mobile).
3. **"Leaving" is web-only.** Web must replace the document (a router redirect re-renders the authenticated
   shell from a payload resolved for the destroyed session). Mobile has no document and no SSR payload —
   `AuthGate` swaps to the unauthenticated tree off Clerk's own state — so the mobile hook deliberately has no
   navigation step. That is the one part of the sequence that was NOT shared, and the reason the hook, not the
   command, is per-platform.
4. **Mobile's controls now own the states web's already had:** busy (and un-double-fireable) while in flight,
   and a localized alert on failure, never a raw error string. Both surfaces issue the shared
   `SignOutButton`, so the hub's sign-out and the danger zone's recovery cannot drift.
5. **The erasure exit tells the truth.** By the time the sign-out runs, the erasure has already been accepted
   (202) server-side. A failure to leave therefore surfaces its OWN copy (`account.eraseSignOutFailed`) plus a
   sign-out control as the recovery — never the erasure dialog's "we couldn't erase, try again", which would
   invite a retry of something that already happened. Mobile matches web here.

Not covered by this update, and left as a known gap rather than changed silently: mobile's account **CLOSURE**
still signs out inside `useDeleteAccount`'s `mutationFn` without the post-condition, and reports a failed
sign-out through the same `close.error` alert as a failed closure — the same conflation web's
`AccountCloseForm` documents. The closure is recoverable and the alert is now at least shown (it used to be
swallowed entirely), so this is a truthfulness wrinkle, not a silent failure.

## Consequences

- A sign-out clicked during the clerk-js bootstrap shows the ordinary busy state for the remainder of the load,
  then completes. No control is disabled and no click is swallowed.
- If clerk-js transitions to `error` _while_ a sign-out is already awaiting the load, that call never settles and
  the control stays busy. Narrow (the click has to land in the sub-second window before the failure) and it is a
  stuck spinner on a page where the viewer is still signed in and told nothing — not a false "you are signed
  out". Accepted over the alternatives; revisit if it is ever observed.
- Any NEW control whose correctness depends on ending the Clerk session must issue `useSignOutAndLeave()` (web)
  or `useSignOutAndVerify()` (mobile) rather than calling `signOut` from either hook directly. Calling it
  directly re-opens this hole.

## Update (2026-07-28) — where sign-out LANDS (owner decision)

Sign-out on web now lands on the **sign-in form**, not a public welcome page. Nothing in the decision above
changed: `useSignOutAndLeave` still hard-navigates to the app's public entry `/`, and the locale root's own auth
gate still decides what a signed-out caller sees. What changed is that gate's answer — the owner removed the
branded welcome/auth-entry surface on **both** platforms, so `/{locale}` redirects a signed-out caller to
`/{locale}/sign-in` (and mobile's `AuthGate` opens directly on its sign-in form). Consequences for this ADR:

- The landing assertion in `tests/e2e/signOut.spec.ts` targets `/sign-in` and Clerk's `<SignIn>` email field.
  Point **5** above still governs it: the landing is a proxy, and the load-bearing assertion remains the Clerk
  **Backend API** check that the session is no longer `active`.
- Keeping the navigation target as the bare `/` — rather than pointing the command at `/sign-in` — is
  deliberate. The signed-out destination stays defined in exactly ONE place (`[locale]/page.tsx`), so this
  command cannot drift from it, and the locale keeps being negotiated by the middleware instead of guessed by
  the caller.
- The historical trace in **Context** is left as recorded evidence; the `h1="Welcome to Commise"` in it is
  Home's own (screen-reader) heading under a still-live session, and that heading is unaffected by this change.

## Scope: development vs production instances

The reproduction was on the Clerk **development** instance against `localhost` (`pk_test`, dev-browser
`__clerk_db_jwt`). **The defect is not dev-specific**, and this is a claim about mechanism, not a measurement:
the premount queue lives in `@clerk/clerk-react` and is keyed only on whether clerk-js has loaded — it has no
knowledge of instance type, and the queued call is lost to the navigation identically either way. Production
instances also load clerk-js over the network (from `clerk.commise.app`), so the window exists there too.

What is **NOT** verified: the production window's real-world duration, and therefore how often a human clicks
inside it. `pk_live` is domain-locked and cannot run on localhost, so this could not be measured here. Do not
read "prod is affected in principle" as "prod was reproduced", and do not read the absence of a prod
reproduction as "prod was fine".

## Alternatives rejected

- **Disabling every session-ending control while `clerk.status === 'loading'`** (implemented and verified
  end-to-end first, then replaced). It works and can never hang, but it swallows a real click on every page load
  and re-implements the waiting that `useAuth().signOut` already does. Library-first breaks the tie; the
  post-condition supplies the guarantee the gate was there for.
- **`useAuth().isLoaded` as the gate** — wrong on web; it is `true` during the load window (see Context 2).
- **`<ClerkLoaded>` wrapping the controls** — same swallowed-click cost as the disabled gate, and unmounting a
  destructive control mid-page is a worse affordance still.
- **Hand-clearing `__session` / `__client_uat`, or a server route that deletes them** — clears the _client's_
  evidence of a session while leaving the session **active at Clerk**: any other client, or a replayed cookie,
  still authenticates. It treats the symptom and weakens the actual security property.
- **Hand-rolling the readiness wait (poll `clerk.loaded`, or race the status events)** — reinvents
  `clerkLoaded`. The one thing worth owning is the _outcome_ check, not the waiting.
