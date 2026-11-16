/**
 * A web touch target is sized in CSS px, not rem (designer D64, issue #287). The rem classes `size-11`, and `h-11` with
 * `w-11`, are 44 px at 100% text and 88 px at 200%, so a control a finger presses grows with the text and breaks reflow
 * at 320 px. `TOUCH_TARGET_CLASS` (`@commise/ui/touch-target`) is the only place that writes the size: `fixed` for a
 * target whose only content is a glyph, `min` for a target that holds text.
 *
 * Refused in non-native app source, behind any variant prefix, in a string, template or JSX text:
 *  - a `size-11` token;
 *  - `h-11` and `w-11` in the SAME string literal (a fixed square spelled in two tokens). Two literals of one call,
 *    such as `cn('h-11', 'w-11')`, are read one at a time and are not caught.
 *
 * Not refused: a lone `h-11` or `w-11` (a bar or an input), `min-h-11` and `min-w-11` (a text target's floor, a separate
 * question), `size-[44px]` and `sm:size-4`.
 *
 * ⛔ NO BASELINE AND NO ALLOW-LIST. SCOPE: `packages/apps/**` TypeScript minus tests, fixtures, build output
 * (`appSources.ts`) and `.native` files, which size a target with `touchFloor()` (`nativeTouchFloor.test.ts`). READ WITH
 * THE TYPESCRIPT PARSER, string-like nodes only, so a comment that names a class is not a use.
 *
 * @pattern Fitness Function over the source of every app
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { appSourceModules, classTokensOf, stringLikeTexts } from './appSources.js';
import { repoRoot } from './serviceSources.js';

/** The variants of a token (`md:`), removed to read the utility. A bracketed variant may hold a colon. */
function utilityOf(token: string): string {
    return token.split(/:(?![^[]*\])/u).at(-1) ?? '';
}

/**
 * Whether a class string writes a fixed rem square: a `size-11` token, or `h-11` and `w-11` together. Pure.
 *
 * @param tokens - The whitespace-split tokens of one class string.
 */
export function writesRemSquare(tokens: readonly string[]): boolean {
    const utilities = tokens.map((token) => utilityOf(token).replace(/^!/u, ''));

    return utilities.includes('size-11') || (utilities.includes('h-11') && utilities.includes('w-11'));
}

/**
 * The 1-based line and class text of every rem-sized touch square in a module. Pure.
 *
 * @param fileName - The module's name, which decides whether it is parsed as TSX.
 * @param source - Its text.
 */
export function remSquares(
    fileName: string,
    source: string,
): readonly { readonly line: number; readonly text: string }[] {
    return stringLikeTexts(fileName, source)
        .filter(({ text, openEnded }) => writesRemSquare(classTokensOf(text, openEnded)))
        .map(({ line, text }) => ({ line, text: text.trim().slice(0, 80) }));
}

describe('the rem touch square reader', () => {
    const cases: readonly { readonly shape: string; readonly source: string; readonly found: boolean }[] = [
        { shape: 'size-11', source: `const c = 'inline-flex size-11 items-center';`, found: true },
        { shape: 'size-11 behind a variant', source: `const c = 'md:size-11';`, found: true },
        { shape: 'an important size-11', source: `const c = '!size-11';`, found: true },
        { shape: 'size-11 in a template part', source: 'const c = `flex size-11 ${x}`;', found: true },
        { shape: 'size-11 in JSX text', source: `const e = <p className="size-11">x</p>;`, found: true },
        { shape: 'h-11 then w-11', source: `const c = 'inline-flex h-11 w-11 rounded-full';`, found: true },
        { shape: 'w-11 then h-11', source: `const c = 'w-11 h-11';`, found: true },
        { shape: 'h-11 and w-11 behind variants', source: `const c = 'sm:h-11 md:w-11';`, found: true },
        { shape: 'a lone h-11', source: `const c = 'h-11 px-3';`, found: false },
        { shape: 'a lone w-11', source: `const c = 'w-11 shrink-0';`, found: false },
        { shape: 'min-h-11 and min-w-11', source: `const c = 'min-h-11 min-w-11';`, found: false },
        { shape: 'the px recipe', source: `const c = 'size-[44px]';`, found: false },
        { shape: 'the mouse size', source: `const c = 'sm:size-4';`, found: false },
        { shape: 'size-110', source: `const c = 'size-110';`, found: false },
        { shape: 'size-11 named in a comment', source: `// was size-11\nconst c = 1;`, found: false },
        { shape: 'the recipe, used', source: `const c = TOUCH_TARGET_CLASS.fixed;`, found: false },
    ];

    for (const { shape, source, found } of cases) {
        it(`${found ? 'reads' : 'ignores'} ${shape}`, () => {
            expect(remSquares('fixture.tsx', source).length > 0).toBe(found);
        });
    }
});

describe('apps size no touch target in rem', () => {
    const modules = appSourceModules().filter((file) => !/\.native\.tsx?$/u.test(file));

    it('discovers the modules that hold touch targets (a vacuous pass would hide the rule)', () => {
        expect(modules).toContain('packages/apps/commise/ui/src/searchField/SearchField.tsx');
        expect(modules).toContain('packages/apps/commise/features/recipes/src/detail/StepRow.tsx');
        expect(modules).toContain('packages/apps/commise/ui/src/touchTarget/touchTargetClass.ts');
    });

    it('lets no app module write size-11, or h-11 with w-11, in one class string', () => {
        const offenders = modules.flatMap((file) =>
            remSquares(file, readFileSync(path.join(repoRoot, file), 'utf8')).map(
                (hit) => `${file}:${String(hit.line)}  ${hit.text}`,
            ),
        );

        expect(offenders).toEqual([]);
    });
});
