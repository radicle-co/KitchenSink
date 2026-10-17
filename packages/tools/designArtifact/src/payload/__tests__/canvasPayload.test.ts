import { describe, expect, it } from 'vitest';

import { BOARDS } from '../../canvas/boards.js';
import { buildTokens } from '../../tokens/buildTokens.js';
import { canvasPayload } from '../canvasPayload.js';
import type { CanvasInputs } from '../canvasPayload.js';

const tokens = buildTokens();
const inputs: CanvasInputs = {
    boards: BOARDS.map((board) => ({ file: board.file, html: `<!-- ${board.file} -->` })),
    specs: BOARDS,
    bundleJs: '/* js */',
    bundleCss: '/* css */',
    tokens,
    fonts: [{ file: 'Inter_400Regular.ttf', bytes: new Uint8Array([1]) }],
    licences: [{ file: 'OFL-Inter.txt', bytes: new Uint8Array([2]) }],
    authFood: new Uint8Array([9, 9]),
    now: '2026-10-16T12:00:00Z',
    designSystem: { artifact: 'https://claude.ai/artifact/XYZ', version: 'v1' },
};

describe('canvasPayload', () => {
    const files = canvasPayload(inputs);

    it('carries every board file under its own name', () => {
        for (const board of BOARDS) {
            expect(files.get(board.file), board.file).toBe(`<!-- ${board.file} -->`);
        }
    });

    it('carries the design-system copy under ds/commise, where the boards load it from', () => {
        expect(files.get('ds/commise/bundle.js')).toBe('/* js */');
        expect(files.get('ds/commise/bundle.css')).toBe('/* css */');
        expect(JSON.parse(String(files.get('ds/commise/tokens.json')))).toEqual(JSON.parse(JSON.stringify(tokens)));
        expect(String(files.get('ds/commise/tokens.css'))).toContain('[data-theme="dark"]{');
        expect(files.get('ds/commise/fonts/Inter_400Regular.ttf')).toEqual(new Uint8Array([1]));
        expect(files.get('ds/commise/fonts/OFL-Inter.txt')).toEqual(new Uint8Array([2]));
    });

    it('carries the auth photo the sign-in boards show', () => {
        expect(files.get('assets/authFood.jpg')).toEqual(new Uint8Array([9, 9]));
    });

    it('has nothing else', () => {
        const expected = new Set([
            ...BOARDS.map((b) => b.file),
            'canvas.json',
            'ds/commise/bundle.js',
            'ds/commise/bundle.css',
            'ds/commise/tokens.json',
            'ds/commise/tokens.css',
            'ds/commise/fonts/Inter_400Regular.ttf',
            'ds/commise/fonts/OFL-Inter.txt',
            'assets/authFood.jpg',
        ]);

        expect(new Set(files.keys())).toEqual(expected);
    });

    describe('canvas.json', () => {
        const canvas = JSON.parse(String(files.get('canvas.json'))) as {
            title: string;
            order: string[];
            boards: Record<string, { x: number; y: number }>;
            notes: Record<string, unknown>;
            designSystems: unknown[];
            createdOnFiles: { at: string };
        };

        it('lists the boards in registry order at their laid-out positions, with a note per row', () => {
            expect(canvas.title).toBe('Commise Screens');
            expect(canvas.order).toEqual(BOARDS.map((b) => b.file));
            expect(canvas.boards['Discover.dc.html']).toMatchObject({ x: 0, y: 3639 });
            expect(Object.keys(canvas.notes)).toHaveLength(36);
            expect(canvas.createdOnFiles.at).toBe('2026-10-16T12:00:00Z');
        });

        it('links the design-system artifact it was copied against', () => {
            expect(canvas.designSystems).toEqual([
                {
                    title: 'KitchenSink Design System',
                    namespace: 'commise',
                    artifact: 'https://claude.ai/artifact/XYZ',
                    version: 'v1',
                    copiedAt: '2026-10-16T12:00:00Z',
                },
            ]);
        });
    });

    it('links no design system when none was given: the absent reference is reachable from the build', () => {
        const { designSystem: _omitted, ...withoutReference } = inputs;
        const canvas = JSON.parse(String(canvasPayload(withoutReference).get('canvas.json'))) as {
            designSystems: unknown[];
        };

        expect(canvas.designSystems).toEqual([]);
    });

    it('fails when the registry names a board that was not read, rather than publishing a canvas with a hole', () => {
        expect(() => canvasPayload({ ...inputs, boards: inputs.boards.slice(1) })).toThrowError(/Home\.dc\.html/u);
    });

    it('fails when a board was read that the registry does not place', () => {
        expect(() =>
            canvasPayload({ ...inputs, boards: [...inputs.boards, { file: 'Stray.dc.html', html: '' }] }),
        ).toThrowError(/Stray\.dc\.html/u);
    });
});
