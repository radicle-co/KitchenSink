# 0054 — A request is minted only for the cook who made it, and a cook's cache ends with their session

- **Status:** Accepted
- **Date:** 2026-10-02
- **Relates to:** [ADR-0009](0009-clerk-signout-load-gate.md): the sign-out command this boundary follows.
  [ADR-0046](0046-apps-search-food-directly.md): the apps call food-service directly, so its failures and its token
  reach the apps' one query cache.
- **Plan:** `docs/plans/2026-09-20-002-feat-ingredient-lookup-grain-and-food-search-decoupling-plan.md`, sections S3
  (property 7) and S5, and control C5.

## Context

Each app builds a recipe client and a food client in its composition root. On web that is `RecipeProviders`, and on
mobile `RecipeServiceGate`. Each client reads its bearer token at SEND time. Three facts made that a cross-account
defect:

- **No client was built per cook.** On web, `@clerk/react`'s `getToken` is a `useCallback` on the one `IsomorphicClerk`
  instance. It keeps one identity for the provider's life, so clients keyed on it survived a change of cook. On mobile,
  `@clerk/expo` wraps `getToken` again on every render, so the clients were rebuilt on every render.
- **A client outlives the render that built it.** A query retry, an outbox drain or a mutation in flight holds the
  client it started with. A rebuild cannot reach those holders.
- **So cook A's work was sent with cook B's token.** The token callback asked Clerk for the token of the live session,
  whoever owned it.

The query cache had the same shape. At session end, `FoodServiceProvider` purged only the food-service reads. The
recipe client's reads stayed in the cache, and a cook's private recipes are among them. On mobile a sign-out does not
reload the process, so the next cook's screens find those reads under the same keys.

Two retry defects sat on the same path:

- The app's mutation default retried any `429` or `503`. The cook's own limit is a `429`, so the app waited it out up
  to three times. A busy live ingredient search was sent again, and each send spends a share of a source quota that
  every cook shares (control C5).
- The food client gave a transport failure the status `503`. A dropped socket can follow a committed write, and the
  app replayed a food WRITE after one.

Also, the food client read `Retry-After` with `Number(header)`. An HTTP date became `NaN` and hid the body's window.
Food-service already had a strict RFC 9110 parser for the same field.

## Decision

1. **A token is minted only for the cook the client was built for.** `subjectBoundToken` in `@commise/features-account`
   (`session/subjectBoundToken.ts`) is a Protection Proxy over each root's mint function.
    - It reads the identity client's LIVE session before the mint and again after it.
    - If that session is not the cook's, it throws `SessionSubjectChangedError`, and no request goes out.
    - Before the mint, a session that has not loaded yet is not a refusal. The web mint is the step that waits for
      clerk-js to load.
    - The first cook a client mints for claims a client that was built while nobody was signed in. This keeps the
      window before the identity client names its cook working.
2. **Both roots build both clients per cook.** One `useMemo` builds both clients over one bound mint. It is keyed on the
   `useClerk()` instance and the cook. Mobile mints from `clerk.session.getToken({ template, skipCache })`. The offline
   JWT cache in the `@clerk/expo` wrapper runs only for a call with no options, and every call here passes the template.
3. **A cook's query cache ends with their session.** Each root mounts `useQuerySessionScope`
   (`@commise/query/session-scope`) once. When the cook changes from a cook to anyone else, it does three things:
    - It RESETS every read. A reset cancels a read in flight, and a read that is still mounted asks again with the new
      cook's client.
    - It REMOVES every read that has no observer.
    - It CLEARS the mutation cache. Paused TanStack mutations live only in memory.

    A cook who signs in from signed out removes nothing. The boundary records the cook against the `QueryClient`. It does
    not act in an effect cleanup, because React's StrictMode runs every cleanup once on mount in development. The purge
    in `FoodServiceProvider` is deleted, because it was a second, narrower statement of this rule.

4. **Queued writes stay with their cook.** The outbox is persisted and namespaced by the cook. After that cook signs in
   again, it drains.
    - At a change of cook, a drain can still be running. It holds the previous cook's sender, and that client's proxy
      refuses.
    - `recipeSender` then parks the record with status `401`: there is no credential for its cook. `classifyFailure`
      reads that status as terminal.
    - The record drains later only because the drainer sends every record again, parked ones included, on each drain.
    - Unsynced writes never block a sign-out. The outbox is dropped only on erasure or closure.
5. **Four conditions decide the retry of a write, and all four must hold.** The server refused it without processing it
   (`429` or `503`). No client's veto in `RETRY_VETOES` refuses it. The stated wait is 30 seconds or less. The retry count is
   below the cap.
    - Food now has a veto, `shouldRetryFoodServiceFailure`. It decides on the error's type, and it abstains on a value
      it does not own.
    - A food transport failure carries no status, so the app never replays it. Only a `503` that came in a response
      (`SourceBusyError`) carries a status.
    - Every live search sets `retry: false`.
    - A food read and the sources read use the app's query retry, not a rule of their own.
6. **`Retry-After` has one parser.** `@kitchensink/retry-after` holds the RFC 9110 parser from food-service. The block
   rule in food-service, the food client and the cookbook importer all read the field with it. The food client treats a
   field it cannot read as no statement, so the body's window applies. A delay too large to be a number is the same. A
   date already past is no wait.

### Owed

- **Before the first `submit` call site.** No call site exists today. `SyncProvider` must cancel a running drain at a
  change of cook, so the drain's `failures` cannot land in the next cook's state. The outbox must be dropped on erasure
  and on closure.
- **The two session stores on mobile.** `cookingProgress` and `servingScale` in `@commise/features-recipes` hold one
  cook's state, and they must reset at session end. Both are documented as test-only seams, and the package does not
  export the first one. Their owner changes them first.
- **The two-cook end-to-end tests.** `web/tests/e2e/sessionHandoff.spec.ts` and `mobile/.maestro/sessionHandoff.yaml`
  need a second identity per shard in the test pool, and that identity must sign in by password.

## Alternatives considered

- **Rebuild the clients per cook, with no proxy.** This step is necessary, but it is not enough. It cannot reach a
  client that a retry, a drain or an in-flight mutation still holds.
- **Compare the token's own `sub` claim with the cook.** This is the strongest check, because the token states its
  subject. It needs a JWT decode in both apps, and every template must carry `sub`. Two reads of the live session close
  the same window, except for two session switches inside one mint.
- **Remount the subtree, keyed on the cook.** This also clears component state. But a remount at sign-in, from signed out, is
  the defect that once wiped the web recipe editor. A key that changes only between two cooks is more
  machinery than the cache needs.
- **Remove every read at session end.** We measured this. A mounted observer keeps the answer of a removed query until
  something renders it again. So a direct switch between two cooks kept the last cook's recipes on screen. A reset of
  the mounted reads fixes this.
- **Purge per client,** food in `FoodServiceProvider` and recipe beside it. That is two statements of one rule, and the
  recipe half was the missing one.
- **Use `ky` in the food client.** Not now, for four reasons:
    - Its timeout stops at the response headers. This client reads the body under its own deadline.
    - Its `Retry-After` parse runs only inside its own retry, and that retry must stay off.
    - Its `searchParams` writes a space as `+`. That splits the edge cache key, and it turns a lone surrogate into
      U+FFFD.
    - Without `AbortSignal.any`, its timeout stops aborting the socket. The oldest browsers the web app supports lack
      that API.

    Revisit this decision for a caller that needs transport-level retries of idempotent requests, with the body still
    under the client's deadline.

## Consequences

- A client built for cook A cannot send with cook B's token, from any holder. The window that remains is two session
  switches inside one token mint.
- A direct switch between two signed-in cooks (Clerk multi-session) can paint the last cook's cached reads for one
  commit before the reset. No control in the app switches sessions. On mobile, `setActive` is called only on the
  signed-out sign-in and sign-up screens. On web, the Clerk instance's multi-session setting decides whether a
  signed-in visitor can add a second session.
- A record parked at a change of cook reads as `terminal`, and its remedy (`edit`) is wrong for it. No surface renders a
  remedy yet. The first surface that does owes a reading for this case.
- A mutation that a session change refuses fails at once. A mutation whose stated wait is over 30 seconds fails at once
  too.
- An offline sign-out fails. Clerk-js removes the client's sessions over the network before it clears the session.
  `signOutAndVerify` passes that rejection through, so the cook stays signed in.
- Two images copy the new package's `dist`. Food-service needs it because its block rule imports the parser.
  Recipe-service needs it because the food client it carries imports the parser.
