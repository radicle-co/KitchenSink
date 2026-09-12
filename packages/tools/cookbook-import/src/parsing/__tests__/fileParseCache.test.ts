/**
 * Unit tier for the file-backed parse cache — the port's own contract, method by method.
 *
 * The BEHAVIOUR under the pipeline is proved in `tests/fileParseCache.integration.test.ts`; what is here is
 * the set of rules `ParseCachePort` states and a driver of the two methods can check on its own: every
 * engine's row comes back, a second write of one identity does nothing, a file that is not a cache file is
 * refused, and a payload this generation cannot read is handed through rather than judged.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lineDigest, parseKey, type HexDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import type { StoredParse, RememberedParse } from '@kitchensink/recipe-import-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFileParseCache } from '../fileParseCache.js';

const sha256: HexDigest = (value) => createHash('sha256').update(value).digest('hex');

const SUGAR = 'one cup of brown sugar';
const FLOUR = 'two cups of flour';

/** The facts a stored row holds — `storedParseOf`'s keys, and never the cook's line. */
function facts(name: string): StoredParse {
    return {
        statedMeasure: 'one cup',
        quantity: { kind: 'exact', value: 1 },
        unit: 'cup',
        foods: [{ name, prep: null }],
        // ⛔ REQUIRED. A stored parse records what a validator judged; a row without it is unreadable by
        // design, so a fixture omitting it would exercise the refusal rather than the round trip.
        reviewReasons: [],
    };
}

/** One row to store, keyed exactly as the pipeline keys it. */
function entry(line: string, engine: 'crf' | 'llm', engineVersion: string, name: string): RememberedParse {
    const digest = lineDigest(line, sha256);

    return {
        parseKey: parseKey({ lineDigest: digest, engine, engineVersion }, sha256),
        lineDigest: digest,
        engine,
        engineVersion,
        parse: facts(name),
    };
}

describe('createFileParseCache', () => {
    let directory: string;
    let path: string;

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'cookbookImportParseCacheUnit'));
        path = join(directory, 'nested', 'parseCache.jsonl');
    });

    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
    });

    /** Every line of the file, as written. */
    function lines(): readonly string[] {
        const raw = readFileSync(path, 'utf-8');

        return raw === '' ? [] : raw.trimEnd().split('\n');
    }

    it('serves back what it was told, across a reload', async () => {
        const cache = createFileParseCache(path);
        const stored = entry(SUGAR, 'crf', 'crf@1', 'brown sugar');

        await cache.remember(stored);

        const reloaded = createFileParseCache(path);
        const rows = await reloaded.findForLines([lineDigest(SUGAR, sha256)]);

        expect(rows).toEqual([
            {
                lineDigest: stored.lineDigest,
                engine: 'crf',
                engineVersion: 'crf@1',
                parse: facts('brown sugar'),
            },
        ]);
    });

    it('returns EVERY engine row for a digest, not one', async () => {
        const cache = createFileParseCache(path);

        await cache.remember(entry(SUGAR, 'crf', 'crf@1', 'brown sugar'));
        await cache.remember(entry(SUGAR, 'llm', 'llm@1', 'sugar'));

        const rows = await cache.findForLines([lineDigest(SUGAR, sha256)]);

        expect(rows.map((row) => row.engine).sort()).toEqual(['crf', 'llm']);
    });

    it('keeps rows written under different engine versions, so the reader can reject the stale one', async () => {
        const cache = createFileParseCache(path);

        await cache.remember(entry(SUGAR, 'crf', 'crf@1', 'brown sugar'));
        await cache.remember(entry(SUGAR, 'crf', 'crf@2', 'brown sugar'));

        const rows = await cache.findForLines([lineDigest(SUGAR, sha256)]);

        expect(rows.map((row) => row.engineVersion).sort()).toEqual(['crf@1', 'crf@2']);
    });

    it('writes one identity ONCE — a second remember of it changes nothing', async () => {
        const cache = createFileParseCache(path);

        await cache.remember(entry(SUGAR, 'crf', 'crf@1', 'brown sugar'));
        await cache.remember(entry(SUGAR, 'crf', 'crf@1', 'a different reading of the same line'));

        expect(lines()).toHaveLength(1);
        expect(await cache.findForLines([lineDigest(SUGAR, sha256)])).toEqual([
            expect.objectContaining({ parse: facts('brown sugar') }),
        ]);
    });

    it('contributes no row for a line nothing was stored for, and none for an empty batch', async () => {
        const cache = createFileParseCache(path);

        await cache.remember(entry(SUGAR, 'crf', 'crf@1', 'brown sugar'));

        expect(await cache.findForLines([lineDigest(FLOUR, sha256)])).toEqual([]);
        expect(await cache.findForLines([])).toEqual([]);
    });

    it('answers a digest asked for twice with that digest’s rows once', async () => {
        const cache = createFileParseCache(path);
        const digest = lineDigest(SUGAR, sha256);

        await cache.remember(entry(SUGAR, 'crf', 'crf@1', 'brown sugar'));

        expect(await cache.findForLines([digest, digest])).toHaveLength(1);
    });

    it('hands a payload this generation cannot read STRAIGHT THROUGH, judging nothing', async () => {
        const cache = createFileParseCache(path);

        await cache.remember(entry(SUGAR, 'crf', 'crf@1', 'brown sugar'));

        const superseded = `${readFileSync(path, 'utf-8').trimEnd()}\n${JSON.stringify({
            parseKey: 'v1:deadbeef',
            lineDigest: lineDigest(FLOUR, sha256),
            engine: 'llm',
            engineVersion: 'llm@1',
            parse: { aShapeNobodyWritesAnyMore: true },
        })}\n`;

        writeFileSync(path, superseded, 'utf-8');

        const rows = await createFileParseCache(path).findForLines([lineDigest(FLOUR, sha256)]);

        expect(rows).toEqual([expect.objectContaining({ parse: { aShapeNobodyWritesAnyMore: true } })]);
    });

    it('refuses a file that is not a cache file, naming where to look', () => {
        writeFileSync(path.replace('/nested/', '/'), 'not json at all\n', 'utf-8');

        expect(() => createFileParseCache(path.replace('/nested/', '/'))).toThrow(/line 1/u);
    });

    it('refuses a row missing a member of the identity', () => {
        const flat = path.replace('/nested/', '/');

        writeFileSync(
            flat,
            `${JSON.stringify({ parseKey: 'v1:x', engine: 'crf', engineVersion: 'crf@1' })}\n`,
            'utf-8',
        );

        expect(() => createFileParseCache(flat)).toThrow(/line 1/u);
    });

    it('refuses a blank path rather than appending nowhere', () => {
        // ⛔ `dirname('')` is `'.'`, so the directory check passes and every append then fails into the
        // cache-tier failure the pipeline swallows by design — a cache that silently stores nothing.
        expect(() => createFileParseCache('')).toThrow(/needs a path/u);
        expect(() => createFileParseCache('   ')).toThrow(/needs a path/u);
    });

    it('treats an absent file as an empty cache', async () => {
        expect(await createFileParseCache(join(directory, 'nothing', 'here.jsonl')).findForLines([])).toEqual([]);
    });
});
