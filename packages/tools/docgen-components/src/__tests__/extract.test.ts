/**
 * The EXTRACTION tier, driven against real `.tsx` fixtures rather than string literals — the thing under test
 * is a TypeScript program's reading of source files, and a string fixture would not exercise the type
 * checker, the JSX parse, or the cross-file prop contract that `Badge.tsx` and `Badge.native.tsx` share.
 *
 * Each fixture pins a shape that has a KNOWN way of going wrong:
 *  - `Badge` — the cross-platform pair whose two leaves must both be seen, with the contract they share.
 *  - `Undocumented` — no docblock anywhere, which must be REPORTED as empty rather than omitted.
 *  - `DataTable` — a generic component with a union and a nested readonly object, where a naive extractor
 *    degrades every prop to `any`.
 *  - `IconGlyph` — props that EXTEND React's `SVGProps`, where an unfiltered extractor buries the one real
 *    prop under ~250 inherited DOM props.
 *  - `NoProps` — a propless, undocumented default export, which `react-docgen-typescript` drops entirely.
 *  - `Orchestrator` — a ref, a boolean prop selecting between two rendered subtrees, an undocumented prop.
 *  - `Diverged` / `Orphan` — the two cross-platform failures §14 cares about: leaves whose contracts have
 *    drifted apart, and a leaf with no sibling at all.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../config.js';
import { extractImplementations, loadCompilerOptions } from '../extract.js';
import type { ComponentImplementation } from '../model.js';

const PACKAGE_DIR = join(import.meta.dirname, '..', '..');
const FIXTURE_DIR = join(import.meta.dirname, '..', '__fixtures__', 'components');

const fixture = (name: string): string => join(FIXTURE_DIR, name);

const FIXTURE_FILES = [
    fixture('Badge.tsx'),
    fixture('Badge.native.tsx'),
    fixture('DataTable.tsx'),
    fixture('Diverged.tsx'),
    fixture('Diverged.native.tsx'),
    fixture('IconGlyph.tsx'),
    fixture('NoProps.tsx'),
    fixture('Orchestrator.tsx'),
    fixture('Orphan.native.tsx'),
    fixture('Undocumented.tsx'),
];

const extracted: readonly ComponentImplementation[] = extractImplementations({
    repoRoot: REPO_ROOT,
    packageDir: PACKAGE_DIR,
    compilerOptions: loadCompilerOptions(PACKAGE_DIR),
    files: FIXTURE_FILES,
});

/** Find one implementation by component name and platform, failing loudly rather than returning undefined. */
function one(name: string, platform: 'web' | 'native'): ComponentImplementation {
    const found = extracted.filter((item) => item.name === name && item.platform === platform);
    expect(found, `expected exactly one ${platform} ${name}`).toHaveLength(1);

    return found[0] as ComponentImplementation;
}

describe('extractImplementations', () => {
    it('finds every fixture component, including the zero-prop default export the library cannot see', () => {
        expect(extracted.map((item) => `${item.name}:${item.platform}`).sort()).toEqual([
            'Badge:native',
            'Badge:web',
            'DataTable:web',
            'Diverged:native',
            'Diverged:web',
            'IconGlyph:web',
            'NoProps:web',
            'Orchestrator:web',
            'Orphan:native',
            'Undocumented:web',
        ]);
    });

    it('reports the platform from the file suffix, never from the directory', () => {
        expect(one('Badge', 'native').sourcePath).toMatch(/Badge\.native\.tsx$/);
        expect(one('Badge', 'web').sourcePath).toMatch(/Badge\.tsx$/);
    });

    it('emits repo-relative source paths, so the artifact is portable between checkouts', () => {
        expect(one('Badge', 'web').sourcePath).toBe(
            'packages/tools/docgen-components/src/__fixtures__/components/Badge.tsx',
        );
    });

    it("carries the component's own JSDoc summary", () => {
        expect(one('Badge', 'web').description).toBe('The fixture badge — web leaf.');
    });

    it('carries the module docblock and its tags, which the props library does not expose', () => {
        const badge = one('Badge', 'web');
        expect(badge.moduleDoc).toContain('A pure presentational chip');
        expect(badge.moduleTags).toContainEqual({ name: 'pattern', text: 'Value Object' });
        expect(badge.moduleTags.some((tag) => tag.name === 'module')).toBe(true);
    });

    it('reads the shared cross-platform contract on BOTH leaves, with types, defaults and descriptions', () => {
        for (const platform of ['web', 'native'] as const) {
            const props = one('Badge', platform).props;
            expect(props.map((prop) => prop.name).sort()).toEqual(['children', 'compact', 'tone']);

            const tone = props.find((prop) => prop.name === 'tone');
            expect(tone?.required).toBe(false);
            expect(tone?.defaultValue).toBe('neutral');
            expect(tone?.description).toBe('Visual tier. Defaults to `neutral`.');
            expect(tone?.typeDetail).toEqual(['"neutral"', '"success"', '"warning"']);

            const children = props.find((prop) => prop.name === 'children');
            expect(children?.required).toBe(true);
            expect(children?.type).toBe('ReactNode');
        }
    });

    it('names the file a prop is DECLARED in, so a shared contract is traceable to its own module', () => {
        const tone = one('Badge', 'web').props.find((prop) => prop.name === 'tone');
        expect(tone?.declaredIn).toBe('packages/tools/docgen-components/src/__fixtures__/components/badgeProps.ts');
    });

    it('resolves generic and union props to their real types rather than degrading them to any', () => {
        const props = one('DataTable', 'web').props;
        expect(props.map((prop) => prop.name).sort()).toEqual(['columns', 'empty', 'onSortChange', 'rows', 'sort']);
        expect(props.every((prop) => prop.type !== 'any')).toBe(true);
        expect(props.find((prop) => prop.name === 'columns')?.type).toBe('readonly DataTableColumn<TRow>[]');
        expect(props.find((prop) => prop.name === 'onSortChange')?.type).toBe('((next: DataTableSort) => void)');
    });

    // React's own props are React's documentation. Without the filter this ONE component contributes ~250
    // inherited DOM props and its own contract is unreadable — measured at 640 -> 1,127 props across
    // `@commise/features-recipes`, the majority `ReactEventHandler<SVGSVGElement>`.
    it("documents a component's OWN props, not the React element props its type extends", () => {
        const props = one('IconGlyph', 'web').props;

        expect(props.map((prop) => prop.name)).toEqual(['glyph']);
        expect(props[0]?.typeDetail).toEqual(['"check"', '"plus"']);
    });

    it('records a component with no documentation as empty strings, and never drops it', () => {
        const undocumented = one('Undocumented', 'web');
        expect(undocumented.description).toBe('');
        expect(undocumented.moduleDoc).toBe('');
        expect(undocumented.props.map((prop) => prop.description)).toEqual(['', '']);
    });

    it('keeps the propless, undocumented default export the library drops entirely', () => {
        const noProps = one('NoProps', 'web');
        expect(noProps.props).toEqual([]);
        expect(noProps.exportKind).toBe('default');
        expect(noProps.detectedBy).toBe('compiler-fallback');
        expect(noProps.description).toBe('');
        expect(noProps.moduleDoc).toContain('a zero-prop default export with NO JSDoc of its own');
    });

    it('records how a component was detected, so the library gap is visible rather than silent', () => {
        expect(one('Badge', 'web').detectedBy).toBe('react-docgen-typescript');
        expect(one('Badge', 'web').exportKind).toBe('named');
    });

    it('reports the ref APIs a module reaches for — refs are near-forbidden', () => {
        expect(one('Orchestrator', 'web').usesRefApi).toEqual(['useRef']);
        expect(one('Badge', 'web').usesRefApi).toEqual([]);
    });

    it('reports a boolean prop that selects between two rendered subtrees, and only that prop', () => {
        expect(one('Orchestrator', 'web').booleanPropsSelectingSubtree).toEqual(['compactMode']);
        expect(one('Badge', 'web').booleanPropsSelectingSubtree).toEqual([]);
    });

    it('surfaces the raw layer signals in the docblock instead of guessing silently', () => {
        expect(one('Orchestrator', 'web').docSignals).toEqual({ presentational: true, orchestration: true });
        expect(one('Badge', 'web').docSignals).toEqual({ presentational: true, orchestration: false });
        expect(one('Undocumented', 'web').docSignals).toEqual({ presentational: false, orchestration: false });
    });
});
