import { describe, expect, it } from 'vitest';

import type { ResolvedContentSource } from '../contentSource.js';
import { buildNavbarItems } from '../navbarItems.js';

const handbook: ResolvedContentSource = {
    id: 'handbook',
    label: 'Handbook',
    routeBasePath: '/handbook',
    state: 'present',
    mountPath: 'docs',
    include: ['**/*.md'],
};

const infrastructure: ResolvedContentSource = {
    id: 'infrastructure',
    label: 'Infrastructure',
    routeBasePath: '/infrastructure',
    state: 'awaitingGeneration',
    mountPath: 'packages/tools/docs-site/content/awaiting/infrastructure',
    include: ['**/*.md'],
    expectedPath: 'docs/generated/infrastructure',
};

describe('buildNavbarItems', () => {
    it('addresses each section by its sidebar, so the link lands on the first document', () => {
        // A bare `to: '/handbook'` would 404 for any corpus with no doc slugged `/` — and the
        // generated corpora are written by other tools, so the site cannot assume one exists.
        expect(buildNavbarItems([handbook])).toEqual([
            {
                type: 'docSidebar',
                docsPluginId: 'handbook',
                sidebarId: 'sections',
                position: 'left',
                label: 'Handbook',
            },
        ]);
    });

    it('still emits a link for an awaiting section, because the placeholder route is real', () => {
        const [item] = buildNavbarItems([infrastructure]);

        expect(item?.docsPluginId).toBe('infrastructure');
        expect(item?.label).toBe('Infrastructure');
    });

    it('preserves source order', () => {
        expect(buildNavbarItems([infrastructure, handbook]).map((item) => item.label)).toEqual([
            'Infrastructure',
            'Handbook',
        ]);
    });

    it('emits nothing for an empty registry rather than inventing a link', () => {
        expect(buildNavbarItems([])).toEqual([]);
    });
});
