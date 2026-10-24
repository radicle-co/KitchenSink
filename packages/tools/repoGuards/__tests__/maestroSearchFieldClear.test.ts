/**
 * A MAESTRO FLOW CLEARS A SEARCH FIELD WITH THE FIELD'S OWN CLEAR CONTROL, NEVER WITH A TAP AND `eraseText`.
 *
 * A tap puts the caret where the tap lands, and `eraseText` deletes only what is BEFORE the caret. A query long enough to
 * reach the middle of the field therefore keeps its tail: local Android run, 2026-10-20, `searchNavigation` cleared
 * `zzzznosuchrecipe` that way, kept its last "e", and searched for "eRisotto local-20619-c36e5ed8". The same class kept
 * "03-e94064a4" in `discoverRecentSearches` (2026-10-18). Every native search field is `@commise/ui`'s `SearchField`,
 * which draws a clear control whenever it holds text (`SearchField.native.tsx`), so the flow taps that and nothing
 * depends on where a tap lands.
 *
 * The search fields are DISCOVERED, not listed: every `<SearchField` in a feature's `.native.tsx` source, its `label`
 * and `placeholder` props resolved through the feature's `messages.ts` files. A new search field is covered the day it
 * ships. Fields that are not search fields keep `common/typeIntoField.yaml`, which reads the typed value back.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, commandLists, committedFlowFiles, isRecord, parseFlow, textOf } from './maestroFlowYaml.js';

const FEATURES_ROOT = 'packages/apps/commise/features';

/** Native `SearchField` call sites today: 5 (2026-10-20). A floor, so a discovery that broke cannot pass empty. */
const MIN_SEARCH_FIELD_SITES = 5;

/** Every file under `dir` whose name passes `keep`, repo-relative, skipping tests and `node_modules`. @sideEffect Reads the disk. */
function filesUnder(dir: string, keep: (name: string) => boolean): readonly string[] {
    return readdirSync(join(REPO_ROOT, dir), { withFileTypes: true, recursive: true })
        .filter((entry) => entry.isFile() && keep(entry.name))
        .map((entry) => relative(REPO_ROOT, join(entry.parentPath, entry.name)))
        .filter((path) => !path.includes('node_modules') && !path.includes('__tests__'));
}

/**
 * The message keys a source file's `<SearchField` elements name in their `label` and `placeholder` props. Pure.
 *
 * @param source - A `.native.tsx` file.
 * @returns One entry per element: its keys (`label={list.searchLabel}` gives `searchLabel`).
 */
export function searchFieldKeys(source: string): readonly (readonly string[])[] {
    return [...source.matchAll(/<SearchField\b([\s\S]*?)\/>/g)].map(([, props = '']) =>
        [...props.matchAll(/\b(?:label|placeholder)=\{\s*\w+\.(\w+)\s*\}/g)].map(([, key = '']) => key),
    );
}

/** Every literal a messages source assigns to `key` (`searchLabel: 'Search recipes'`). Pure. */
export function messageValues(source: string, key: string): readonly string[] {
    return [...source.matchAll(new RegExp(`\\b${key}:\\s*'([^']+)'`, 'g'))].map(([, value = '']) => value);
}

/**
 * Every `tapOn` on a search field that the next command erases, in one flow. Pure.
 *
 * @param file - The flow's path, for the parse error.
 * @param source - The flow's YAML.
 * @param fields - The search fields' labels.
 * @returns The label of each offending tap.
 */
export function tapThenEraseOn(file: string, source: string, fields: ReadonlySet<string>): readonly string[] {
    const found: string[] = [];

    for (const document of parseFlow(file, source)) {
        for (const list of commandLists(document)) {
            list.forEach((command, index) => {
                const next: unknown = list[index + 1];
                const erases = next === 'eraseText' || (isRecord(next) && 'eraseText' in next);
                const tapped = isRecord(command) && 'tapOn' in command ? textOf(command['tapOn']) : undefined;

                if (erases && tapped !== undefined && fields.has(tapped)) {
                    found.push(tapped);
                }
            });
        }
    }

    return found;
}

const flow = (body: string): string => `appId: test\n---\n${body}`;

describe('the rule, on inline sources', () => {
    it('reads the label and placeholder keys of each SearchField element', () => {
        const source =
            '<SearchField\n id={a}\n label={list.searchLabel}\n placeholder={list.searchPlaceholder}\n/>\n' +
            '<TextInput label={other.titleLabel} />\n<SearchField label={picker.searchLabel} />';

        expect(searchFieldKeys(source)).toEqual([['searchLabel', 'searchPlaceholder'], ['searchLabel']]);
    });

    it('reads every value a messages file assigns to a key', () => {
        expect(
            messageValues("a: { searchLabel: 'Search recipes' },\nb: { searchLabel: 'Search x' }", 'searchLabel'),
        ).toEqual(['Search recipes', 'Search x']);
    });

    it('refuses a tap on a search field followed by eraseText, bare or with a count', () => {
        const fields = new Set(['Search recipes']);

        expect(tapThenEraseOn('inline', flow("- tapOn: 'Search recipes'\n- eraseText\n"), fields)).toEqual([
            'Search recipes',
        ]);
        expect(
            tapThenEraseOn('inline', flow("- tapOn:\n    text: 'Search recipes'\n- eraseText: 40\n"), fields),
        ).toEqual(['Search recipes']);
    });

    it('allows the clear control, and an erase after a field that is not a search field', () => {
        const fields = new Set(['Search recipes']);

        expect(
            tapThenEraseOn(
                'inline',
                flow(
                    "- tapOn: 'Clear search'\n- tapOn: 'Search recipes'\n- inputText: 'x'\n- tapOn: 'Title'\n- eraseText\n",
                ),
                fields,
            ),
        ).toEqual([]);
    });
});

describe('the committed flows clear search fields with their clear control', () => {
    const messages = filesUnder(FEATURES_ROOT, (name) => name === 'messages.ts').map((file) =>
        readFileSync(join(REPO_ROOT, file), 'utf8'),
    );
    const resolve = (key: string): readonly string[] => messages.flatMap((source) => messageValues(source, key));
    const sites = filesUnder(FEATURES_ROOT, (name) => name.endsWith('.native.tsx')).flatMap((file) =>
        searchFieldKeys(readFileSync(join(REPO_ROOT, file), 'utf8')).map((keys) => ({
            file,
            labels: keys.flatMap(resolve),
        })),
    );
    const fields = new Set(sites.flatMap(({ labels }) => labels));

    it('finds every native search field, and resolves a label for each one', () => {
        expect(sites.length).toBeGreaterThanOrEqual(MIN_SEARCH_FIELD_SITES);
        expect(sites.filter(({ labels }) => labels.length === 0).map(({ file }) => file)).toEqual([]);
        expect(fields).toContain('Search recipes');
        expect(fields).toContain('Search your recipes');
    });

    it('no flow taps a search field and then erases it', () => {
        const offenders = committedFlowFiles().flatMap((file) =>
            tapThenEraseOn(file, readFileSync(join(REPO_ROOT, file), 'utf8'), fields).map(
                (label) => `${file}: ${label}`,
            ),
        );

        expect(offenders).toEqual([]);
    });
});
