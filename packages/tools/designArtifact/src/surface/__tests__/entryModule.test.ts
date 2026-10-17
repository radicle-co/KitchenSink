import { describe, expect, it } from 'vitest';

import { entryModule } from '../entryModule.js';

describe('entryModule', () => {
    it('re-exports each name from its file, extension swapped to .js, one line per file', () => {
        const source = entryModule([
            { name: 'Button', file: '/ui/src/button/Button.tsx', kind: 'component' },
            { name: 'Chip', file: '/ui/src/chip/Chip.native.tsx', kind: 'component' },
        ]);

        expect(source).toBe(
            [
                'export { Button } from "/ui/src/button/Button.js";',
                'export { Chip } from "/ui/src/chip/Chip.native.js";',
                '',
            ].join('\n'),
        );
    });

    it('groups names that share a file into one statement, in entry order', () => {
        const source = entryModule([
            { name: 'FabFace', file: '/a/FabFace.tsx', kind: 'component' },
            { name: 'CreateFab', file: '/a/CreateFab.tsx', kind: 'component' },
            { name: 'FabLabel', file: '/a/FabFace.tsx', kind: 'component' },
        ]);

        expect(source).toBe(
            [
                'export { FabFace, FabLabel } from "/a/FabFace.js";',
                'export { CreateFab } from "/a/CreateFab.js";',
                '',
            ].join('\n'),
        );
    });

    it('maps a .ts file to .js too (a hook entry)', () => {
        expect(entryModule([{ name: 'useSnackbar', file: '/ui/useSnackbar.ts', kind: 'hook' }])).toBe(
            'export { useSnackbar } from "/ui/useSnackbar.js";\n',
        );
    });

    it('quotes a path safely', () => {
        expect(entryModule([{ name: 'X', file: "/odd'dir/X.tsx", kind: 'component' }])).toBe(
            'export { X } from "/odd\'dir/X.js";\n',
        );
    });

    it('is empty for no entries', () => {
        expect(entryModule([])).toBe('');
    });

    it('rejects a file that is not a ts or tsx source', () => {
        expect(() => entryModule([{ name: 'X', file: '/a/X.css', kind: 'component' }])).toThrowError(/X\.css/u);
    });
});
