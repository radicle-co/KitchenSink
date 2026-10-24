import { describe, expect, it } from 'vitest';

import { resolveRepositoryLink } from '../repositoryLinkFallback.js';

/**
 * The link policy, stated as cases.
 *
 * The corpus this site mounts was written for readers holding the whole repository, so it links
 * freely into `specs/`, `.specify/` and `packages/` — files that are real, that this site does not
 * publish, and that Docusaurus therefore calls "broken". Two easy answers are both wrong:
 *
 * - Silencing the report hides genuine typos alongside them, which is the 404-nobody-sees failure
 *   this site exists to end.
 * - Publishing the whole repository as documentation drowns the documentation.
 *
 * So the discrimination made here is between a link that names a file THAT EXISTS outside the
 * published corpus (a working reference — send the reader to the repository) and one that names
 * nothing at all (a defect — let it be reported).
 */

const deps = {
    repoRoot: '/repo',
    siteDir: '/repo/packages/tools/docs-site',
    repositoryUrl: 'https://github.com/radicle-co/KitchenSink',
    ref: 'main',
    fileExists: (path: string) =>
        [
            '/repo/specs/governance-rules.md',
            '/repo/.specify/memory/constitution.md',
            '/repo/packages/services/identity/src/app.module.ts',
        ].includes(path),
};

describe('resolveRepositoryLink', () => {
    it('sends a link that escapes the corpus to the file in the repository', () => {
        const rewritten = resolveRepositoryLink(
            {
                sourceFilePath: '../../../docs/architecture/decisions/0017-service-ownership.md',
                url: '../../../specs/governance-rules.md',
            },
            deps,
        );

        expect(rewritten).toBe('https://github.com/radicle-co/KitchenSink/blob/main/specs/governance-rules.md');
    });

    it('keeps the heading anchor, which GitHub honours on rendered Markdown', () => {
        const rewritten = resolveRepositoryLink(
            {
                sourceFilePath: '../../../docs/architecture/decisions/0018-dedup.md',
                url: '../../../specs/governance-rules.md#gr-019-identifier-integrity--no-sentinels',
            },
            deps,
        );

        expect(rewritten).toBe(
            'https://github.com/radicle-co/KitchenSink/blob/main/specs/governance-rules.md' +
                '#gr-019-identifier-integrity--no-sentinels',
        );
    });

    it('reaches a dot-directory, which no docs glob can publish', () => {
        // `.specify/memory/constitution.md` is why a "just widen the allowlist" fix cannot work:
        // Docusaurus globs without `dot: true`, so a dot-directory is unpublishable by construction.
        const rewritten = resolveRepositoryLink(
            { sourceFilePath: '../../../docs/CODING_STANDARDS.md', url: '../.specify/memory/constitution.md' },
            deps,
        );

        expect(rewritten).toBe('https://github.com/radicle-co/KitchenSink/blob/main/.specify/memory/constitution.md');
    });

    it('⛔ leaves a link to a file that does not exist alone, so a real typo is still reported', () => {
        expect(
            resolveRepositoryLink(
                { sourceFilePath: '../../../docs/CODING_STANDARDS.md', url: '../specs/noSuchDocument.md' },
                deps,
            ),
        ).toBeUndefined();
    });

    it('leaves a link that escapes the repository entirely alone', () => {
        expect(
            resolveRepositoryLink(
                { sourceFilePath: '../../../docs/CODING_STANDARDS.md', url: '../../../../elsewhere/x.md' },
                deps,
            ),
        ).toBeUndefined();
    });

    it.each(['https://example.com/x.md', 'http://example.com/x.md', 'mailto:a@b.c', '/absolute/path.md'])(
        'ignores %s, which is not a relative file reference',
        (url) => {
            expect(
                resolveRepositoryLink({ sourceFilePath: '../../../docs/CODING_STANDARDS.md', url }, deps),
            ).toBeUndefined();
        },
    );

    it('ignores a bare anchor, which addresses the current page', () => {
        expect(
            resolveRepositoryLink({ sourceFilePath: '../../../docs/CODING_STANDARDS.md', url: '#some-heading' }, deps),
        ).toBeUndefined();
    });

    it('reaches a source file, not only Markdown — the ADRs cite code by path', () => {
        expect(
            resolveRepositoryLink(
                {
                    sourceFilePath: '../../../docs/architecture/decisions/0001-x.md',
                    url: '../../../packages/services/identity/src/app.module.ts',
                },
                deps,
            ),
        ).toBe('https://github.com/radicle-co/KitchenSink/blob/main/packages/services/identity/src/app.module.ts');
    });

    it('drops a query string, which means nothing to a repository browser', () => {
        expect(
            resolveRepositoryLink(
                {
                    sourceFilePath: '../../../docs/architecture/decisions/0017-x.md',
                    url: '../../../specs/governance-rules.md?plain=1#gr-001',
                },
                deps,
            ),
        ).toBe('https://github.com/radicle-co/KitchenSink/blob/main/specs/governance-rules.md#gr-001');
    });
});
