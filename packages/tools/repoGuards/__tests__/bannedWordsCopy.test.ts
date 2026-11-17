/**
 * Copy guard for the one banned-word list (`@kitchensink/recipe-core/copy/banned-words`).
 *
 * Cook-facing copy about rights and rewriting may not claim a check or a clearance that did not happen. The list is
 * held once; this guard reads it and scans every string of the real message dictionaries in every locale. It goes
 * red the moment a banned word is planted in a string, and it refuses to pass over an empty scan.
 *
 * A copy source is scanned whole. A new place that holds cook-facing copy is added to SOURCES, and a missing file or
 * export fails rather than being skipped.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { BANNED_COPY_WORDS, bannedCopyWordsIn } from '@kitchensink/recipe-core/copy/banned-words';
import { describe, expect, it } from 'vitest';

import { copyEntriesOf, isCopyTree, type CopyTree } from './appCopyDuplicates.js';

const REPO_ROOT = join(import.meta.dirname, '../../../..');

/** One scanned dictionary: a source file and the name of its `LocalizedMessages` export. */
interface CopySource {
    readonly label: string;
    readonly file: string;
    readonly exportName: string;
}

const SOURCES: readonly CopySource[] = [
    {
        label: 'editorMessages',
        file: 'packages/apps/commise/features/recipes/src/editor/messages.ts',
        exportName: 'editorMessages',
    },
    {
        label: 'recipeMessages',
        file: 'packages/apps/commise/features/recipes/src/messages.ts',
        exportName: 'recipeMessages',
    },
    {
        label: 'importMessages',
        file: 'packages/apps/commise/features/recipes/src/import/messages.ts',
        exportName: 'importMessages',
    },
];

/** A banned word found in one string. */
interface Hit {
    readonly where: string;
    readonly word: string;
}

/**
 * The banned words in every string of a dictionary tree.
 *
 * @param tree - A locale set.
 * @param prefix - The label put before each path in a hit.
 * @returns One hit per word per string. Pure.
 */
function hitsIn(tree: CopyTree, prefix: string): readonly Hit[] {
    return copyEntriesOf(tree, prefix).flatMap(([where, text]) =>
        bannedCopyWordsIn(text).map((word) => ({ where, word })),
    );
}

/**
 * Every locale set of a source.
 *
 * @param source - The dictionary to read.
 * @returns Pairs of locale and tree. Throws when the file, the export or a locale set is not a copy tree.
 * @sideEffect Imports a source module.
 */
async function treesOf(source: CopySource): Promise<readonly (readonly [string, CopyTree])[]> {
    const loaded: unknown = await import(pathToFileURL(join(REPO_ROOT, source.file)).href);
    const dictionary = (loaded as Record<string, unknown>)[source.exportName];

    if (typeof dictionary !== 'object' || dictionary === null) {
        throw new Error(`${source.file} must export ${source.exportName}`);
    }

    return Object.entries(dictionary).map(([locale, set]): readonly [string, CopyTree] => {
        if (!isCopyTree(set)) {
            throw new Error(`${source.label}.${locale} is not a tree of strings`);
        }

        return [locale, set];
    });
}

describe('hitsIn (the rule, over a planted word)', () => {
    it('fails on a banned word planted in a nested string and a plural', () => {
        const tree: CopyTree = {
            ok: 'Saved from {site}.',
            nested: { label: 'This one is legally yours', count: { one: '1 recipe', other: '{count} are APPROVED' } },
        };

        expect(hitsIn(tree, 'en')).toEqual([
            { where: 'en.nested.label', word: 'legally yours' },
            { where: 'en.nested.count.other', word: 'approved' },
        ]);
    });

    it('finds nothing in clean copy', () => {
        expect(hitsIn({ a: 'Saved from {site}.', b: { c: 'Private to you.' } }, 'en')).toEqual([]);
    });
});

describe('the one banned-word list', () => {
    it('is not empty', () => {
        expect(BANNED_COPY_WORDS.length).toBeGreaterThan(0);
    });

    it.each(SOURCES)('is respected by every string of $label', async (source) => {
        const trees = await treesOf(source);
        const scanned = trees.reduce((count, [locale, tree]) => count + copyEntriesOf(tree, locale).length, 0);

        expect(scanned).toBeGreaterThan(0);
        expect(trees.flatMap(([locale, tree]) => hitsIn(tree, `${source.label}.${locale}`))).toEqual([]);
    });
});
