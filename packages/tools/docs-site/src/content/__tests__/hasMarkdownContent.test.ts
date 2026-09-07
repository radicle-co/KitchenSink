import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { hasMarkdownContent } from '../loadContentSources.js';
import { REPO_ROOT } from '../paths.js';

/**
 * The predicate is the whole reason an ungenerated section degrades honestly, and its one interesting
 * case is invisible against this repository as it stands: a directory that EXISTS and contains no
 * documentation. A generator that writes `manifest.json` before its Markdown, or that creates its
 * output directory and then fails, leaves exactly that state — and an existence check would call it
 * present, mount an empty corpus, and produce a section with a navbar entry and no pages.
 *
 * These cases are built on disk rather than described, because that distinction cannot be observed
 * from the committed tree.
 */

/** Creates a scratch directory and returns it as a repo-root-relative path, which is what the predicate takes. */
function scratchDirectory(): string {
    return relative(REPO_ROOT, mkdtempSync(join(tmpdir(), 'docsSiteContent-')));
}

describe('hasMarkdownContent', () => {
    it('is false for a directory that does not exist', () => {
        expect(hasMarkdownContent(join(scratchDirectory(), 'neverCreated'))).toBe(false);
    });

    it('is false for a directory that exists and is empty', () => {
        expect(hasMarkdownContent(scratchDirectory())).toBe(false);
    });

    it('is FALSE for a directory holding only a manifest — the half-generated state', () => {
        const directory = scratchDirectory();
        writeFileSync(join(REPO_ROOT, directory, 'manifest.json'), '{}');

        // ⛔ The mutation this case exists to kill: an `existsSync` probe answers TRUE here, and the
        // site then mounts a documentation section that documents nothing.
        expect(hasMarkdownContent(directory)).toBe(false);
    });

    it('is true once a Markdown document is present', () => {
        const directory = scratchDirectory();
        writeFileSync(join(REPO_ROOT, directory, 'index.md'), '# generated');

        expect(hasMarkdownContent(directory)).toBe(true);
    });

    it('finds Markdown nested below the top level, because generators emit trees', () => {
        const directory = scratchDirectory();
        mkdirSync(join(REPO_ROOT, directory, 'stacks', 'prod'), { recursive: true });
        writeFileSync(join(REPO_ROOT, directory, 'stacks', 'prod', 'dataStack.md'), '# stack');

        expect(hasMarkdownContent(directory)).toBe(true);
    });

    it('accepts .mdx as documentation too', () => {
        const directory = scratchDirectory();
        writeFileSync(join(REPO_ROOT, directory, 'tokens.mdx'), '# tokens');

        expect(hasMarkdownContent(directory)).toBe(true);
    });
});
