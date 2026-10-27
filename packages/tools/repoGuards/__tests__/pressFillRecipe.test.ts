/**
 * No app writes a press fill by hand: `PRESS_FILL_CLASS` (`@commise/ui/surface-tone`) is the only place
 * (`componentFixes.md` §10, §10a). This REPLACES `pressWashLiterals.test.ts` (parity item 15), which refused an ink-alpha
 * wash and told authors to write `hover:bg-surface-muted` instead. That fill was 1.05:1 against the canvas it pressed
 * (invisible) and wrong on every other surface; a press is now the surface with ink laid over it, read from the
 * surface the control sits on (`--cm-press`), so a control states no colour of its own.
 *
 * Refused, in a string, template or JSX text:
 *  - `bg-surface-muted` or `bg-line-divider` behind a PRESS variant: `hover:`, `active:`, `focus-visible:` or
 *    `data-[highlighted]:` (any stacking, `md:hover:` included);
 *  - `bg-press-<tone>` behind ANY variant: the derived press roles are the recipe's, and picking a tone's by hand is
 *    exactly the per-site decision the recipe removes;
 *  - an ink-alpha fill, `bg-ink/6`, `bg-ink-muted/10`, `bg-ink/[0.06]`, behind ANY variant (the earlier rule, kept).
 *
 * NATIVE (`.native.tsx`): the pressed branch (`pressed ? … : …`, `pressed && …`) of a `Pressable` style function that
 * destructures `pressed` may not paint `backgroundColor` from `colors.<role>` / `theme.colors.<role>`. A pressed native control reads `usePressFill()` (the surface's press), as its web
 * twin reads `--cm-press`; six native rows pressed to `colors.surfaceMuted` while the web used the derived press. Exempt: the
 * recipe directory and `button/surfacePaint.native.ts` (the Button's own paint).
 *
 * Not refused: a resting `bg-surface-muted` (a surface, `G3`), a tinted status fill such as `bg-danger/10`, `text-ink/60`.
 *
 * ⛔ NO BASELINE AND NO ALLOW-LIST; the single exemption is the recipe's own directory (`ui/src/surfaceTone/`).
 * SCOPE: `packages/apps/**` TypeScript minus tests and fixtures (`appSources.ts`). READ WITH THE TYPESCRIPT PARSER.
 *
 * @pattern Fitness Function over the source of every app
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { appSourceModules, classTokensOf, parseModule, stringLikeTexts } from './appSources.js';
import { repoRoot } from './serviceSources.js';

/** The directory that owns the recipe, and so may write the tokens. */
const RECIPE_DIRECTORY = 'packages/apps/commise/ui/src/surfaceTone/';

/** The Button's own paint, which owns its press (it is not a bare pressable). */
const BUTTON_PAINT = 'packages/apps/commise/ui/src/button/surfacePaint.native.ts';

/** A variant that makes a fill a PRESS fill. */
const PRESS_VARIANT = /^(?:hover|active|focus-visible|data-\[highlighted\])$/u;

/** A fixed press colour: the old press fills. */
const FIXED_PRESS = /^bg-(?:surface-muted|line-divider)$/u;

/** A derived press role used by hand: `bg-press-canvas`, `bg-press-paper-overlay`. */
const PRESS_ROLE = /^bg-press-/u;

/** An ink-alpha background: `bg-ink/6`, `bg-ink-muted/10`, `bg-ink/[0.06]`. */
const INK_ALPHA = /^bg-ink(?:-muted)?\/(?:\d+(?:\.\d+)?|\[[^\]\s]+\])$/u;

/** A token split into its variant chain and its utility (`md:hover:bg-ink/6`). */
function splitToken(token: string): { readonly variants: readonly string[]; readonly base: string } {
    const parts = token.split(/:(?![^[]*\])/u);

    return { variants: parts.slice(0, -1), base: (parts.at(-1) ?? '').replace(/^!/u, '') };
}

/**
 * Whether a class token is a hand-written press fill. Pure.
 *
 * @param token - One whitespace-free token.
 */
export function isHandWrittenPress(token: string): boolean {
    const { variants, base } = splitToken(token);

    return (
        (FIXED_PRESS.test(base) && variants.some((variant) => PRESS_VARIANT.test(variant))) ||
        PRESS_ROLE.test(base) ||
        INK_ALPHA.test(base)
    );
}

/**
 * The 1-based line and the token of every hand-written press fill in a module. Pure.
 *
 * @param fileName - The module's name, which decides whether it is parsed as TSX.
 * @param source - Its text.
 */
export function handWrittenPresses(
    fileName: string,
    source: string,
): readonly { readonly line: number; readonly found: string }[] {
    return stringLikeTexts(fileName, source).flatMap(({ line, text, openEnded }) =>
        // A token can sit at either end of a template part, so each part is read with a space on both sides.
        classTokensOf(` ${text} `, openEnded)
            .filter(isHandWrittenPress)
            .map((found) => ({ line, found })),
    );
}

/** Whether an expression reads a role off a theme's colours: `colors.surfaceMuted`, `theme.colors.surfaceMuted`. */
function readsThemeRole(node: ts.Node): boolean {
    let found = false;

    const visit = (child: ts.Node): void => {
        if (ts.isPropertyAccessExpression(child)) {
            const owner = child.expression;

            if (
                (ts.isIdentifier(owner) && owner.text === 'colors') ||
                (ts.isPropertyAccessExpression(owner) && owner.name.text === 'colors')
            ) {
                found = true;
            }
        }

        ts.forEachChild(child, visit);
    };

    visit(node);

    return found;
}

/** Whether a function's first parameter destructures `pressed`: `({ pressed }) => …`, `({ pressed, hovered }) => …`. */
function destructuresPressed(fn: ts.ArrowFunction | ts.FunctionExpression): boolean {
    const first = fn.parameters[0]?.name;

    return (
        first !== undefined &&
        ts.isObjectBindingPattern(first) &&
        first.elements.some((element) => ts.isIdentifier(element.name) && element.name.text === 'pressed')
    );
}

/** Whether an expression mentions the identifier `pressed`. */
function mentionsPressed(node: ts.Node): boolean {
    return (ts.isIdentifier(node) && node.text === 'pressed') || ts.forEachChild(node, mentionsPressed) === true;
}

/**
 * The 1-based line of every `backgroundColor` painted from a theme role in the PRESSED branch of a style function that
 * destructures `pressed`: the `whenTrue` of `pressed ? … : …` and the right of `pressed && …`. A resting fill in the same
 * function (`colors.paper`) is a surface, and a chosen-state fill is not a press, so neither is read. Pure.
 *
 * @param fileName - The module's name.
 * @param source - Its text.
 */
export function nativeHandWrittenPresses(fileName: string, source: string): readonly { readonly line: number }[] {
    const file = parseModule(fileName, source);
    const hits: { line: number }[] = [];
    const lineOf = (node: ts.Node): number => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;

    const painted = (node: ts.Node): void => {
        if (
            ts.isPropertyAssignment(node) &&
            (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
            node.name.text === 'backgroundColor' &&
            readsThemeRole(node.initializer)
        ) {
            hits.push({ line: lineOf(node) });
        }

        ts.forEachChild(node, painted);
    };

    const inStyleFunction = (node: ts.Node): void => {
        if (ts.isConditionalExpression(node) && mentionsPressed(node.condition)) {
            painted(node.whenTrue);
        } else if (
            ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
            mentionsPressed(node.left)
        ) {
            painted(node.right);
        }

        ts.forEachChild(node, inStyleFunction);
    };

    const visit = (node: ts.Node): void => {
        if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && destructuresPressed(node)) {
            inStyleFunction(node.body);
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return hits;
}

describe('the hand-written press fill reader', () => {
    const cases: readonly { readonly shape: string; readonly source: string; readonly found: readonly string[] }[] = [
        {
            shape: 'a hover surface-muted',
            source: `const c = 'hover:bg-surface-muted';`,
            found: ['hover:bg-surface-muted'],
        },
        {
            shape: 'an active surface-muted',
            source: `const c = 'active:bg-surface-muted';`,
            found: ['active:bg-surface-muted'],
        },
        {
            shape: 'a hover line-divider',
            source: `const c = 'hover:bg-line-divider';`,
            found: ['hover:bg-line-divider'],
        },
        {
            shape: 'a highlighted menu item',
            source: `const c = 'data-[highlighted]:bg-surface-muted';`,
            found: ['data-[highlighted]:bg-surface-muted'],
        },
        {
            shape: 'a focus-visible fill',
            source: `const c = 'focus-visible:bg-surface-muted';`,
            found: ['focus-visible:bg-surface-muted'],
        },
        {
            shape: 'a stacked variant',
            source: `const c = 'md:hover:bg-surface-muted';`,
            found: ['md:hover:bg-surface-muted'],
        },
        {
            shape: 'a hand-picked press role',
            source: `const c = 'hover:bg-press-muted';`,
            found: ['hover:bg-press-muted'],
        },
        {
            shape: 'a press role at rest',
            source: `const c = 'bg-press-paper-overlay';`,
            found: ['bg-press-paper-overlay'],
        },
        { shape: 'a bare ink wash', source: `const c = 'bg-ink/6';`, found: ['bg-ink/6'] },
        { shape: 'a hover ink wash', source: `const c = 'flex hover:bg-ink/6 gap-2';`, found: ['hover:bg-ink/6'] },
        { shape: 'an ink-muted wash', source: `const c = 'hover:bg-ink-muted/10';`, found: ['hover:bg-ink-muted/10'] },
        {
            shape: 'an arbitrary ink opacity',
            source: `const c = 'hover:bg-ink/[0.06]';`,
            found: ['hover:bg-ink/[0.06]'],
        },
        {
            shape: 'a wash in a template head',
            source: 'const c = `flex hover:bg-ink/6 ${x}`;',
            found: ['hover:bg-ink/6'],
        },
        { shape: 'a wash in a template tail', source: 'const c = `${x} hover:bg-ink/6`;', found: ['hover:bg-ink/6'] },
        {
            shape: 'a wash in JSX text',
            source: `const e = <p className="hover:bg-ink/6">x</p>;`,
            found: ['hover:bg-ink/6'],
        },
        {
            shape: 'a resting surface-muted (a surface, not a press)',
            source: `const c = 'bg-surface-muted';`,
            found: [],
        },
        { shape: 'a resting line-divider', source: `const c = 'bg-line-divider';`, found: [] },
        { shape: 'a status tint', source: `const c = 'bg-danger/10 bg-attention-tint';`, found: [] },
        { shape: 'an ink text opacity', source: `const c = 'text-ink/60';`, found: [] },
        { shape: 'a solid ink fill', source: `const c = 'bg-ink text-canvas';`, found: [] },
        { shape: 'the recipe, used', source: `const c = PRESS_FILL_CLASS.pointer;`, found: [] },
        { shape: 'a longer colour name that merely starts with ink', source: `const c = 'bg-inkwell/6';`, found: [] },
        {
            shape: 'a press named in a comment',
            source: `// hover:bg-surface-muted was the old one\nconst c = 1;`,
            found: [],
        },
    ];

    for (const { shape, source, found } of cases) {
        it(`reads ${shape}`, () => {
            expect(handWrittenPresses('fixture.tsx', source).map((hit) => hit.found)).toEqual(found);
        });
    }
});

describe('the native hand-written press fill reader', () => {
    const cases: readonly { readonly shape: string; readonly source: string; readonly lines: readonly number[] }[] = [
        {
            shape: 'a pressed branch painting colors.surfaceMuted',
            source: `const s = ({ pressed }) => [pressed ? { backgroundColor: colors.surfaceMuted } : null];`,
            lines: [1],
        },
        {
            shape: 'a pressed && branch painting theme.colors.<role>',
            source: `const s = ({ pressed }) => [pressed && { backgroundColor: theme.colors.lineDivider }];`,
            lines: [1],
        },
        {
            shape: 'a function-expression style',
            source: `const s = function ({ pressed }) {\n return pressed ? { backgroundColor: colors.canvas } : null; };`,
            lines: [2],
        },
        {
            shape: 'a pressed branch painting the usePressFill() value',
            source: `const s = ({ pressed }) => [pressed ? { backgroundColor: pressFill } : null];`,
            lines: [],
        },
        {
            shape: 'a pressed branch painting a press from the theme (theme.press.<tone>)',
            source: `const s = ({ pressed }) => [pressed ? { backgroundColor: theme.press[tone] } : null];`,
            lines: [],
        },
        {
            shape: 'a resting fill in the same style function (a surface, not a press)',
            source: `const s = ({ pressed }) => [{ backgroundColor: colors.paper }, pressed ? { opacity: 0.5 } : null];`,
            lines: [],
        },
        {
            shape: 'a chosen-state fill beside the press',
            source: `const s = ({ pressed }) => [chosen && { backgroundColor: colors.selectedFill }, pressed && { opacity: 1 }];`,
            lines: [],
        },
        {
            shape: 'colours outside any pressed style function (a resting fill)',
            source: `const s = { backgroundColor: colors.surfaceMuted };\nconst t = (state) => ({ backgroundColor: colors.canvas });`,
            lines: [],
        },
        {
            shape: 'a style function that does not destructure pressed',
            source: `const s = (state) => [state.pressed ? { backgroundColor: colors.surfaceMuted } : null];`,
            lines: [],
        },
        {
            shape: 'a colour named in a comment',
            source: `const s = ({ pressed }) => [pressed ? null : null]; // backgroundColor: colors.surfaceMuted`,
            lines: [],
        },
    ];

    for (const { shape, source, lines } of cases) {
        it(`reads ${shape}`, () => {
            expect(nativeHandWrittenPresses('fixture.native.tsx', source).map((hit) => hit.line)).toEqual(lines);
        });
    }
});

describe('apps write no press fill by hand', () => {
    const modules = appSourceModules().filter((file) => !file.startsWith(RECIPE_DIRECTORY));

    it('discovers the app modules, web and native, where the fills were (a vacuous pass would hide the rule)', () => {
        expect(modules).toContain('packages/apps/commise/web/src/components/home/chrome/HomeSidebar.tsx');
        expect(modules).toContain('packages/apps/commise/features/recipes/src/detail/IngredientCheckRow.tsx');
        expect(modules).toContain('packages/apps/commise/ui/src/button/surfaceClass.ts');
        expect(modules).not.toContain(`${RECIPE_DIRECTORY}surfaceToneClass.ts`);
        expect(modules.length).toBeGreaterThan(500);
        expect(modules.filter((file) => /\.native\.tsx$/u.test(file)).length).toBeGreaterThan(100);
    });

    it('lets no native pressable paint its pressed state from a theme role', () => {
        const offenders = modules
            .filter((file) => /\.native\.tsx?$/u.test(file) && file !== BUTTON_PAINT)
            .flatMap((file) =>
                nativeHandWrittenPresses(file, readFileSync(path.join(repoRoot, file), 'utf8')).map(
                    (hit) => `${file}:${String(hit.line)}`,
                ),
            );

        expect(offenders).toEqual([]);
    });

    it('lets no app module outside the recipe state a press fill', () => {
        const offenders = modules.flatMap((file) =>
            handWrittenPresses(file, readFileSync(path.join(repoRoot, file), 'utf8')).map(
                (hit) => `${file}:${String(hit.line)}  ${hit.found}`,
            ),
        );

        expect(offenders).toEqual([]);
    });
});
