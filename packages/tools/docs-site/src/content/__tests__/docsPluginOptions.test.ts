import { describe, expect, it } from 'vitest';

import type { ResolvedContentSource } from '../contentSource.js';
import { buildDocsPluginOptions } from '../docsPluginOptions.js';

const present: ResolvedContentSource = {
    id: 'handbook',
    label: 'Handbook',
    routeBasePath: '/handbook',
    state: 'present',
    mountPath: 'docs',
    include: ['architecture/**/*.md'],
};

const awaiting: ResolvedContentSource = {
    id: 'infrastructure',
    label: 'Infrastructure',
    routeBasePath: '/infrastructure',
    state: 'awaitingGeneration',
    mountPath: 'packages/tools/docs-site/content/awaiting/infrastructure',
    include: ['**/*.md'],
    expectedPath: 'docs/generated/infrastructure',
};

describe('buildDocsPluginOptions', () => {
    it('rebases the repo-relative mount path onto the site directory, so nothing is copied', () => {
        const options = buildDocsPluginOptions(present, '../../..');

        // The single most important assertion in this file: Docusaurus reads the ADRs where they
        // LIVE. A second copy under the site is the drift this repo keeps paying for.
        expect(options.path).toBe('../../../docs');
    });

    it('carries the allowlist through verbatim, so a new working-notes directory cannot leak in', () => {
        expect(buildDocsPluginOptions(present, '../../..').include).toEqual(['architecture/**/*.md']);
    });

    it('names the plugin instance after the source, because the navbar addresses it by that id', () => {
        expect(buildDocsPluginOptions(present, '../../..').id).toBe('handbook');
    });

    it('serves the source at its declared route', () => {
        expect(buildDocsPluginOptions(present, '../../..').routeBasePath).toBe('/handbook');
    });

    it('points every instance at the one shared sidebar, so navigation is derived and never authored', () => {
        expect(buildDocsPluginOptions(present, '../../..').sidebarPath).toBe('./sidebars.ts');
    });

    it('mounts the placeholder — not the ungenerated path — for an awaiting source', () => {
        const options = buildDocsPluginOptions(awaiting, '../../..');

        expect(options.path).toBe('../../../packages/tools/docs-site/content/awaiting/infrastructure');
        expect(options.routeBasePath).toBe('/infrastructure');
    });

    it('does not fabricate an edit link into a directory that may not be the source of truth', () => {
        expect(buildDocsPluginOptions(awaiting, '../../..')).not.toHaveProperty('editUrl');
    });
});
