/**
 * How the e2e suite addresses Clerk's PRIMARY form submit — the ONE authority for it.
 *
 * Pattern: a locator **factory** (a named, parameterless provider over Playwright's `getByRole`), so the
 * knowledge "which button submits a Clerk card" has a single representation. It earned that extraction the
 * hard way: the same selector was spelled four times across `signIn.spec.ts` (x2), `signUp.spec.ts` and
 * `clerkEmailCode.ts`, and when Clerk's markup shifted, all four broke at once and each would have had to be
 * fixed identically.
 *
 * ## Why `exact: true` is load-bearing, not decoration
 *
 * Clerk renders the card's primary submit (`data-localization-key="formButtonPrimary"`) alongside a social
 * provider block. The Google button's ACCESSIBLE NAME currently computes to `Sign in with Google Continue`
 * — it CONTAINS the word "Continue". Playwright's `name` option is a substring/normalized match by default,
 * so `getByRole('button', { name: 'Continue' })` matched BOTH and every click failed:
 *
 *     strict mode violation: getByRole('button', { name: 'Continue' }) resolved to 2 elements:
 *       1) <button ... data-localization-key="formButtonPrimary"> aka { name: 'Continue', exact: true }
 *       2) <button ... cl-socialButtonsBlockButton__google> aka { name: 'Sign in with Google Continue' }
 *
 * `exact: true` resolves to element (1) only — Playwright's own disambiguation for this pair. A regex was
 * the other spelling in use (`/continue|sign up/i`) and is strictly worse here: `exact` has no meaning for a
 * regex, so a regex re-matches the social button and reintroduces the violation.
 *
 * ## The failure mode this deliberately keeps LOUD
 *
 * If Clerk relabels the primary button (say to "Sign up"), this locator matches nothing and the spec fails
 * with a clear timeout. That is the RIGHT outcome, and the reason not to broaden the match back out: a
 * loosened selector's next-best match is the Google button, so a "tolerant" version would click
 * *Sign in with Google* and fail somewhere far away — or, worse, pass having exercised the wrong flow.
 * Fix Clerk drift HERE, in one place; do not widen the match at a call site.
 *
 * Selector policy: `getByRole` only — no `data-testid`, per `docs/CODING_STANDARDS.md`. The
 * `data-localization-key` attribute is quoted above as evidence, not used as a selector.
 */
import type { Locator, Page } from '@playwright/test';

/**
 * The accessible name of Clerk's primary form submit on the sign-in, sign-up and email-code cards.
 *
 * Held as a named constant so the string that must be matched EXACTLY is stated once, next to the reason it
 * is matched exactly.
 */
const PRIMARY_SUBMIT_NAME = 'Continue';

/**
 * Locate Clerk's primary form submit button, excluding the social-provider buttons whose accessible names
 * also contain {@link PRIMARY_SUBMIT_NAME}.
 *
 * @param page - The Playwright page showing a Clerk card (sign-in, sign-up, or email verification).
 * @returns A locator that resolves to exactly the primary submit button.
 */
export function clerkPrimarySubmit(page: Page): Locator {
    return page.getByRole('button', { name: PRIMARY_SUBMIT_NAME, exact: true });
}
