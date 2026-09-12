import { globSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONTENT_SOURCES } from '../contentRegistry.js';
import { loadContentSources } from '../loadContentSources.js';
import { REPO_ROOT } from '../paths.js';

/**
 * This suite crosses the boundary the resolver's unit tests deliberately mock away: it runs the real
 * adapter against the real repository. A mocked predicate can prove the POLICY and can prove nothing
 * about whether the adapter looks in the right place, spells the glob correctly, or survives a
 * directory that does not exist — and every one of those has to hold for the site to build at all.
 */
describe('loadContentSources (real filesystem, real registry)', () => {
    const resolved = loadContentSources();

    it('resolves one source per registry entry, in order', () => {
        expect(resolved.map((source) => source.id)).toEqual(CONTENT_SOURCES.map((source) => source.id));
    });

    it('finds the hand-written handbook present, which is what makes the site worth building', () => {
        expect(resolved.find((source) => source.id === 'handbook')?.state).toBe('present');
    });

    it.each(CONTENT_SOURCES.filter((source) => source.availability === 'generated'))(
        'agrees with the filesystem about whether "$id" has been generated',
        (source) => {
            // Derived from disk rather than hard-coded, so the assertion stays true both before and
            // after the sibling generators land — and still fails if the adapter looks elsewhere.
            const generated = globSync('**/*.{md,mdx}', { cwd: join(REPO_ROOT, source.contentPath) }).length > 0;
            const entry = resolved.find((candidate) => candidate.id === source.id);

            expect(entry?.state).toBe(generated ? 'present' : 'awaitingGeneration');
        },
    );

    it('mounts a real, non-empty directory for every source whatever its state', () => {
        for (const source of resolved) {
            expect(
                globSync('**/*.{md,mdx}', { cwd: join(REPO_ROOT, source.mountPath) }),
                source.mountPath,
            ).not.toHaveLength(0);
        }
    });

    it('survives an absent directory instead of throwing ENOENT at config-load time', () => {
        // The generated directories legitimately do not exist yet. If the adapter probed with
        // `readdirSync` this whole module would throw before Docusaurus ever started.
        expect(() => loadContentSources()).not.toThrow();
    });
});
