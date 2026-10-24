/**
 * The hand-run rebuild of a cited table's extract (plan U23, KTD-20). The property that matters most is ORDER: every
 * upstream file is checked against its pin before the extractor sees a byte, so a tampered or wrong edition is refused
 * before any row is read. The extractor here is a spy, so the test observes exactly what it was given and whether it
 * was called at all.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderSourceExtract, type ExtractLine } from '../sourceExtract.js';
import type { TableExtractPins } from '../tableExtractPins.js';
import { rebuildTableExtract } from '../tableExtractRebuild.js';
import type { TableExtractor, TableUpstreams } from '../tableExtractor.js';
import { isSourcePinMismatchError } from '../sourcePin.errors.js';
import { isSourcePinsFormatError } from '../usdaSourceArchive.errors.js';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

const PORT: ExtractLine = {
    key: '17-234',
    name: 'Port',
    basis: 'per100mL',
    values: { ENERC_KCAL: '157' },
    densityGramsPerMl: '1.03',
};
const GIN: ExtractLine = {
    key: '17-100',
    name: 'Gin',
    basis: 'per100mL',
    values: { ENERC_KCAL: '207' },
    densityGramsPerMl: '0.95',
};

/**
 * A spy extractor that answers with fixed lines.
 *
 * @param lines - What it returns.
 * @returns The extractor and its spy.
 */
function spyExtractor(lines: readonly ExtractLine[]): TableExtractor & { readonly extract: ReturnType<typeof vi.fn> } {
    return {
        roles: ['table'],
        extract: vi.fn(async (_upstreams: TableUpstreams, _keys: ReadonlySet<string>) => Promise.resolve(lines)),
    };
}

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tableRebuild-'));
    writeFileSync(join(dir, 'CoFID 2021.xlsx'), 'the published bytes');
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

/**
 * Pins naming the one upstream file in the temporary directory.
 *
 * @param upstreamSha256 - The pinned digest.
 * @returns The pins.
 */
function pinsFor(upstreamSha256: string): TableExtractPins {
    return {
        upstreams: { table: { upstream: 'CoFID 2021.xlsx', upstreamSha256 } },
        extract: 'cofidExtract2021.jsonl',
        extractSha256: 'e'.repeat(64),
    };
}

describe('rebuildTableExtract', () => {
    it('hands the extractor each role’s verified bytes and renders what it returns', async () => {
        const extractor = spyExtractor([PORT, GIN]);
        const keys = new Set(['17-234', '17-100']);

        const rebuilt = await rebuildTableExtract({
            pins: pinsFor(sha256('the published bytes')),
            upstreamDir: dir,
            extractor,
            keys,
        });

        expect(rebuilt).toEqual({ text: renderSourceExtract([GIN, PORT]), missing: [] });
        const [upstreams, given] = extractor.extract.mock.calls[0] as [TableUpstreams, ReadonlySet<string>];

        expect(upstreams.get('table')?.toString('utf8')).toBe('the published bytes');
        expect(given).toBe(keys);
    });

    it('reports the requested keys the table does not hold, sorted', async () => {
        const rebuilt = await rebuildTableExtract({
            pins: pinsFor(sha256('the published bytes')),
            upstreamDir: dir,
            extractor: spyExtractor([PORT]),
            keys: new Set(['17-234', '99-002', '99-001']),
        });

        expect(rebuilt.missing).toEqual(['99-001', '99-002']);
    });

    it('⛔ refuses a tampered upstream byte BEFORE the extractor is called', async () => {
        const extractor = spyExtractor([PORT]);
        let thrown: unknown;

        try {
            await rebuildTableExtract({
                pins: pinsFor(sha256('the reviewed bytes')),
                upstreamDir: dir,
                extractor,
                keys: new Set(['17-234']),
            });
        } catch (error) {
            thrown = error;
        }

        expect(isSourcePinMismatchError(thrown)).toBe(true);
        expect(extractor.extract).not.toHaveBeenCalled();
    });

    it('refuses pins whose roles are not exactly the extractor’s, before reading any file', async () => {
        const extractor = { ...spyExtractor([PORT]), roles: ['foods', 'composition'] };
        let thrown: unknown;

        try {
            await rebuildTableExtract({
                pins: pinsFor(sha256('the published bytes')),
                upstreamDir: dir,
                extractor,
                keys: new Set(['17-234']),
            });
        } catch (error) {
            thrown = error;
        }

        expect(isSourcePinsFormatError(thrown)).toBe(true);
        expect(extractor.extract).not.toHaveBeenCalled();
    });

    it('refuses output the committed extract format would refuse, so --write never writes a file the seed rejects', async () => {
        const tail = { ...PORT, values: { ENERC_KCAL: '157.0001' } };

        await expect(
            rebuildTableExtract({
                pins: pinsFor(sha256('the published bytes')),
                upstreamDir: dir,
                extractor: spyExtractor([tail]),
                keys: new Set(['17-234']),
            }),
        ).rejects.toThrow(expect.objectContaining({ name: 'SourceExtractFormatError' }));
    });

    it.each([
        ['a key nobody requested', [PORT, GIN], new Set(['17-234'])],
        ['one key twice', [PORT, PORT], new Set(['17-234'])],
    ])('refuses an extractor that returns %s', async (_, lines, keys) => {
        await expect(
            rebuildTableExtract({
                pins: pinsFor(sha256('the published bytes')),
                upstreamDir: dir,
                extractor: spyExtractor(lines),
                keys,
            }),
        ).rejects.toThrow(expect.objectContaining({ name: 'TableFormatError' }));
    });
});
