// @vitest-environment node
/**
 * Repo-wide guard: **every corner radius in `packages/apps` is a step of the design system's scale** (8, 12, 18, 24 px:
 * `sm`, `md`, `lg`, `xl`, and the pill, `full`). The role picks the step: notices, cards, menus, popovers and comboboxes
 * are `lg`; dialogs, sheets and full-screen modals are `xl`; pills are `full`.
 *
 * It grew out of `@commise/ui`'s own scan of `rounded-2xl` (16 px, which is on NONE of the steps). That scan read only
 * the design system and left the feature files out as "a follow-up"; there is no such exemption here, and no allow-list
 * for an app file. The scan reads the parsed syntax tree (`offScaleRadius.ts`), so a comment that names a forbidden
 * class is not a violation and a URL string cannot hide one.
 *
 * Mutation lens: write `rounded-2xl` in any app file, a `borderRadius: 16`, a `borderRadius: size / 2` or a `999`, and
 * the file and line are listed.
 */
import { describe, expect, it } from 'vitest';

import { appSources, isOffScaleClass, offScaleRadiusIn, offScaleRadiusUnder } from './offScaleRadius.js';

const scan = (text: string, file = 'Sample.tsx'): readonly string[] =>
    offScaleRadiusIn(file, text).map((hit) => hit.text);

describe('radius scale, every app', () => {
    it('reads the design system, the features and both apps (a vacuous pass would hide the rule)', () => {
        const files = appSources();

        expect(files).toContain('packages/apps/commise/ui/src/sheet/Sheet.tsx');
        expect(files).toContain('packages/apps/commise/features/recipes/src/versions/RecipeConflictView.tsx');
        expect(files).toContain('packages/apps/commise/features/recipes/src/card/RecipeCard.native.tsx');
        expect(files.some((file) => file.startsWith('packages/apps/commise/web/src/'))).toBe(true);
        expect(files.some((file) => file.startsWith('packages/apps/commise/mobile/src/'))).toBe(true);
    });

    it('draws only the scale steps in a Tailwind class or a native radius', () => {
        expect(offScaleRadiusUnder()).toEqual([]);
    });

    it('recognises the classes it forbids', () => {
        for (const token of [
            'rounded',
            'rounded-xs',
            'rounded-2xl',
            'sm:rounded-2xl',
            'rounded-t-3xl',
            'hover:rounded-4xl',
            'rounded-[10px]',
            'md:rounded-b-[calc(var(--radius-md)*2)]',
            'rounded-tl',
            'rounded-[calc(1px+2px)]',
        ]) {
            expect(isOffScaleClass(token), token).toBe(true);
        }

        for (const token of [
            'rounded-sm',
            'rounded-md',
            'rounded-lg',
            'rounded-xl',
            'rounded-full',
            'rounded-none',
            'rounded-t-xl',
            'sm:rounded-b-lg',
            'rounded-[calc(var(--spacing)*5.5)]',
            'rounded-s-full',
            'roundedness',
            'text-rounded',
        ]) {
            expect(isOffScaleClass(token), token).toBe(false);
        }
    });

    it('finds a forbidden class in a string, a template fragment and a JSX attribute', () => {
        expect(scan('const a = "p-4 rounded-2xl";')).toEqual(['rounded-2xl']);
        expect(scan('const a = `flex rounded-3xl ${x}`;')).toEqual(['rounded-3xl']);
        expect(scan('const a = <div className="rounded" />;')).toEqual(['rounded']);
    });

    it('does not read a class name that a substitution completes, or one in a comment', () => {
        expect(scan('const a = `rounded-${size}`;')).toEqual([]);
        expect(scan('// rounded-2xl\n/** rounded-3xl */\nconst a = "rounded-lg";')).toEqual([]);
    });

    it('finds a native radius that is not a token', () => {
        expect(scan('const s = { borderRadius: 16 };')).toEqual(['borderRadius: 16']);
        expect(scan('const s = { borderRadius: 999 };')).toEqual(['borderRadius: 999']);
        expect(scan('const s = { borderRadius: 32 / 2 };')).toEqual(['borderRadius: 32 / 2']);
        expect(scan('const s = { borderRadius: SIZE / 3 };')).toEqual(['borderRadius: SIZE / 3']);
        expect(scan('const s = { borderTopLeftRadius: 24 };')).toEqual(['borderTopLeftRadius: 24']);
        expect(scan('const s = { borderRadius };')).toEqual(['borderRadius']);
        expect(scan("const s = { borderRadius: '50%' };")).toEqual(["borderRadius: '50%'"]);
    });

    it('accepts a token, zero, and a choice between tokens', () => {
        expect(scan('const s = { borderRadius: nativeTokens.radius.md };')).toEqual([]);
        expect(scan('const s = { borderTopLeftRadius: radius.xl, borderRadius: 0 };')).toEqual([]);
        expect(scan('const s = { borderRadius: wide ? radius.lg : radius.full };')).toEqual([]);
        expect(scan('const s = { borderRadius: HEIGHT / 2 };')).toEqual([]);
        expect(scan('const s = { borderRadius: wide ? radius.lg : 8 };')).toEqual([
            'borderRadius: wide ? radius.lg : 8',
        ]);
    });

    // The glyph ruling: a fixed-size mark (the 18 px checkbox) owns a corner no step fits, as a named GLYPH_ constant,
    // and only a module whose JSDoc @pattern names it a Glyph may read one. There is no `xs` step.
    describe('a glyph corner', () => {
        const glyph = (body: string): string => `/**\n * @module x\n *\n * @pattern Glyph — a fixed mark\n */\n${body}`;
        const plain = (body: string): string => `/**\n * @module x\n *\n * @pattern Adapter over a thing\n */\n${body}`;
        const web = 'const a = <span style={{ borderRadius: GLYPH_CORNER }} />;';
        const native = 'const s = { box: { borderRadius: GLYPH_CORNER } };';

        it('is allowed in a module whose @pattern names it a glyph', () => {
            expect(scan(glyph(web))).toEqual([]);
            expect(scan(glyph(native))).toEqual([]);
        });

        it('fails in a module that is not a glyph, with the same value', () => {
            expect(scan(plain(web))).toEqual(['borderRadius: GLYPH_CORNER']);
            expect(scan(plain(native))).toEqual(['borderRadius: GLYPH_CORNER']);
            expect(scan(web)).toEqual(['borderRadius: GLYPH_CORNER']);
        });

        it('does not let a glyph module draw a bare number or a class off the scale', () => {
            expect(scan(glyph('const s = { borderRadius: 4 };'))).toEqual(['borderRadius: 4']);
            expect(scan(glyph('const a = "rounded-[4px]";'))).toEqual(['rounded-[4px]']);
            expect(scan(glyph('const s = { borderRadius: CORNER };'))).toEqual(['borderRadius: CORNER']);
        });

        it('does not take the word in a comment or a later tag for the pattern', () => {
            expect(scan(`// @pattern Glyph\n${web}`)).toEqual(['borderRadius: GLYPH_CORNER']);
            expect(scan(`/** @pattern Adapter */\n/** @pattern Glyph */\n${web}`)).toEqual([
                'borderRadius: GLYPH_CORNER',
            ]);
        });
    });
});
