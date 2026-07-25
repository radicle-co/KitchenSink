# Web E2E `external_id` Race Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `ci / E2E (web — Playwright)` job deterministically green by making the test harness tolerate the asynchronous `external_id` backfill (the "first-token sync race"), and by graceful-degrading the profile page's SSR identity fetch that emits `ECONNREFUSED` in that job.

**Architecture:** The failures are NOT a Clerk-dashboard regression and NOT a defect in the feature-001 remediation. They are a known race: `external_id` (the app-user ULID) is backfilled **asynchronously** onto the Clerk user by the `user.created` webhook (`identity-webhooks` → `clerk.users.updateUser({externalId})`). The **app already tolerates** this race — recipe `AuthMiddleware` returns a distinguishable `401 IDENTITY_SYNC_PENDING` and `RecipeServiceClient` retries with a force-refreshed token (`packages/clients/recipe-service/src/client.ts:852`). But the **Playwright harness bypasses that**: `readViewerAppId` (`tests/e2e/utils/recipeApi.ts:490`) reads `session.getToken()` **once, no retry**, and hard-throws if `external_id` is absent. E2E teardown deletes the test user every run, so each run recreates a fresh Clerk user and re-races the webhook latency. ~10 new spec files landed since the 2026-07-16 green baseline, quintupling the specs that hit the window right after `globalSetup` → non-deterministic 5–7 failures. Fix = mirror the app's tolerance in the harness (bounded wait for the claim) + make the backfill a deterministic `globalSetup` precondition. Separately, `profile/page.tsx` does an unguarded SSR fetch to an identity URL that defaults to `localhost:4000` (unbooted in the web-e2e job) → the `[WebServer] ECONNREFUSED` log; graceful-degrade it.

**Tech Stack:** Playwright, `@clerk/backend` (Backend API) + `@clerk/testing`, Next.js 15 App Router (RSC), Vitest.

## Global Constraints

- **Preserve the fail-loud `external_id` contract** — the harness and app deliberately NEVER fall back to the Clerk `sub`. The fix is **bounded waiting**, never a silent fallback or a fabricated id. On timeout, still throw the same loud, diagnostic error.
- Playwright selectors: `getByRole`/`getByLabel` only; `data-testid` and `page.waitForTimeout()` are banned. Use `expect.poll` / a bounded async retry helper (backoff), not fixed sleeps.
- Node 24 (`export PATH="$HOME/.nvm/versions/node/v24"*/bin:$PATH`).
- Env vars via bracket notation `process.env['KEY']`.
- The backfill mechanism is the deployed sandbox `user.created` webhook; the harness must **wait for** it, not re-implement or bypass it. Set a generous but bounded timeout and, on timeout, fail with a message naming the webhook prerequisite so a genuine webhook outage is still surfaced (not masked).
- Every touched test path keeps its existing conventions (`describe/it/expect` imported from vitest; `make*` fixtures).

---

## File Structure

- `packages/apps/commise/web/tests/e2e/utils/testUser.ts` — add `waitForTestUserExternalId(userId, opts?)`: polls the Clerk Backend API (`clerkClient.users.getUser`) until `.externalId` is populated; bounded timeout; throws loud on timeout. Single source of the "wait for backfill" logic.
- `packages/apps/commise/web/tests/e2e/global.setup.ts` — after `ensureSignInTestUser()`, `await waitForTestUserExternalId(...)` so `external_id` is a guaranteed precondition for **all** specs (the deterministic fix).
- `packages/apps/commise/web/tests/e2e/utils/recipeApi.ts` — harden `readViewerAppId` to poll `getToken({ skipCache: true })` with backoff until `external_id` appears (defense-in-depth for any per-test session/new-user race; keeps the loud throw on timeout).
- `packages/apps/commise/web/tests/e2e/utils/__tests__/readViewerAppId.test.ts` — NEW unit test for the retry helper (Vitest, fake timers).
- `packages/apps/commise/web/src/app/[locale]/profile/page.tsx` — wrap the SSR identity fetch in graceful-degrade (try/catch → degraded render) so an unreachable identity service never throws `ECONNREFUSED`.
- `packages/apps/commise/web/src/app/[locale]/profile/__tests__/page.test.tsx` (or the nearest existing profile test) — assert the degraded render when the identity fetch rejects.

---

### Task 1: Bounded token-read retry helper for `readViewerAppId`

**Files:**

- Modify: `packages/apps/commise/web/tests/e2e/utils/recipeApi.ts:490-519`
- Test: `packages/apps/commise/web/tests/e2e/utils/__tests__/readViewerAppId.test.ts` (create)

**Interfaces:**

- Consumes: a token source `() => Promise<string | null>` (in-page: `window.Clerk.session.getToken({ skipCache: true })`).
- Produces: `extractExternalIdFromJwt(token: string): string | undefined` (pure) + the in-page polling wrapper used by `readViewerAppId`.

- [ ] **Step 1: Write the failing unit test** for a pure `extractExternalIdFromJwt` + a `pollForExternalId(getToken, {timeoutMs, intervalMs})` that resolves once a token carries `external_id` and rejects (loud) after the timeout.

```ts
import { describe, it, expect, vi } from 'vitest';
import { extractExternalIdFromJwt, pollForExternalId } from '../recipeApi.js';

const jwt = (claims: Record<string, unknown>) =>
    ['h', Buffer.from(JSON.stringify(claims)).toString('base64url'), 's'].join('.');

describe('extractExternalIdFromJwt', () => {
    it('returns the external_id claim when present', () => {
        expect(extractExternalIdFromJwt(jwt({ external_id: 'usr_01ABC' }))).toBe('usr_01ABC');
    });
    it('returns undefined when the claim is absent', () => {
        expect(extractExternalIdFromJwt(jwt({ sub: 'user_clerk' }))).toBeUndefined();
    });
});

describe('pollForExternalId', () => {
    it('resolves once the backfilled claim appears', async () => {
        const tokens = [jwt({ sub: 'x' }), jwt({ sub: 'x' }), jwt({ external_id: 'usr_01ABC' })];
        let i = 0;
        const getToken = vi.fn(async () => tokens[Math.min(i++, tokens.length - 1)]!);
        await expect(pollForExternalId(getToken, { timeoutMs: 5000, intervalMs: 1 })).resolves.toBe('usr_01ABC');
        expect(getToken).toHaveBeenCalledTimes(3);
    });
    it('throws a loud, diagnostic error after the timeout (never falls back to sub)', async () => {
        const getToken = vi.fn(async () => jwt({ sub: 'x' }));
        await expect(pollForExternalId(getToken, { timeoutMs: 30, intervalMs: 10 })).rejects.toThrow(/external_id/);
    });
});
```

- [ ] **Step 2: Run it — verify it fails** (helpers not exported yet).

Run: `export PATH="$HOME/.nvm/versions/node/v24"*/bin:$PATH && npm run test --workspace=packages/apps/commise/web -- readViewerAppId`
Expected: FAIL — `extractExternalIdFromJwt`/`pollForExternalId` are not exported.

- [ ] **Step 3: Implement + export the helpers, and rewrite `readViewerAppId` to use `pollForExternalId`.** Keep the EXACT existing throw message on timeout (the fail-loud contract). The in-page evaluate must call `getToken({ skipCache: true })` each poll so a freshly-backfilled claim is picked up (Clerk caches tokens ~60s otherwise). Default `timeoutMs` ≈ 10000, `intervalMs` ≈ 500.

- [ ] **Step 4: Run the unit test — verify it passes.**

Run: `npm run test --workspace=packages/apps/commise/web -- readViewerAppId`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + lint the web workspace.**

Run: `npm run typecheck --workspace=packages/apps/commise/web && npm run lint --workspace=packages/apps/commise/web`
Expected: clean.

- [ ] **Step 6: Commit.**

```bash
git add packages/apps/commise/web/tests/e2e/utils/recipeApi.ts \
        packages/apps/commise/web/tests/e2e/utils/__tests__/readViewerAppId.test.ts
git commit -m "test(web): tolerate external_id backfill race in readViewerAppId (bounded retry)"
```

---

### Task 2: Gate `global.setup.ts` on the `external_id` backfill

**Files:**

- Modify: `packages/apps/commise/web/tests/e2e/utils/testUser.ts:20-37` (add `waitForTestUserExternalId`)
- Modify: `packages/apps/commise/web/tests/e2e/global.setup.ts`

**Interfaces:**

- Consumes: `clerkClient` (Backend API, already used by `ensureSignInTestUser`), the fixed test-user id.
- Produces: `waitForTestUserExternalId(userId: string, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<void>`.

- [ ] **Step 1: Add `waitForTestUserExternalId`** — poll `clerkClient.users.getUser(userId)` until `user.externalId` is a non-empty string; bounded (`timeoutMs` ≈ 30000, `intervalMs` ≈ 1000). On timeout, throw:

```ts
export async function waitForTestUserExternalId(
    userId: string,
    { timeoutMs = 30_000, intervalMs = 1_000 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const user = await clerkClient.users.getUser(userId);
        if (typeof user.externalId === 'string' && user.externalId.length > 0) return;
        if (Date.now() >= deadline) {
            throw new Error(
                `waitForTestUserExternalId: Clerk user ${userId} still has no externalId after ${timeoutMs}ms. ` +
                    `The user.created webhook (identity-webhooks → clerk.users.updateUser) must backfill it; ` +
                    `a persistent failure here means the sandbox webhook is down, not a test bug.`,
            );
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
}
```

Note: `Date.now`/`setTimeout` are fine here — this is Playwright setup code, not a workflow script.

- [ ] **Step 2: Call it from `global.setup.ts`** immediately after `ensureSignInTestUser()` resolves (it returns / is keyed by the test-user id). This blocks the whole suite until the backfill lands, so every per-test token deterministically carries `external_id`.

- [ ] **Step 3: Run the sign-in-dependent suite locally IF the Clerk sandbox env is available** (`CLERK_SECRET_KEY` etc.); otherwise this is validated in CI (the suite cannot run without the sandbox Clerk instance — that is expected and documented). Confirm `global.setup.ts` typechecks.

Run: `npm run typecheck --workspace=packages/apps/commise/web`
Expected: clean.

- [ ] **Step 4: Commit.**

```bash
git add packages/apps/commise/web/tests/e2e/utils/testUser.ts \
        packages/apps/commise/web/tests/e2e/global.setup.ts
git commit -m "test(web): block e2e global setup until test user external_id is backfilled"
```

---

### Task 3: Graceful-degrade the profile SSR identity fetch (`ECONNREFUSED`)

**Files:**

- Modify: `packages/apps/commise/web/src/app/[locale]/profile/page.tsx:15-19`
- Modify/Create: the nearest profile page test.

**Interfaces:**

- Consumes: `identityServiceClient` / `apiClient` (`IDENTITY_SERVICE_BASE_URL`, defaults `http://localhost:4000`).
- Produces: a profile page that renders a degraded state instead of throwing when the identity fetch rejects.

- [ ] **Step 1: Write the failing test** — mock the identity fetch to reject (`ECONNREFUSED`/`fetch failed`); assert the page renders a degraded profile (e.g. a "couldn't load your profile right now" state) and does NOT throw.

- [ ] **Step 2: Run it — verify it fails** (the SSR fetch currently throws).

Run: `npm run test --workspace=packages/apps/commise/web -- profile`
Expected: FAIL (unhandled rejection / thrown error).

- [ ] **Step 3: Implement** — wrap the SSR fetch in `try/catch`; on failure render the degraded state (mirror the graceful-degradation the recipe data pages already use). Preserve the happy path unchanged.

- [ ] **Step 4: Run the test — verify it passes.** Run: `npm run test --workspace=packages/apps/commise/web -- profile` → PASS.

- [ ] **Step 5: Typecheck + lint.** Run: `npm run typecheck --workspace=packages/apps/commise/web && npm run lint --workspace=packages/apps/commise/web` → clean.

- [ ] **Step 6: Commit.**

```bash
git add packages/apps/commise/web/src/app/\[locale\]/profile/page.tsx \
        packages/apps/commise/web/src/app/\[locale\]/profile/__tests__
git commit -m "fix(web): graceful-degrade profile SSR identity fetch (no ECONNREFUSED in e2e)"
```

---

### Task 4: Verify deterministic green in CI

**Files:** none (verification).

- [ ] **Step 1: Push the branch.** `git push origin 001-commise-recipe-app` (updates PR #73, triggers CI).

- [ ] **Step 2: Watch the `ci / E2E (web — Playwright)` job.** Expected: 54/54 pass (0 failed), no `readViewerAppId … no 'external_id'` errors, no `[WebServer] … ECONNREFUSED`.

- [ ] **Step 3: Re-run the job once more** (Playwright's own retries + a manual re-run) to confirm **determinism** — the fix removes a race, so two consecutive clean runs are the acceptance bar (the bug manifested as a shifting failing set across runs).

- [ ] **Step 4: If any `external_id`-class failure persists after the harness fix**, it is now a genuine sandbox webhook outage (the Task-2 gate will have failed loudly in setup with the diagnostic message) — escalate to ops to check the `identity-webhooks` `user.created` handler / svix delivery in the sandbox (per the `sandbox-user-create-failure` pattern), not the test code.

---

## Notes / Residual

- **Why not fix the Clerk dashboard?** No JWT-template/session-token config regressed (git history + `tasks.md:108` T000-prereq confirm it was configured and never reverted). The claim is correctly emitted **once the user has `externalId`**; the only gap is the harness not waiting for the async backfill. So this is a repo test-harness fix, not an ops/dashboard change.
- **`@clerk/testing` alternative (optional):** if the backfill proves too slow in CI even at a 30s gate, a more direct option is to have `global.setup.ts` set `externalId` itself via the Backend API to the app-user ULID — but that requires first triggering identity-service app-user creation to learn the ULID, which couples the web-e2e job to a booted identity service. Prefer the webhook-wait gate; keep this as the fallback only if the gate times out in practice.
- This plan does not touch feature-001 remediation code; that is complete and green across all other CI tiers.
