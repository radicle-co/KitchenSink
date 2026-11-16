import { describe, expect, it } from 'vitest';

import { changedRegistryIds, selectCanvases } from '../selectCanvases.js';

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

        expect(selectCanvases(canvases, changed, undefined, new Set()).map((canvas) => canvas.id)).toEqual([
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

        expect(selectCanvases(canvases, changed, undefined, new Set())).toEqual([]);
    });

    it('selects a canvas whose registry entry changed, though no folder file did', () => {
        const picked = selectCanvases(canvases, [`${PATH}/registry.json`], undefined, new Set(['homeMobile']));

        expect(picked.map((canvas) => canvas.id)).toEqual(['homeMobile']);
    });

    it('selects every canvas for "all", whatever changed', () => {
        expect(selectCanvases(canvases, [], 'all', new Set())).toEqual(canvases);
    });

    it('selects the named canvases for a list of ids', () => {
        expect(selectCanvases(canvases, [], 'homeMobile', new Set()).map((canvas) => canvas.id)).toEqual([
            'homeMobile',
        ]);
    });

    it('refuses an id that is not a canvas, so a typo cannot select nothing', () => {
        expect(() => selectCanvases(canvases, [], 'homeWeb,nope', new Set())).toThrow('nope');
    });
});

describe('changedRegistryIds', () => {
    const registry = (...entries: object[]): string => JSON.stringify({ canvases: entries });
    const web = { id: 'homeWeb', url: 'https://claude.ai/artifact/a', source: 'repo-canvas', folder: 'homeWeb' };
    const mobile = {
        id: 'homeMobile',
        url: 'https://claude.ai/artifact/b',
        source: 'repo-canvas',
        folder: 'homeMobile',
    };

    it('is empty when no entry differs, whatever the key order', () => {
        const reordered = { folder: 'homeWeb', source: 'repo-canvas', url: web.url, id: 'homeWeb' };

        expect(changedRegistryIds(registry(web, mobile), registry(reordered, mobile))).toEqual([]);
    });

    it('names an entry whose field changed, and only that one', () => {
        expect(changedRegistryIds(registry(web, mobile), registry(web, { ...mobile, url: 'https://x' }))).toEqual([
            'homeMobile',
        ]);
    });

    it('names an entry that was added, and treats a missing merge-base registry as all added', () => {
        expect(changedRegistryIds(registry(web), registry(web, mobile))).toEqual(['homeMobile']);
        expect(changedRegistryIds(null, registry(web, mobile))).toEqual(['homeWeb', 'homeMobile']);
    });

    it('does not name a removed entry, because there is nothing left to render', () => {
        expect(changedRegistryIds(registry(web, mobile), registry(web))).toEqual([]);
    });
});
