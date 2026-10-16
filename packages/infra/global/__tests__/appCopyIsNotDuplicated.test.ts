// @vitest-environment node
/**
 * Repo-wide guard: **a sentence both apps say is authored once**, in a feature package, not in each app's own copy.
 *
 * The web and mobile apps each keep a dictionary for the copy that is that platform's alone (`web/src/i18n/messages.ts`,
 * `mobile/src/i18n/messages.ts`). Between them they had grown the same sentences twice: the greetings, the "Coming soon"
 * block, the paid-features nudge, the loading captions, the recipe and collection load errors. The two had already
 * drifted ("Loading recipe" / "Loading recipe…", "Tabs" / "Main" for the one tab bar landmark), and a drift is invisible
 * from inside either app. The cure is one authoritative representation (CLAUDE.md DRY: knowledge, not keystrokes), so this
 * guard fails when one trimmed string appears in both dictionaries, under ANY keys.
 *
 * ⛔ The comparison is on VALUES. Keys differ between the apps (`home.surface.widgetError` / `home.widgetError`), so a
 * rule on paths would pass while the same sentence sat in both.
 *
 * ⚠️ What it does NOT see: copy that lives in a feature package and is also typed into an app, or a sentence reworded a
 * little ("Loading recipe" and "Loading the recipe"). A reworded twin is a drift a reviewer has to catch; this closes the
 * exact-match door, which is the one that actually opened.
 *
 * The allow-list below is the escape hatch, and every entry owes a reason. Adding one to silence a failure is the
 * mistake the guard exists to stop: move the sentence to a shared `messages.ts` instead.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    copyEntriesOf,
    duplicateCopyOf,
    isCopyTree,
    type AllowedDuplicate,
    type CopyTree,
} from './appCopyDuplicates.js';

/** The repo root — this file sits at `packages/infra/global/__tests__/`. */
const REPO_ROOT = join(import.meta.dirname, '../../../..');

/**
 * One app's English dictionary, loaded from its source.
 *
 * Loaded by a computed specifier on purpose: the web dictionary imports a type through the web app's `@/` alias, which this
 * package's compiler cannot resolve, and a static import would make this package type-check another app's tree. Vitest
 * resolves the module at run time, where the alias is already erased (it is a type-only import).
 *
 * @param file - Repo-relative path of the app's `messages.ts`.
 * @param exportName - The dictionary's export name.
 * @returns The `en` set.
 * @sideEffect Imports a source module.
 */
async function englishCopyOf(file: string, exportName: string): Promise<CopyTree> {
    const loaded: unknown = await import(pathToFileURL(join(REPO_ROOT, file)).href);
    const dictionary = (loaded as Record<string, unknown>)[exportName];
    const en = (dictionary as { en?: unknown } | undefined)?.en;

    if (!isCopyTree(en)) {
        throw new Error(`${file} must export ${exportName} with an "en" set of strings`);
    }

    return en;
}

const webCopy = await englishCopyOf('packages/apps/commise/web/src/i18n/messages.ts', 'webMessages');
const mobileCopy = await englishCopyOf('packages/apps/commise/mobile/src/i18n/messages.ts', 'mobileMessages');

/**
 * Sentences that may appear in both apps' own dictionaries.
 *
 * Each is a PROPER NOUN or a platform fact, not a sentence that can drift.
 */
const ALLOWED: readonly AllowedDuplicate[] = [
    {
        value: 'Commise',
        reason:
            'The product name is a proper noun: web uses it as the wordmark and document title, mobile as the sign-in brand. ' +
            'It is never reworded, so there is no drift to prevent.',
    },
];

describe('duplicateCopyOf (the rule, over fixtures)', () => {
    const web: CopyTree = { home: { greeting: 'Good morning', unique: 'Web only' }, empty: '   ' };

    interface Case {
        readonly name: string;
        readonly mobile: CopyTree;
        readonly expected: readonly { value: string; web: readonly string[]; mobile: readonly string[] }[];
    }

    it.each<Case>([
        {
            name: 'finds the same sentence under different keys',
            mobile: { hello: 'Good morning' },
            expected: [{ value: 'Good morning', web: ['home.greeting'], mobile: ['hello'] }],
        },
        {
            name: 'ignores surrounding whitespace',
            mobile: { hello: '  Good morning ' },
            expected: [{ value: 'Good morning', web: ['home.greeting'], mobile: ['hello'] }],
        },
        {
            name: 'reports every path that holds the value on either side',
            mobile: { a: 'Good morning', b: { c: 'Good morning' } },
            expected: [{ value: 'Good morning', web: ['home.greeting'], mobile: ['a', 'b.c'] }],
        },
        { name: 'is silent when the dictionaries share nothing', mobile: { hello: 'Hello' }, expected: [] },
        {
            name: 'is case sensitive: a different capital is a different sentence',
            mobile: { a: 'good morning' },
            expected: [],
        },
        { name: 'never treats blank values as a sentence', mobile: { blank: '' }, expected: [] },
    ])('$name', ({ mobile, expected }) => {
        expect(duplicateCopyOf(web, mobile)).toEqual(expected);
    });

    it('skips a value on the allow-list, and only that value', () => {
        const allowed: readonly AllowedDuplicate[] = [{ value: 'Good morning', reason: 'fixture' }];

        expect(duplicateCopyOf(web, { a: 'Good morning', b: 'Web only' }, allowed)).toEqual([
            { value: 'Web only', web: ['home.unique'], mobile: ['b'] },
        ]);
    });

    it('flattens nested trees to dotted paths in declaration order', () => {
        expect(copyEntriesOf({ a: { b: ' x ', c: 'y' }, d: 'z' })).toEqual([
            ['a.b', 'x'],
            ['a.c', 'y'],
            ['d', 'z'],
        ]);
    });
});

describe('the apps’ own dictionaries', () => {
    it('share no sentence outside the reasoned allow-list', () => {
        const duplicates = duplicateCopyOf(webCopy, mobileCopy, ALLOWED);
        const report = duplicates.map(
            (entry) => `"${entry.value}" — web: ${entry.web.join(', ')}; mobile: ${entry.mobile.join(', ')}`,
        );

        // Empty means every shared sentence lives in a feature package. A failure lists each one with both sets of keys.
        expect(report).toEqual([]);
    });

    it('keeps every allow-list entry argued, and still needed', () => {
        for (const entry of ALLOWED) {
            expect(entry.reason.length).toBeGreaterThan(20);
            // An entry that no longer shadows a real duplicate is dead weight that would hide a future one.
            expect(duplicateCopyOf(webCopy, mobileCopy)).toContainEqual(
                expect.objectContaining({ value: entry.value }),
            );
        }
    });
});
