import { describe, expect, it } from 'vitest';

import { isMissingContentSourceError } from '../contentSource.errors.js';
import type { ContentSource } from '../contentSource.js';
import { resolveContentSources } from '../resolveContentSources.js';

/**
 * The resolver is the whole degradation contract in one pure function, so these cases are written
 * against the STATES the site must be able to be in — not against the shape of the implementation.
 */

const handbook: ContentSource = {
    id: 'handbook',
    label: 'Handbook',
    routeBasePath: '/handbook',
    availability: 'required',
    contentPath: 'docs',
    include: ['architecture/**/*.md'],
};

const infrastructure: ContentSource = {
    id: 'infrastructure',
    label: 'Infrastructure',
    routeBasePath: '/infrastructure',
    availability: 'generated',
    contentPath: 'docs/generated/infrastructure',
    placeholderPath: 'packages/tools/docs-site/content/awaiting/infrastructure',
    include: ['**/*.md'],
};

const never = (): boolean => false;
const always = (): boolean => true;

describe('resolveContentSources', () => {
    it('mounts a required source at its real path when it has content', () => {
        const [resolved] = resolveContentSources([handbook], always);

        expect(resolved).toEqual({
            id: 'handbook',
            label: 'Handbook',
            routeBasePath: '/handbook',
            state: 'present',
            mountPath: 'docs',
            include: ['architecture/**/*.md'],
        });
    });

    it('throws MissingContentSourceError when a required source has no content', () => {
        expect(() => resolveContentSources([handbook], never)).toThrow(/handbook/);

        try {
            resolveContentSources([handbook], never);
            expect.unreachable('the resolver must not tolerate a missing required source');
        } catch (error) {
            expect(isMissingContentSourceError(error)).toBe(true);
            // The path is carried on the error so the failure names what to repoint, not just that
            // something is missing.
            expect(isMissingContentSourceError(error) && error.contentPath).toBe('docs');
        }
    });

    it('mounts a generated source at its real path once the generator has run', () => {
        const [resolved] = resolveContentSources([infrastructure], always);

        expect(resolved?.state).toBe('present');
        expect(resolved?.mountPath).toBe('docs/generated/infrastructure');
    });

    it('falls back to the placeholder — not a crash, not a fabrication — when a generated source is absent', () => {
        const [resolved] = resolveContentSources([infrastructure], never);

        expect(resolved).toEqual({
            id: 'infrastructure',
            label: 'Infrastructure',
            routeBasePath: '/infrastructure',
            state: 'awaitingGeneration',
            mountPath: 'packages/tools/docs-site/content/awaiting/infrastructure',
            include: ['**/*.md'],
            // The route still exists, so the navbar link cannot dangle; the page says why it is empty
            // and where the content is expected to land.
            expectedPath: 'docs/generated/infrastructure',
        });
    });

    it('asks about the source path itself, never the placeholder', () => {
        const asked: string[] = [];

        resolveContentSources([infrastructure], (path) => {
            asked.push(path);

            return false;
        });

        expect(asked).toEqual(['docs/generated/infrastructure']);
    });

    it('resolves each source independently, so one absent generator does not blank the others', () => {
        const resolved = resolveContentSources([handbook, infrastructure], (path) => path === 'docs');

        expect(resolved.map((source) => [source.id, source.state])).toEqual([
            ['handbook', 'present'],
            ['infrastructure', 'awaitingGeneration'],
        ]);
    });

    it('preserves registry order, because that order is the navbar order', () => {
        const resolved = resolveContentSources([infrastructure, handbook], always);

        expect(resolved.map((source) => source.id)).toEqual(['infrastructure', 'handbook']);
    });
});
