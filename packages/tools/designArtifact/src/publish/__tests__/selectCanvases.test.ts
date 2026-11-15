import { describe, expect, it } from 'vitest';

import { selectCanvases } from '../selectCanvases.js';

const canvases = [
    { id: 'homeWeb', url: 'https://claude.ai/artifact/a', folder: 'homeWeb' },
    { id: 'homeMobile', url: 'https://claude.ai/artifact/b', folder: 'homeMobile' },
];
const PATH = 'docs/design/canvases';

describe('selectCanvases', () => {
    it('picks the canvases whose folder changed, once each, in registry order', () => {
        const changed = [
            `${PATH}/homeMobile/project/A.dc.html`,
            `${PATH}/homeWeb/snapshot.json`,
            `${PATH}/homeWeb/project/B.css`,
        ];

        expect(selectCanvases(canvases, changed, undefined).map((canvas) => canvas.id)).toEqual([
            'homeWeb',
            'homeMobile',
        ]);
    });

    it('ignores changes outside a canvas folder, a deleted folder and a folder that only shares a prefix', () => {
        const changed = [
            `${PATH}/registry.json`,
            `${PATH}/gone/project/A.css`,
            `${PATH}/homeWebExtra/project/A.css`,
            'README.md',
        ];

        expect(selectCanvases(canvases, changed, undefined)).toEqual([]);
    });

    it('selects every canvas for "all", whatever changed', () => {
        expect(selectCanvases(canvases, [], 'all')).toEqual(canvases);
    });

    it('selects the named canvases for a list of ids', () => {
        expect(selectCanvases(canvases, [], 'homeMobile').map((canvas) => canvas.id)).toEqual(['homeMobile']);
    });

    it('refuses an id that is not a canvas, so a typo cannot select nothing', () => {
        expect(() => selectCanvases(canvases, [], 'homeWeb,nope')).toThrow('nope');
    });
});
