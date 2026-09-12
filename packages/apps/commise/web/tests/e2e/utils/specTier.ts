/**
 * Which specs can run against a DEPLOYED preview, and which cannot — derived, never listed.
 *
 * ## The distinction, and why it is not a preference
 *
 * `mockRecipeApi` installs `page.route('**‌/api/v1/**')`, which intercepts requests **the browser issues**.
 * A Next.js `page.tsx` prefetches through `RecipeServiceClient` inside the Next server's own Node process,
 * which never touches the browser's network stack — so the mock cannot reach it. `ssrPrefetch.spec.ts` has
 * documented this from the start, and the whole mocked suite silently depends on the other half of it: in
 * the local harness `NEXT_PUBLIC_API_URL` resolves to the web app's own origin, where no recipe API listens,
 * so every SSR prefetch fails and the page falls back to client fetching — which the browser mock DOES
 * intercept.
 *
 * Point that same suite at a deployed preview and the assumption inverts: a real recipe service answers the
 * SSR prefetch with real (empty) data, the page renders it, and the mock never applies. The specs then fail
 * on fixtures that were never served — `Weeknight Pasta`, `Sunday Roast` — which is exactly how this was
 * found.
 *
 * ⛔ So a mocked spec is not an end-to-end test and must not be run as one. The owner's ruling scopes the
 * deployed tier to tests "which should be hitting remote services"; a spec that intercepts every
 * `/api/v1/` call in the browser is definitionally not one, and ADR-0032's own title makes the weaker case
 * already — a test that boots its own backend is not end-to-end, and a test that MOCKS its backend is
 * further still. These specs are integration tests of the web app's rendering against a stubbed contract.
 * They keep their full value in the tier whose harness assumption actually holds.
 *
 * ## Why this is derived
 *
 * The partition is computed from each spec's own imports, not written down: a spec belongs to the deployed
 * tier **iff it does not import `mockRecipeApi`**. A new mocked spec is therefore excluded from the deployed
 * run the moment it is written, with nobody remembering to add it — and a spec that drops its mocks joins
 * the deployed tier the same way. `docs/architecture/decisions/0025-…` §3 is the standing reason: a copy of
 * a list cannot detect that the list is incomplete. `__tests__/specTier.test.ts` re-derives this from disk
 * and asserts the partition is total.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The marker that makes a spec unable to run against a deployed origin. */
export const MOCK_MARKER = 'mockRecipeApi';

/** Every Playwright spec filename in `tests/e2e`, discovered rather than listed. */
export const allSpecs = (): readonly string[] =>
    readdirSync(SPEC_DIR)
        .filter((name) => name.endsWith('.spec.ts'))
        .sort();

/** True when the spec stubs the recipe API in the browser, and so cannot face a real one. */
export const isMockedSpec = (name: string): boolean => readFileSync(join(SPEC_DIR, name), 'utf8').includes(MOCK_MARKER);

/** Specs that stub the recipe API. They run against the local harness only. */
export const mockedSpecs = (): readonly string[] => allSpecs().filter(isMockedSpec);

/** Specs that drive real services end to end. These are the deployed tier. */
export const deployedSpecs = (): readonly string[] => allSpecs().filter((name) => !isMockedSpec(name));

/** Glob form of {@link mockedSpecs}, for Playwright's `testIgnore` when a deployed origin is the target. */
export const mockedSpecGlobs = (): readonly string[] => mockedSpecs().map((name) => `**/${name}`);
