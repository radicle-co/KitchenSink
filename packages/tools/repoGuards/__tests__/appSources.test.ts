/**
 * The shared reader behind the `packages/apps` source guards (`pressFillRecipe`, `focusRingRecipe`, `surfaceContainer`,
 * `popupSurface`, `pressWashLiterals`, `offScaleRadius`, `typeScaleLiterals`). Three guards used to carry their own copy of
 * "list the app modules" and of "visit every string-like node"; copies drift (one gained an exclusion the others
 * lacked), and a guard that silently stops reading a file passes vacuously. This pins what the one copy includes and
 * excludes, and what a string-like node is.
 */
import { describe, expect, it } from 'vitest';

import { APP_SOURCE_EXCLUDED, appSourceModules, classTokensOf, stringLikeTexts } from './appSources.js';

describe('appSourceModules', () => {
    const modules = appSourceModules();

    it('reads the design system, the features and both apps, web and native', () => {
        expect(modules).toContain('packages/apps/commise/ui/src/button/surfaceClass.ts');
        expect(modules).toContain('packages/apps/commise/ui/src/sheet/BottomSheetPanel.native.tsx');
        expect(modules).toContain('packages/apps/commise/features/recipes/src/detail/IngredientCheckRow.tsx');
        expect(modules.some((file) => file.startsWith('packages/apps/commise/web/src/'))).toBe(true);
        expect(modules.some((file) => file.startsWith('packages/apps/commise/mobile/src/'))).toBe(true);
        expect(modules.length).toBeGreaterThan(500);
    });

    it('leaves out tests, fixtures, declaration files, build output and non-TypeScript', () => {
        for (const file of modules) {
            expect(file, file).toMatch(/\.tsx?$/u);
            expect(file, file).not.toMatch(APP_SOURCE_EXCLUDED);
            expect(file.endsWith('.d.ts'), file).toBe(false);
        }
    });

    it('excludes by the one rule', () => {
        for (const excluded of [
            'packages/apps/commise/ui/src/button/__tests__/Button.test.tsx',
            'packages/apps/commise/ui/src/tokens/__fixtures__/redesignValues.ts',
            'packages/apps/commise/web/tests/e2e/home.spec.ts',
            'packages/apps/commise/web/src/thing.test.ts',
            'packages/apps/commise/mobile/android/app/x.ts',
            'packages/apps/commise/web/.next/server/x.ts',
        ]) {
            expect(APP_SOURCE_EXCLUDED.test(excluded), excluded).toBe(true);
        }

        for (const included of [
            'packages/apps/commise/ui/src/button/Button.tsx',
            'packages/apps/commise/web/src/app/[locale]/page.tsx',
        ]) {
            expect(APP_SOURCE_EXCLUDED.test(included), included).toBe(false);
        }
    });
});

describe('stringLikeTexts', () => {
    const texts = (source: string, file = 'fixture.tsx'): readonly string[] =>
        stringLikeTexts(file, source).map((hit) => hit.text);

    it('reads string literals, template fragments and JSX text, and not comments', () => {
        expect(texts(`const a = 'one'; const b = "two"; const c = \`three\`;`)).toEqual(['one', 'two', 'three']);
        expect(texts('const d = `head ${x} mid ${y} tail`;')).toEqual(['head ', ' mid ', ' tail']);
        expect(texts(`const e = <p className="cls">words</p>;`)).toEqual(['cls', 'words']);
        expect(texts(`// not 'this'\n/* nor 'that' */ const f = 1;`)).toEqual([]);
    });

    it('marks a template fragment that runs into a substitution as open-ended, and only those', () => {
        const hits = stringLikeTexts('fixture.ts', 'const d = `head ${x} mid ${y} tail`; const s = "plain";');

        expect(hits.map((hit) => [hit.text, hit.openEnded])).toEqual([
            ['head ', true],
            [' mid ', true],
            [' tail', false],
            ['plain', false],
        ]);
    });

    it('reports the 1-based line of the node', () => {
        expect(stringLikeTexts('fixture.ts', `const a = 1;\n\nconst b = 'x';`).map((hit) => hit.line)).toEqual([3]);
    });

    it('parses a .ts file as TypeScript and a .tsx file as TSX', () => {
        expect(texts('const a = <T,>(x: T) => "ok";', 'fixture.ts')).toEqual(['ok']);
    });
});

describe('classTokensOf', () => {
    it('splits on whitespace', () => {
        expect(classTokensOf('flex  gap-2\nitems-center', false)).toEqual(['flex', 'gap-2', 'items-center']);
    });

    it('drops the unfinished last token of an open-ended fragment, and keeps a finished one', () => {
        expect(classTokensOf('flex hover:bg-', true)).toEqual(['flex']);
        expect(classTokensOf('flex hover:bg-surface-muted ', true)).toEqual(['flex', 'hover:bg-surface-muted']);
        expect(classTokensOf('flex hover:bg-surface-muted', false)).toEqual(['flex', 'hover:bg-surface-muted']);
    });
});
