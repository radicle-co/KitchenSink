/**
 * No app writes a focus ring by hand: `FOCUS_RING_CLASS` (`@commise/ui/focus-ring`) is the only place (`componentFixes.md`
 * §10). This REPLACES `ringOffsetColour.test.ts`, which required every `ring-offset-<width>` to name a colour beside it.
 * That rule kept 43 hand-copied ring classes, each naming `ring-offset-canvas`, which painted a canvas gap around
 * controls on paper, sheets and muted cards (in dark, a `#0E161E` ring on `#172029`). The gap is now the colour of the
 * surface the control sits on, read from the inherited `--cm-surface`, and a control states no colour of its own.
 *
 * Refused, behind ANY variant prefix, in a string, template or JSX text:
 *  - every `ring-offset-<anything>` token (the width and the colour are the recipe's);
 *  - a `ring`, `ring-<n>`, `ring-inset` or `ring-<colour>` token behind a FOCUS variant: `focus-visible:`, `focus:`,
 *    `focus-within:`, or `has-[:focus-visible]:`.
 *
 * Not refused: a ring that is not a focus ring (`active:ring-1 active:ring-inset` on a pressed switch, `ring-2` marking a
 * selected option), because it is not a gap-and-ring around a focus. A non-focus ring that names an offset IS refused.
 *
 * ⛔ NO BASELINE AND NO ALLOW-LIST; the single exemption is the recipe's own directory (`ui/src/focusRing/`), which is the
 * one module allowed to write the tokens. SCOPE: `packages/apps/**` TypeScript minus tests, fixtures and build output
 * (`appSources.ts`). READ WITH THE TYPESCRIPT PARSER, string-like nodes only, so a comment that names a class is not a use.
 *
 * @pattern Fitness Function over the source of every app
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { appSourceModules, classTokensOf, stringLikeTexts } from './appSources.js';
import { repoRoot } from './serviceSources.js';

/** The directory that owns the recipe, and so may write the tokens. */
const RECIPE_DIRECTORY = 'packages/apps/commise/ui/src/focusRing/';

/** A variant that makes a ring a FOCUS ring. */
const FOCUS_VARIANT = /^(?:focus|focus-visible|focus-within|has-\[:focus-visible\])$/u;

/** A utility of the ring family: `ring`, `ring-2`, `ring-inset`, `ring-focus-ring`, `ring-offset-2`. */
const RING_UTILITY = /^!?ring(?:-.+)?$/u;

/** The tokens of a class string split into its variant chain and its utility (`md:focus-visible:ring-2`). */
function splitToken(token: string): { readonly variants: readonly string[]; readonly base: string } {
    const parts = token.split(/:(?![^[]*\])/u);

    return { variants: parts.slice(0, -1), base: parts.at(-1) ?? '' };
}

/**
 * Whether a class token is a hand-written focus ring or ring offset. Pure.
 *
 * @param token - One whitespace-free token.
 */
export function isHandWrittenFocusRing(token: string): boolean {
    const { variants, base } = splitToken(token);

    if (/^!?ring-offset(?:-|$)/u.test(base)) {
        return true;
    }

    return RING_UTILITY.test(base) && variants.some((variant) => FOCUS_VARIANT.test(variant));
}

/**
 * The 1-based line and the token of every hand-written focus ring in a module. Pure.
 *
 * @param fileName - The module's name, which decides whether it is parsed as TSX.
 * @param source - Its text.
 */
export function handWrittenFocusRings(
    fileName: string,
    source: string,
): readonly { readonly line: number; readonly found: string }[] {
    return stringLikeTexts(fileName, source).flatMap(({ line, text, openEnded }) =>
        classTokensOf(text, openEnded)
            .filter(isHandWrittenFocusRing)
            .map((found) => ({ line, found })),
    );
}

describe('the hand-written focus ring reader', () => {
    const cases: readonly { readonly shape: string; readonly source: string; readonly found: readonly string[] }[] = [
        { shape: 'a ring offset width', source: `const c = 'ring-offset-2';`, found: ['ring-offset-2'] },
        {
            shape: 'a ring offset colour',
            source: `const c = 'focus-visible:ring-offset-canvas';`,
            found: ['focus-visible:ring-offset-canvas'],
        },
        {
            shape: 'an arbitrary ring offset colour',
            source: `const c = 'focus-visible:ring-offset-(--cm-surface,var(--color-canvas))';`,
            found: ['focus-visible:ring-offset-(--cm-surface,var(--color-canvas))'],
        },
        {
            shape: 'a whole hand-written ring',
            source: `const c = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';`,
            found: ['focus-visible:ring-2', 'focus-visible:ring-focus-ring'],
        },
        {
            shape: 'an inset focus ring',
            source: `const c = 'focus-visible:ring-inset';`,
            found: ['focus-visible:ring-inset'],
        },
        {
            shape: 'a focus: ring',
            source: `const c = 'focus:ring-2 focus:ring-focus-ring';`,
            found: ['focus:ring-2', 'focus:ring-focus-ring'],
        },
        { shape: 'a focus-within ring', source: `const c = 'focus-within:ring-2';`, found: ['focus-within:ring-2'] },
        {
            shape: 'a has-[:focus-visible] ring',
            source: `const c = 'has-[:focus-visible]:ring-2 pointer-fine:hover:shadow-md';`,
            found: ['has-[:focus-visible]:ring-2'],
        },
        {
            shape: 'a stacked variant',
            source: `const c = 'md:focus-visible:ring-2';`,
            found: ['md:focus-visible:ring-2'],
        },
        {
            shape: 'a ring in a template part',
            source: 'const c = `focus-visible:ring-2 ${x}`;',
            found: ['focus-visible:ring-2'],
        },
        {
            shape: 'a ring in JSX text',
            source: `const e = <p className="focus-visible:ring-2">x</p>;`,
            found: ['focus-visible:ring-2'],
        },
        { shape: 'a bare focus-visible outline', source: `const c = 'focus-visible:outline-none';`, found: [] },
        {
            shape: 'a pressed ring',
            source: `const c = 'active:ring-1 active:ring-inset active:ring-selected-edge';`,
            found: [],
        },
        { shape: 'a selected option’s ring', source: `const c = 'ring-2 ring-inset ring-focus-ring';`, found: [] },
        { shape: 'the recipe, used', source: `const c = FOCUS_RING_CLASS.offset;`, found: [] },
        {
            shape: 'a longer name that merely starts with ring',
            source: `const c = 'focus-visible:ringed-2';`,
            found: [],
        },
        {
            shape: 'a ring named in a comment',
            source: `// focus-visible:ring-2 is the old one\nconst c = 1;`,
            found: [],
        },
    ];

    for (const { shape, source, found } of cases) {
        it(`reads ${shape}`, () => {
            expect(handWrittenFocusRings('fixture.tsx', source).map((hit) => hit.found)).toEqual(found);
        });
    }
});

describe('apps write no focus ring by hand', () => {
    const modules = appSourceModules().filter((file) => !file.startsWith(RECIPE_DIRECTORY));

    it('discovers the recipe and the controls that wear it (a vacuous pass would hide the rule)', () => {
        expect(appSourceModules()).toContain(`${RECIPE_DIRECTORY}focusRingClass.ts`);
        expect(modules).toContain('packages/apps/commise/ui/src/button/surfaceClass.ts');
        expect(modules).toContain('packages/apps/commise/ui/src/chip/chipClass.ts');
        expect(modules).toContain('packages/apps/commise/ui/src/segmentedControl/segmentClass.ts');
        expect(modules).not.toContain(`${RECIPE_DIRECTORY}focusRingClass.ts`);
    });

    it('lets no app module outside the recipe state a focus ring or a ring offset', () => {
        const offenders = modules.flatMap((file) =>
            handWrittenFocusRings(file, readFileSync(path.join(repoRoot, file), 'utf8')).map(
                (hit) => `${file}:${String(hit.line)}  ${hit.found}`,
            ),
        );

        expect(offenders).toEqual([]);
    });
});
