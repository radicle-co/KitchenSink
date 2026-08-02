# Visual Defect Fixes (001 recipe form + web typography) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two visual defects that ship on `main` today — the recipe form's selected Difficulty chip renders white-on-white (invisible), and the production CSS bundle drops the webfont `@import` so no brand font ever loads — and add regression tests that would have caught each.

**Architecture:** Both are one-line-class / one-line-ordering bugs with no logic change. The value of this plan is in the **tests**, because both defects sailed through 6,675 unit tests and 30 Playwright specs. Task 1 replaces a layered `base + conditional-override` class pattern with a mutually-exclusive branch, and asserts it with the repo's existing `utilityContrast` helper — which *throws* on exactly the ambiguity that caused the bug. Task 2 moves a CSS `@import` above the Tailwind `@source` rules and adds a file-shape guard alongside the existing `tests/nextConfig.test.ts` config-guard tests.

**Tech Stack:** TypeScript, React 19, Tailwind CSS v4, Next.js 15 (App Router), Vitest 4 + React Testing Library, `@commise/test-utils` (WCAG contrast helpers).

## Global Constraints

- **Node 24 is required.** `package.json` sets `"engines": { "node": "24.x" }` and a commit-time guard enforces it. If `node -v` is not v24.x, prefix commands with the v24 nvm bin before doing anything.
- **Formatting:** 4-space indent, single quotes, semicolons, trailing commas, 120-char print width (Prettier). Run `npm run format` if a hook complains.
- **Commits:** Conventional Commits — `<type>(<scope>): <description>`, enforced by commitlint.
- **Tests are written BEFORE the code they cover (TDD red → green).** This is a hard, non-negotiable repo mandate (`docs/CODING_STANDARDS.md §7.1`). Every task below runs the test and **observes it fail for the stated reason** before any source edit.
- **No `any`, no `@ts-ignore` / `@ts-expect-error`.** TypeScript strict mode.
- **Imports:** `.js` extension on aliased imports, `.ts`/`.tsx` on relative imports; `import type` for type-only imports.
- **Do not change any `aria-label`, `role`, or accessible name.** Both defects are invisible to role/name queries — the existing Playwright suite depends on those names being exactly what they are today. Changing them would break `recipeCrud.spec.ts` and friends while fixing nothing.

---

## Background: why the existing tests miss both defects

Read this before starting. It is the reason the plan is shaped the way it is.

**Defect 1 — the invisible chip.** `RecipeFormSections.tsx` builds the difficulty chip as a base class string plus a conditional override:

```tsx
className={`${difficultyChip} ${selected ? difficultyChipSelected : ''}`}
```

where the base carries `bg-white text-charcoal border-border` and the selected const carries `bg-seafoam bg-white text-white border-seafoam`. Both land in the class attribute, so **the stylesheet's emission order decides the winner, not the order written**. Measured in the production bundle: `.bg-seafoam` at byte offset 20318, `.bg-white` at 20905 → `bg-white` wins. `.text-charcoal` at 33378, `.text-white` at 33979 → `text-white` wins. Net: white text on a white background.

Because "Not stated" has `value: undefined`, `values.difficulty === option.value` is `undefined === undefined` → **true on a fresh form**. So every new-recipe form opens showing a blank pill, and selecting any difficulty makes that one vanish instead.

The label is intact as `aria-label`, so `getByRole('radio', { name: 'Not stated' })` passes over a broken control. There is already a difficulty test in `RecipeForm.test.tsx` (~line 303) — but it only measures the **focus ring**, never the text-against-fill.

**Defect 2 — no webfonts in production.** `globals.css` puts the Google Fonts `@import` on line 11, *after* the Tailwind v4 `@source` at-rules on lines 6 and 9. CSS requires `@import` to precede all rules except `@charset` and `@layer` statements, so the optimizer drops it. `next build` says so, but only as a soft note. Verified: the built stylesheet contains **0** occurrences of `fonts.googleapis.com`, and a real browser on the production server issues **no** googleapis/gstatic/woff requests. There is no `next/font` usage anywhere in the web app, so that `@import` was the only webfont mechanism. Production renders Georgia (not Playfair Display) and system-ui (not Inter).

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/apps/commise/features/recipes/src/form/RecipeFormSections.tsx` | Web recipe form fields. Owns the difficulty chip class strings (lines 63–70) and their application (line ~203). | 1 |
| `packages/apps/commise/features/recipes/src/form/__tests__/RecipeForm.test.tsx` | Existing web form component tests. Gains the contrast regression test. | 1 |
| `packages/apps/commise/web/src/app/globals.css` | Web app global stylesheet. Owns the `@import` ordering. | 2 |
| `packages/apps/commise/web/tests/globalsCss.test.ts` | **New.** File-shape guard for `globals.css`, alongside the existing `nextConfig.test.ts` / `mockupContrast.test.ts` config-guard tests. | 2 |

`RecipeFormSections.native.tsx` is **not** affected — the native leaf styles its chips with React Native `StyleSheet` objects, not Tailwind class strings, so it has no cascade-order ambiguity. Do not change it.

---

### Task 1: Make the selected Difficulty chip legible

**Files:**
- Modify: `packages/apps/commise/features/recipes/src/form/RecipeFormSections.tsx:63-70` (class consts) and `:203` (application)
- Test: `packages/apps/commise/features/recipes/src/form/__tests__/RecipeForm.test.tsx`

**Interfaces:**
- Consumes: `utilityContrast` from `@commise/test-utils` — signature `utilityContrast(className: string, options?: { surface?: string; variant?: string; foreground?: 'text' | 'border' }): number`, returns a WCAG ratio 1..21. It **throws** if the class list contains more than one palette-coloured `text-*` (or `bg-*`) utility at the same variant level, with the message ``Expected exactly ONE palette-coloured `text-*` utility in "…", found 2.``
- Consumes: `semantic.card` from the UI tokens (already imported in this test file as `CARD`), and `renderForm` / `filledValues` (already defined in this test file).
- Produces: three exported-in-module class consts `difficultyChipBase`, `difficultyChipResting`, `difficultyChipSelected` (module-private; no other file imports them).

- [ ] **Step 1: Write the failing test**

Open `packages/apps/commise/features/recipes/src/form/__tests__/RecipeForm.test.tsx`. Find the existing `describe('RecipeForm (web) — difficulty picker', …)` block (around line 547). Add the `CARD` const at the **top of that describe body**, then the test below it.

`CARD` cannot be reused from the focus-ring describe at line 271 — it is declared inside that block (line 273) and goes out of scope when it closes at line 353. `semantic` and `utilityContrast` are both module-scope imports (lines 13–14), so only the one const is needed:

```tsx
    /** The difficulty chips sit inside a `bg-card` section, so that is the surface behind them. */
    const CARD = semantic.card;
```

Then, inside the same describe:

```tsx
    // REGRESSION: the selected chip layered `bg-seafoam text-white` on top of a base that already set
    // `bg-white text-charcoal`. Tailwind emits `.bg-white` AFTER `.bg-seafoam` and `.text-white` AFTER
    // `.text-charcoal`, so the background resolved to white while the text resolved to white — the label
    // was invisible in every browser, in dev and in prod. `utilityContrast` throws on exactly that
    // ambiguity (two palette-coloured utilities of the same role), so this goes red on the shipped code
    // before it ever gets as far as measuring a ratio.
    it.each([
        ['Not stated', undefined],
        ['Easy', 'easy'],
        ['Medium', 'medium'],
        ['Hard', 'hard'],
    ])('renders the selected %s chip legibly (its own fill, not the card behind it)', (label, value) => {
        renderForm({
            values: value === undefined ? filledValues() : filledValues({ difficulty: value as 'easy' | 'medium' | 'hard' }),
        });

        const chip = screen.getByRole('radio', { name: label }).parentElement;

        if (chip === null) {
            throw new Error(`Expected the "${label}" radio to sit inside its chip label.`);
        }

        // The chip text is `text-body-sm`, i.e. normal-size body copy — WCAG AA is 4.5:1, not the 3:1
        // large-text allowance. Seafoam-on-white measures ~4.67, so this threshold has real teeth.
        expect(utilityContrast(chip.className, { surface: CARD }), `${label} selected chip label`) //
            .toBeGreaterThanOrEqual(4.5);
    });
```

`filledValues` with no argument leaves `difficulty` unset, which is what selects the "Not stated" chip.

- [ ] **Step 2: Run the test to verify it fails**

From `packages/apps/commise/features/recipes`:

```bash
npx vitest run src/form/__tests__/RecipeForm.test.tsx -t "renders the selected"
```

Expected: **4 failures**, each an `Error` thrown from `utilityContrast`, not an assertion diff — e.g.:

```
Expected exactly ONE palette-coloured `text-*` utility in "relative flex cursor-pointer items-center
rounded-full border border-border bg-white px-4 py-1.5 text-body-sm text-charcoal transition
focus-within:ring-2 focus-within:ring-seafoam border-seafoam bg-seafoam text-white", found 2.
```

If you instead see a passing test or a plain ratio comparison failure, **stop** — the fix in Step 3 will not be verifying what this plan claims. Re-read the class strings at `RecipeFormSections.tsx:63-70`.

- [ ] **Step 3: Split the class strings so exactly one colour of each role applies**

In `packages/apps/commise/features/recipes/src/form/RecipeFormSections.tsx`, replace the two consts at lines 63–70. Currently:

```tsx
const difficultyChip =
    'relative flex cursor-pointer items-center rounded-full border border-border bg-white px-4 py-1.5 text-body-sm text-charcoal transition focus-within:ring-2 focus-within:ring-seafoam';
// The radio input is a transparent overlay covering its whole chip (not `sr-only`), so the semantic control
// is itself the click/tap target — directly actionable for pointer users and E2E (`getByRole('radio')`),
// while the visible chip text renders beneath. `sr-only` would shrink it to a 1px point the visible label
// then overlays, which pointer-based drivers (Playwright) cannot reach.
const difficultyRadioOverlay = 'absolute inset-0 cursor-pointer opacity-0';
const difficultyChipSelected = 'border-seafoam bg-seafoam text-white';
```

Replace with:

```tsx
// Layout and state-independent chrome ONLY — deliberately carries no `bg-*`, `text-<colour>`, or
// `border-<colour>` utility. Those live in the two mutually-exclusive state consts below.
//
// DO NOT fold the resting colours back in here and override them conditionally. Tailwind orders utilities
// by its own emission order, NOT by the order they appear in the class attribute, so `base + override`
// silently resolves to whichever utility Tailwind happened to emit last. That is not hypothetical: this
// chip shipped with `bg-white`(base) beating `bg-seafoam`(selected) while `text-white`(selected) beat
// `text-charcoal`(base), rendering the selected label white-on-white in every browser.
const difficultyChipBase =
    'relative flex cursor-pointer items-center rounded-full border px-4 py-1.5 text-body-sm transition focus-within:ring-2 focus-within:ring-seafoam';
// The radio input is a transparent overlay covering its whole chip (not `sr-only`), so the semantic control
// is itself the click/tap target — directly actionable for pointer users and E2E (`getByRole('radio')`),
// while the visible chip text renders beneath. `sr-only` would shrink it to a 1px point the visible label
// then overlays, which pointer-based drivers (Playwright) cannot reach.
const difficultyRadioOverlay = 'absolute inset-0 cursor-pointer opacity-0';
const difficultyChipResting = 'border-border bg-white text-charcoal';
const difficultyChipSelected = 'border-seafoam bg-seafoam text-white';
```

- [ ] **Step 4: Apply the branch at the call site**

In the same file, at the `<label>` inside the `difficultyOptions(m).map(…)` block (around line 201–204), change:

```tsx
                            <label
                                key={option.label}
                                className={`${difficultyChip} ${selected ? difficultyChipSelected : ''}`}
                            >
```

to:

```tsx
                            <label
                                key={option.label}
                                className={`${difficultyChipBase} ${selected ? difficultyChipSelected : difficultyChipResting}`}
                            >
```

- [ ] **Step 5: Run the test to verify it passes**

From `packages/apps/commise/features/recipes`:

```bash
npx vitest run src/form/__tests__/RecipeForm.test.tsx -t "renders the selected"
```

Expected: **4 passed**.

- [ ] **Step 6: Run the whole form suite to prove nothing regressed**

The pre-existing focus-ring test measures `ringContrast(chip.className, …)` on all four chips and depends on `focus-within:ring-seafoam` still being on the label — it is, in `difficultyChipBase`.

```bash
npx vitest run src/form/__tests__/RecipeForm.test.tsx
```

Expected: all tests pass, 0 failures.

- [ ] **Step 7: Run the full package suite**

```bash
npx vitest run
```

Expected: 0 failures. (This package ran 749 + 1366 tests across its two configs on `main`; any failure here is yours.)

- [ ] **Step 8: Commit**

```bash
git add packages/apps/commise/features/recipes/src/form/RecipeFormSections.tsx \
        packages/apps/commise/features/recipes/src/form/__tests__/RecipeForm.test.tsx
git commit -m "fix(recipes): make the selected difficulty chip legible (was white-on-white)"
```

---

### Task 2: Restore webfonts in the production CSS bundle

**Files:**
- Modify: `packages/apps/commise/web/src/app/globals.css:1-11`
- Create: `packages/apps/commise/web/tests/globalsCss.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1. This task is independent and may be done first.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Write the failing test**

Create `packages/apps/commise/web/tests/globalsCss.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Shape guard for the app's global stylesheet.
 *
 * CSS requires every `@import` to precede all other rules (bar `@charset` and `@layer` statements). An
 * `@import` placed after any other rule is INVALID and is silently discarded by the CSS optimizer — the
 * `next build` log mentions it, but nothing fails. That is exactly how the Google Fonts import came to sit
 * below the Tailwind `@source` rules and get dropped, shipping a production bundle with zero webfonts:
 * every heading fell back from Playfair Display to Georgia and every body string from Inter to system-ui,
 * gracefully enough that no test and no reviewer noticed.
 */
const globalsCss = readFileSync(fileURLToPath(new URL('../src/app/globals.css', import.meta.url)), 'utf8')
    // Comments can contain anything, including the literal '@import' in prose like this file's own header.
    .replace(/\/\*[\s\S]*?\*\//g, '');

/** The offset of the earliest at-rule that makes any later `@import` invalid, or `Infinity` if none. */
function firstNonPreambleRuleOffset(css: string): number {
    const offsets = ['@source', '@theme', '@keyframes', '@media', '@supports', '@font-face']
        .map((rule) => css.indexOf(rule))
        .filter((offset) => offset !== -1);
    // `@layer base {` (block form) also closes the preamble; the bare `@layer a, b;` statement form does not.
    const layerBlock = css.search(/@layer\s+[^;{]*\{/);

    if (layerBlock !== -1) offsets.push(layerBlock);

    return offsets.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...offsets);
}

describe('globals.css', () => {
    it('declares every @import before any rule that would invalidate it', () => {
        const cutoff = firstNonPreambleRuleOffset(globalsCss);
        const strays = [...globalsCss.matchAll(/@import[^;]*;/g)]
            .filter((match) => match.index !== undefined && match.index > cutoff)
            .map((match) => match[0]);

        expect(strays, 'these @import rules sit after another rule and will be DROPPED from the bundle') //
            .toEqual([]);
    });

    it('still imports the brand webfont families', () => {
        // Guards against "fixing" the ordering by deleting the import outright. If these ever move to
        // `next/font`, delete this test in the same commit that adds the replacement.
        expect(globalsCss).toContain('fonts.googleapis.com');

        for (const family of ['Inter', 'JetBrains+Mono', 'Playfair+Display']) {
            expect(globalsCss, `${family} must stay in the font import`).toContain(family);
        }
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

From `packages/apps/commise/web`:

```bash
npx vitest run tests/globalsCss.test.ts
```

Expected: the first test **fails**, reporting one stray import:

```
these @import rules sit after another rule and will be DROPPED from the bundle
- Expected  []
+ Received  [ "@import url('https://fonts.googleapis.com/css2?family=Inter:...&display=swap');" ]
```

The second test passes (the import is present, just misplaced).

- [ ] **Step 3: Move the font import into the preamble**

In `packages/apps/commise/web/src/app/globals.css`, cut the `@import url('https://fonts.googleapis.com/…');` line (currently line 11, followed by a blank line) and place it directly beneath the existing theme import on line 1, so the file begins:

```css
@import '@commise/ui/theme.css';
/* Brand typography. MUST stay in the @import preamble, above the `@source` rules below: CSS drops any
   `@import` that follows another rule, and when this line sat below them the production bundle shipped with
   no webfonts at all — Playfair Display silently degraded to Georgia and Inter to system-ui. Guarded by
   `tests/globalsCss.test.ts`. */
@import url('https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,400..700;1,14..32,400..700&family=JetBrains+Mono:ital,wght@0,400..700;1,400..700&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap');

/* Tailwind v4 auto-scans THIS app's files but not workspace packages. The recipe UI (list, detail, form,
   discovery, collections, …) is rendered from the shared @commise/features-recipes building blocks, so
   scan their source too — otherwise the utility classes they use are never generated. */
@source "../../../features/recipes/src/**/*.{ts,tsx}";
/* The shared design-system components (e.g. @commise/ui/button) carry their own utility classes — scan
   their source too, or the Button's tier/surface classes are never generated. */
@source "../../../ui/src/**/*.{ts,tsx}";

@layer base {
```

Leave the rest of the file untouched. Do not reorder the two `@source` rules or the `@layer`/`@theme`/`@keyframes` blocks.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/globalsCss.test.ts
```

Expected: **2 passed**.

- [ ] **Step 5: Prove the fix empirically against a real production build**

The unit test guards the *file shape*. It does not prove the optimizer kept the import — that needs a real build. This step is the actual verification of the defect being fixed, so do not skip it.

From `packages/apps/commise/web`:

```bash
npm run build 2>&1 | tee /tmp/web-build.log
```

Then check two things:

```bash
# 1. The CSS-optimizer warning is GONE.
grep -c "@import rules must precede" /tmp/web-build.log
# Expected: 0

# 2. The font import actually survived into the emitted bundle.
grep -c "fonts.googleapis.com" .next/static/css/*.css
# Expected: 1 (on `main` today this is 0)
```

If (2) is still `0`, the import is being dropped for a different reason — **stop and report** rather than proceeding.

- [ ] **Step 6: Commit**

```bash
git add packages/apps/commise/web/src/app/globals.css \
        packages/apps/commise/web/tests/globalsCss.test.ts
git commit -m "fix(web): keep the webfont @import in the preamble so it survives the CSS optimizer"
```

---

### Task 3: Full-tree verification

**Files:** none modified — this task is a gate.

**Interfaces:**
- Consumes: the working tree after Tasks 1 and 2.

- [ ] **Step 1: Typecheck the whole workspace**

From the repo root. `--force` matters: Turbo's cache is content-hashed and a plain run will replay cached logs and report success without executing anything.

```bash
npm run typecheck -- --force
```

Expected: all tasks successful, `Cached: 0 cached`.

- [ ] **Step 2: Lint and format-check the whole workspace**

```bash
npm run lint -- --force
```

Expected: all tasks successful, `Cached: 0 cached`.

- [ ] **Step 3: Run every unit/component suite**

```bash
npm run test -- --force
```

Expected: 0 failures. For reference, `main` at `50d5a1fb` ran **6,675 passed / 0 failed / 21 skipped** across 41 tasks; your run should be that plus the 6 tests this plan adds.

- [ ] **Step 4: Confirm the web Playwright contract is untouched**

Neither task changes an `aria-label`, a `role`, or an accessible name, so the e2e suite should be unaffected. Confirm by inspection rather than by running the suite — a local Playwright run competes with CI for the shared Clerk dev instance and will produce false failures on both sides.

```bash
git diff main --stat
git diff main -- '*.tsx' | grep -E '^[-+].*(aria-label|role=|getByRole|getByLabel)' || echo "no accessible-name changes — good"
```

Expected: `no accessible-name changes — good`. If anything prints, an accessible name moved and `recipeCrud.spec.ts` / `recipeEditWizard.spec.ts` must be re-read before pushing.

- [ ] **Step 5: Push and let CI run the e2e tiers**

```bash
git push -u origin HEAD
```

Open a PR. Confirm the `ci / E2E (web — Playwright)` job goes green there rather than running it locally.

---

## Deliberately out of scope

Named here so a later reader knows these were considered and consciously left out, not missed:

- **Migrating web typography to `next/font/google`.** This is the durable fix — self-hosted, preloaded, no render-blocking third-party request, and no `@import`-ordering trap to fall into again. It is the officially recommended Next.js approach, and the mobile app already self-hosts the same families via `@expo-google-fonts/playfair-display`, which makes web the odd one out. It is excluded here because it touches the shared `@commise/ui` token package (`src/tokens/scale.ts` `fontFamily`, plus the generated `dist/theme.css` and its byte-identity snapshot test `webTokens.snapshot.test.ts`), and that deserves its own plan and its own decision. Task 2's guard test stays valid either way — if you do migrate, delete the second test in `globalsCss.test.ts` in the same commit.
- **Vercel Web Analytics never loading.** `src/middleware.ts`'s matcher excludes `_next/static`, `robots.txt`, `sitemap.xml`, and the Sentry tunnel, but not `_vercel` — so `/_vercel/insights/script.js` gets a `307` to `/en/_vercel/insights/script.js`. The redirect is confirmed locally; the resulting 404 on real Vercel infrastructure is not. This is telemetry loss, not a visual defect.
- **The Discover filter panel's three near-identical chip rows** (`Under 15 / 30 / 60 min` repeated for Prep, Cook, and Total time). Nine visually interchangeable chips scan as noise. That is a design change, not a defect fix.
- **The recipe service not being deployed to production** (`recipe.commise.app` has no DNS record; the prod-deploy recipe legs are skipped and the food DB migration fails on `password authentication failed for user "food_app"`). Separate, larger, and already in flight on `main`.
