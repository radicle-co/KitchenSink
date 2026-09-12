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
            // `sourcePath` joined the resolved shape when nested sources gained a mirror (see the
            // "nested content directories" block below): a present source now states BOTH where
            // Docusaurus mounts it and where its Markdown really is, and the two are equal here.
            sourcePath: 'docs',
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

/**
 * The NESTING rule — the one that decides whether this site builds at all.
 *
 * `@docusaurus/plugin-content-docs` derives its webpack rule from the content DIRECTORY
 * (`createMDXLoaderRule({ include: contentDirs })`, `lib/index.js`), never from the `include` globs.
 * Webpack applies EVERY matching rule, so when one instance's directory contains another's, both
 * instances' MDX loaders run over the same file. Measured on 3.10.2 against the real tree: the build
 * dies with `Can't resolve '@site/.docusaurus/docusaurus-plugin-content-docs/handbook/…json'` for a
 * file the `infrastructure` instance owns — and `exclude: ['generated/**']` on the outer instance does
 * NOT fix it (that option only feeds `isMDXPartial`; the loader still runs, and SSG then fails inside
 * `DocItem` with `Cannot read properties of undefined`).
 *
 * So the registry's real constraint is "no source's directory may contain another's", and the repo
 * violates it by construction: `handbook` mounts `docs`, and every generated corpus is written to
 * `docs/generated/*`. Moving the generated corpora out of `docs/` would touch the two generators,
 * `turbo.json`, `.prettierignore` and `.github/scripts/verify-deployment.sh` — so the resolution kept
 * here is to mount a MIRROR of the nested corpus instead.
 *
 * Mirroring is not the duplication `contentRegistry.ts` refuses. That rule protects the AUTHORED
 * corpus, whose source of truth IS the file; a generated corpus's source of truth is its generator,
 * and the mirror is gitignored build output rebuilt from scratch every run.
 */
describe('resolveContentSources — nested content directories', () => {
    it('mirrors a present source whose directory sits inside another declared source', () => {
        const [, resolved] = resolveContentSources([handbook, infrastructure], always);

        expect(resolved?.state).toBe('present');
        expect(resolved?.mountPath).toBe('packages/tools/docs-site/content/mirrored/infrastructure');
    });

    it('reports where the mirror must be filled FROM, so the shell needs no second copy of the rule', () => {
        const [, resolved] = resolveContentSources([handbook, infrastructure], always);

        expect(resolved?.state === 'present' && resolved.sourcePath).toBe('docs/generated/infrastructure');
    });

    it('leaves a source that nests inside NOTHING mounted where it really lives', () => {
        // The discriminating case: same source, same predicate, only the containing source removed.
        // A rule that mirrored unconditionally would pass the two assertions above and fail here.
        const [resolved] = resolveContentSources([infrastructure], always);

        expect(resolved?.mountPath).toBe('docs/generated/infrastructure');
        expect(resolved?.state === 'present' && resolved.sourcePath).toBe('docs/generated/infrastructure');
    });

    it('does not mistake a sibling with a shared name prefix for a parent', () => {
        // `docs-site` starts with `docs` but is not inside it. A prefix test rather than a path-segment
        // test would mirror this source, and the mirror would then be filled from a directory the
        // handbook never contained.
        const sibling: ContentSource = {
            ...infrastructure,
            contentPath: 'docs-generated/infrastructure',
        };
        const [, resolved] = resolveContentSources([handbook, sibling], always);

        expect(resolved?.mountPath).toBe('docs-generated/infrastructure');
    });

    it('does not treat a source as nested inside itself', () => {
        const [resolved] = resolveContentSources([handbook], always);

        expect(resolved?.mountPath).toBe('docs');
    });

    it('leaves an ABSENT nested source on its placeholder, which never nested in the first place', () => {
        const [, resolved] = resolveContentSources([handbook, infrastructure], (path) => path === 'docs');

        expect(resolved?.mountPath).toBe('packages/tools/docs-site/content/awaiting/infrastructure');
    });
});
