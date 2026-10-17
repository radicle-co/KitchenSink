import { describe, expect, it } from 'vitest';

import { exportedTypeDeclarations, propsIndex, stripImports } from '../propsIndex.js';

describe('stripImports', () => {
    it('removes single-line and multi-line imports but keeps the module docblock above them', () => {
        const source = `/** @module x — the contract. */
import type { A } from './a.js';
import type {
    B,
    C,
} from './b.js';

export interface P {
    readonly a: A;
}
`;

        expect(stripImports(source)).toBe(`/** @module x — the contract. */

export interface P {
    readonly a: A;
}`);
    });

    it('leaves a file without imports as it was, trimmed', () => {
        expect(stripImports('export type T = 1;\n\n')).toBe('export type T = 1;');
    });
});

describe('exportedTypeDeclarations', () => {
    const source = `import type { X } from './x.js';
const hidden = 1;
/** Props for {@link Foo}. */
export interface FooProps {
    readonly label: string;
}
interface NotExported { a: 1 }
// the alias
export type Mode = 'a' | 'b';
export function Foo(): void {}
export const LIMIT = 3;
`;

    it('keeps exported interfaces and type aliases with their comments, and nothing else', () => {
        expect(exportedTypeDeclarations(source)).toBe(`/** Props for {@link Foo}. */
export interface FooProps {
    readonly label: string;
}

// the alias
export type Mode = 'a' | 'b';`);
    });

    it('is empty for a file that exports no type', () => {
        expect(exportedTypeDeclarations('export const A = 1;\n')).toBe('');
    });
});

describe('propsIndex', () => {
    it('opens with the two orientation comments and gives each section a heading, in the order given', () => {
        const text = propsIndex([
            { heading: '@commise/ui/button', source: 'export type A = 1;' },
            { heading: '@commise/ui/chip', source: 'export type B = 2;' },
        ]);

        expect(text.startsWith('// Props contracts of the Commise design system')).toBe(true);
        expect(text).toContain('// Web: window.Commise.<Name>. Native');
        expect(text.indexOf('// ==== @commise/ui/button ====\nexport type A = 1;')).toBeGreaterThan(0);
        expect(text.indexOf('// ==== @commise/ui/button ====')).toBeLessThan(
            text.indexOf('// ==== @commise/ui/chip ===='),
        );
        expect(text.endsWith('export type B = 2;\n')).toBe(true);
    });

    it('drops a section whose source is empty, so a heading never stands over nothing', () => {
        const text = propsIndex([
            { heading: 'empty', source: '' },
            { heading: 'full', source: 'export type A = 1;' },
        ]);

        expect(text).not.toContain('empty');
        expect(text).toContain('// ==== full ====');
    });
});
