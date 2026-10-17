// @vitest-environment node
/**
 * ⛔ The recipe library's grid/list choice is an ACCOUNT setting and is kept on no device store (owner ruling
 * 2026-10-17, ADR-0059, D19: "no preference is kept in browser storage"; parity audit finding G2).
 *
 * It was a cookie on web (`recipes.viewMode`, read by the server for the first paint) and a value in `AsyncStorage` on
 * native, under the same key. Both were removed when the setting moved to identity's `settings` table. This guard keeps
 * them removed: a second copy of the choice on a device would disagree with the account the moment the cook used another
 * browser, and that disagreement would look like a bug in the sync, not in the copy.
 *
 * Read through the TypeScript parser, not `grep`: the rationale for the removal is written in comments and in string
 * copy, and a guard that fires on its own rationale gets deleted. Only identifiers and string literals count.
 *
 * Pure predicates over one file's text, fired at deliberately-violating fakes below as well as at every tracked source.
 *
 * @pattern Specification — a predicate over a source file, with a fixture table of the shapes it must refuse
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { isTestFile, repoRoot, trackedFiles, visit } from './serviceSources.js';

/** The names that meant "the device keeps this choice". */
const DEVICE_STORE_IDENTIFIERS: ReadonlySet<string> = new Set([
    'VIEW_MODE_KEY',
    'viewModeCookieFor',
    'useStoredViewMode',
]);

/** The storage key the cookie and the device store shared. */
const DEVICE_STORE_KEY = 'recipes.viewMode';

/**
 * What in one source file keeps the view choice on a device.
 *
 * @param file - Repo-relative path, used to parse as TSX.
 * @param contents - The file's text.
 * @returns A description of each offence; empty when the file is clean. Pure.
 */
function deviceStoreOffences(file: string, contents: string): readonly string[] {
    const source = ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const offences: string[] = [];

    visit(source, (node) => {
        if (ts.isIdentifier(node) && DEVICE_STORE_IDENTIFIERS.has(node.text)) {
            offences.push(`identifier ${node.text}`);
        }

        // Every kind of literal text, template pieces included: a cookie is built as `key=${value}`.
        const isLiteralText =
            ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node) ||
            ts.isTemplateHead(node) ||
            ts.isTemplateMiddle(node) ||
            ts.isTemplateTail(node);

        if (isLiteralText && node.text.includes(DEVICE_STORE_KEY)) {
            offences.push(`string ${JSON.stringify(node.text)}`);
        }
    });

    return offences;
}

describe('deviceStoreOffences (the predicate, fired at fakes)', () => {
    it.each([
        ['the shared key as a literal', "AsyncStorage.getItem('recipes.viewMode');", true],
        ['the cookie writer', "document.cookie = viewModeCookieFor('grid');", true],
        ['the key constant', "import { VIEW_MODE_KEY } from '@commise/features-recipes';", true],
        ['the device-store hook', 'const [choice] = useStoredViewMode();', true],
        ['the key inside a cookie string', 'const c = `recipes.viewMode=${mode}; path=/`;', true],
        ['a comment that names the removed key', '// recipes.viewMode used to be a cookie.', false],
        ['a different cookie', "document.cookie = 'locale=en';", false],
        ['the setting', "patchSettings.mutate({ recipeViewMode: 'grid' });", false],
    ])('%s -> %s', (_label, contents, refused) => {
        expect(deviceStoreOffences('fake.tsx', contents).length > 0).toBe(refused);
    });
});

describe('the recipe view choice has no device store', () => {
    const sources = trackedFiles('packages/apps')
        .filter((file) => /\.(?:ts|tsx)$/u.test(file) && !isTestFile(file) && !file.includes('/dist/'))
        .map((file) => ({ file, contents: readFileSync(path.join(repoRoot, file), 'utf8') }));

    it('inspects the app sources (the walk is not vacuous)', () => {
        expect(sources.length).toBeGreaterThan(500);
    });

    it('finds no source that keeps the choice in a cookie, a device store or under the old key', () => {
        const offending = sources
            .map(({ file, contents }) => ({ file, offences: deviceStoreOffences(file, contents) }))
            .filter(({ offences }) => offences.length > 0);

        expect(offending, 'the choice is the account setting `recipeViewMode`; keep no copy of it on a device').toEqual(
            [],
        );
    });
});
