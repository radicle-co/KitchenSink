/**
 * Unit tests for the import ledger — the tool's only defence against duplicating a public recipe.
 *
 * The three properties worth pinning are all about what happens on the SECOND run, which is the run nobody
 * tests by hand: the ledger must survive a process boundary, must not confuse two books that print the same
 * recipe title, and must REFUSE to continue from a corrupt file rather than quietly starting from zero.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ImportLedger } from '../importLedger.js';

/** A fresh ledger path in a throwaway directory. */
function ledgerPath(): string {
    return join(mkdtempSync(join(tmpdir(), 'cookbook-ledger-')), 'nested', 'ledger.json');
}

describe('ImportLedger', () => {
    it('treats an absent file as an empty ledger rather than an error', () => {
        expect(ImportLedger.load(ledgerPath()).size).toBe(0);
    });

    it('remembers a recipe ACROSS a reload — which is the whole point', () => {
        const path = ledgerPath();
        ImportLedger.load(path).record(12350, 'BEET SOUP', 'recipe-1');

        const reloaded = ImportLedger.load(path);

        expect(reloaded.has(12350, 'BEET SOUP')).toBe(true);
        expect(reloaded.get(12350, 'BEET SOUP')?.recipeId).toBe('recipe-1');
    });

    it('persists on EVERY record, not at the end of a run', () => {
        // A run killed by a rate-limit storm must be resumable from whatever it got through. Buffering to
        // the end would make the duplicate-on-crash window the entire import instead of one write.
        const path = ledgerPath();
        const ledger = ImportLedger.load(path);

        ledger.record(12350, 'FIRST', 'recipe-1');
        expect(Object.keys(JSON.parse(readFileSync(path, 'utf-8')) as object)).toHaveLength(1);

        ledger.record(12350, 'SECOND', 'recipe-2');
        expect(Object.keys(JSON.parse(readFileSync(path, 'utf-8')) as object)).toHaveLength(2);
    });

    it('keys on the BOOK as well as the title, so two cookbooks may both print "BORSHT"', () => {
        const path = ledgerPath();
        const ledger = ImportLedger.load(path);

        ledger.record(12350, 'BORSHT', 'recipe-a');

        expect(ledger.has(12350, 'BORSHT')).toBe(true);
        expect(ledger.has(12327, 'BORSHT')).toBe(false);
    });

    it('THROWS on a corrupt ledger instead of silently starting from zero', () => {
        // Starting empty here would re-import everything the ledger recorded — the exact duplication it
        // exists to prevent — while reporting a clean run.
        const path = ledgerPath();
        ImportLedger.load(path).record(12350, 'BEET SOUP', 'recipe-1');
        writeFileSync(path, '{ not json', 'utf-8');

        expect(() => ImportLedger.load(path)).toThrow(/unreadable/i);
    });

    /**
     * Valid JSON that is NOT a ledger is just as corrupt as unparseable text, and it used to be accepted:
     * `JSON.parse` was cast to the entry map, so `[]` loaded as an empty ledger (every recipe re-imported),
     * `null` threw an opaque `Object.entries` TypeError, and an entry with no `recipeId` was reported as
     * imported with an audit trail pointing at nothing. Each is a fail-closed refusal now.
     */
    it.each([
        ['an array', '[]'],
        ['null', 'null'],
        ['a string', '"12350::BEET SOUP"'],
        ['an entry that is null', '{ "12350::BEET SOUP": null }'],
        [
            'an entry whose recipeId is not a string',
            '{ "12350::BEET SOUP": { "recipeId": 7, "importedAt": "2026-09-03T00:00:00.000Z" } }',
        ],
        [
            'an entry with an empty recipeId',
            '{ "12350::BEET SOUP": { "recipeId": "", "importedAt": "2026-09-03T00:00:00.000Z" } }',
        ],
        ['an entry with no importedAt', '{ "12350::BEET SOUP": { "recipeId": "recipe-1" } }'],
        [
            'an entry whose importedAt is not ISO 8601',
            '{ "12350::BEET SOUP": { "recipeId": "recipe-1", "importedAt": "yesterday" } }',
        ],
    ])('THROWS on a well-formed JSON file that is not a ledger: %s', (_label, contents) => {
        const path = ledgerPath();
        ImportLedger.load(path).record(12350, 'BEET SOUP', 'recipe-1');
        writeFileSync(path, contents, 'utf-8');

        expect(() => ImportLedger.load(path)).toThrow(/unreadable/i);
    });

    it('accepts exactly what it writes — an empty object is an empty ledger', () => {
        const path = ledgerPath();
        ImportLedger.load(path).record(12350, 'BEET SOUP', 'recipe-1');
        writeFileSync(path, '{}\n', 'utf-8');

        expect(ImportLedger.load(path).size).toBe(0);
    });
});
