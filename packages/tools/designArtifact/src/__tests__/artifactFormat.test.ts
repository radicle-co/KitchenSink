import { describe, expect, it } from 'vitest';

import {
    BUNDLE_FORMAT,
    NAMESPACE,
    bundleHeader,
    canvasIndex,
    cardMarker,
    designSystemIndex,
} from '../artifactFormat.js';
import { isDesignArtifactError } from '../errors.js';

describe('constants', () => {
    it('pins the bundle format and namespace the host reads', () => {
        expect(BUNDLE_FORMAT).toBe(4);
        expect(NAMESPACE).toBe('Commise');
    });
});

describe('bundleHeader', () => {
    it('is one block comment holding the format, namespace and component names, then a newline', () => {
        const header = bundleHeader(['Button', 'Chip']);

        expect(header).toBe(
            '/* @ds-bundle: {"format":4,"namespace":"Commise","components":[{"name":"Button"},{"name":"Chip"}]} */\n',
        );
    });

    it('keeps the JSON parseable from the comment body', () => {
        const body = /^\/\* @ds-bundle: (.*) \*\/\n$/.exec(bundleHeader(['A']));

        expect(JSON.parse(body?.[1] ?? '')).toEqual({ format: 4, namespace: 'Commise', components: [{ name: 'A' }] });
    });

    it('lists no components as an empty array', () => {
        expect(bundleHeader([])).toContain('"components":[]');
    });

    it('throws unsafe-header when a name would close the comment early', () => {
        expect.assertions(2);

        try {
            bundleHeader(['Evil*/Name']);
        } catch (error) {
            expect(isDesignArtifactError(error)).toBe(true);
            expect(isDesignArtifactError(error) && error.code).toBe('unsafe-header');
        }
    });
});

describe('cardMarker', () => {
    it('writes the marker line the host reads', () => {
        expect(cardMarker({ group: 'Actions', height: 330 })).toBe('<!-- @dsCard group="Actions" height=330 -->');
    });

    it.each([
        ['a double quote', { group: 'Ac"tions', height: 10 }],
        ['a comment terminator', { group: 'x --> y', height: 10 }],
        ['zero height', { group: 'A', height: 0 }],
        ['a fractional height', { group: 'A', height: 10.5 }],
        ['a negative height', { group: 'A', height: -1 }],
        ['an empty group', { group: '', height: 10 }],
    ])('refuses %s', (_label, spec) => {
        expect(() => cardMarker(spec)).toThrowError(/./u);

        try {
            cardMarker(spec);
        } catch (error) {
            expect(isDesignArtifactError(error) && error.code).toBe('unsafe-header');
        }
    });
});

describe('designSystemIndex', () => {
    const index = designSystemIndex({
        title: 'KitchenSink Design System',
        now: '2026-10-16T03:40:01Z',
        libraries: [{ name: 'react', version: '18' }],
    });

    it('is the version-3 files-layout document the host expects', () => {
        expect(index).toEqual({
            v: 3,
            assetGroups: {},
            blobs: {},
            createdOnFiles: { at: '2026-10-16T03:40:01Z', v: 1 },
            docs: { readme: 'project/README.md', sections: [] },
            groups: [],
            lastChange: expect.objectContaining({ at: '2026-10-16T03:40:01Z' }),
            layout: 'files',
            libraries: [{ name: 'react', version: '18' }],
            namespace: 'Commise',
            sections: {},
            title: 'KitchenSink Design System',
        });
    });

    it('does not alias the caller libraries array', () => {
        const libraries = [{ name: 'react', version: '18' }];
        const built = designSystemIndex({ title: 't', now: 'n', libraries });

        libraries.push({ name: 'x', version: '1' });

        expect(built.libraries).toHaveLength(1);
    });
});

describe('canvasIndex', () => {
    const boards = {
        'Home.dc.html': { x: 0, y: 0, w: 1280, h: 962, title: 'Home (web)', expand: 'fill' },
        'HomeMobile.dc.html': { x: 1360, y: 0, w: 390, h: 1388, title: 'Home (mobile)' },
    };
    const notes = { row0: { x: 0, y: -260, text: 'Home', kind: 'title1', maxW: 2400 } };
    const designSystem = {
        title: 'KitchenSink Design System',
        namespace: 'Commise',
        artifact: 'https://claude.ai/artifact/abc',
        version: '1-abcd',
        copiedAt: '2026-10-16T20:51:26Z',
    };

    it('orders the boards as given and carries notes and the design system reference', () => {
        const index = canvasIndex({
            title: 'Commise Screens',
            now: '2026-10-16T11:18:04Z',
            boards,
            notes,
            designSystem,
        });

        expect(index).toEqual({
            v: 3,
            createdOnFiles: { v: 1, at: '2026-10-16T11:18:04Z' },
            title: 'Commise Screens',
            launch: { view: 'canvas' },
            pages: [],
            boards,
            order: ['Home.dc.html', 'HomeMobile.dc.html'],
            notes,
            designSystems: [designSystem],
        });
    });

    it('lists no design systems when none is linked yet', () => {
        const index = canvasIndex({ title: 't', now: 'n', boards, notes, designSystem: undefined });

        expect(index.designSystems).toEqual([]);
    });
});
