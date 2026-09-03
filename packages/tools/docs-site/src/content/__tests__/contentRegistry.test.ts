import { existsSync, globSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONTENT_SOURCE_IDS } from '../contentSource.js';
import { CONTENT_SOURCES } from '../contentRegistry.js';
import { REPO_ROOT, SITE_DIR, SITE_TO_REPO_ROOT } from '../paths.js';

/**
 * The GUARD tier for the content registry.
 *
 * Everything asserted here is a claim the registry makes about the repository, and every one of them
 * can be falsified by a rename that nobody thinks of as a documentation change — moving the ADRs,
 * renaming `CODING_STANDARDS.md`, dropping a runbook directory. Without this the site would still
 * build, and would simply serve a smaller corpus than it advertises. That silent shrink is exactly
 * the failure this whole effort exists to end, so it fails in CI instead.
 */

describe('paths', () => {
    it('walks up from the site directory to the actual repository root', () => {
        // Pinning the hop count by its OBSERVABLE CONSEQUENCE rather than by counting `..` segments:
        // if the package is ever moved, this fails instead of silently mounting the wrong tree.
        expect(resolve(SITE_DIR, SITE_TO_REPO_ROOT)).toBe(REPO_ROOT);

        const rootManifest: unknown = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));

        expect((rootManifest as { name?: string }).name).toBe('kitchensink');
    });
});

describe('CONTENT_SOURCES', () => {
    it('declares every id exactly once, in navbar order', () => {
        expect(CONTENT_SOURCES.map((source) => source.id)).toEqual([...CONTENT_SOURCE_IDS]);
    });

    it('gives every source a distinct route', () => {
        const routes = CONTENT_SOURCES.map((source) => source.routeBasePath);

        expect(new Set(routes).size).toBe(routes.length);
    });

    it('states every path as a repo-root-relative POSIX path', () => {
        for (const source of CONTENT_SOURCES) {
            expect(source.contentPath).not.toMatch(/^[/.]/);
            expect(source.contentPath).not.toContain('\\');
        }
    });

    it.each(CONTENT_SOURCES.filter((source) => source.availability === 'required'))(
        'reaches real files from every include glob of the required source "$id"',
        (source) => {
            const cwd = join(REPO_ROOT, source.contentPath);

            expect(existsSync(cwd), `${source.contentPath} does not exist`).toBe(true);

            for (const pattern of source.include) {
                // Asserted PER GLOB, not per source: a source with six globs and one survivor would
                // pass a whole-source check while five sections quietly vanished from the site.
                expect(
                    globSync(pattern, { cwd }),
                    `no file matches "${pattern}" under ${source.contentPath}`,
                ).not.toHaveLength(0);
            }
        },
    );

    it.each(CONTENT_SOURCES.filter((source) => source.availability === 'generated'))(
        'ships a non-empty placeholder for the generated source "$id"',
        (source) => {
            // The placeholder is what keeps an ungenerated section honest instead of broken, so its
            // absence is a defect in THIS package — unlike the absence of the generated content.
            const placeholder = join(REPO_ROOT, source.placeholderPath);

            expect(existsSync(placeholder), `${source.placeholderPath} does not exist`).toBe(true);
            expect(globSync('**/*.md', { cwd: placeholder })).not.toHaveLength(0);
        },
    );

    it('expects every generated source under docs/generated, the one directory the generators own', () => {
        for (const source of CONTENT_SOURCES) {
            if (source.availability === 'generated') {
                expect(source.contentPath).toMatch(/^docs\/generated\//);
            }
        }
    });
});
