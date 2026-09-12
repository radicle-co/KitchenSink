/**
 * The pinned-archive Guard and its yauzl Adapter (plan U1, R2).
 *
 * The one property that matters most is ORDER: a byte that does not match its pin is refused BEFORE anything
 * reads the archive. So the tamper case observes `yauzl.fromBufferPromise` through a pass-through module mock
 * and asserts it was never called. A spy on this module's own export could not see that call under ESM.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { createHash } from 'node:crypto';

import { fromBufferPromise } from 'yauzl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeZip } from '../__fixtures__/zipFixture.js';
import { isSourcePinMismatchError } from '../sourcePin.errors.js';
import { isArchiveLayoutError, isSourcePinsFormatError } from '../usdaSourceArchive.errors.js';
import { openPinnedArchive, parseSourcePins, readPinnedBytes, zipEntrySource } from '../usdaSourceArchive.js';

vi.mock('yauzl', async (importOriginal) => {
    const actual = await importOriginal<typeof import('yauzl')>();

    return { ...actual, fromBufferPromise: vi.fn(actual.fromBufferPromise) };
});

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const PINS = {
    srLegacy: {
        upstream: 'FoodData_Central_sr_legacy_food_csv_2018-04.zip',
        upstreamSha256: 'a'.repeat(64),
        file: 'srLegacy201804.zip',
    },
    foundation: {
        upstream: 'FoodData_Central_foundation_food_csv_2026-04-30.zip',
        upstreamSha256: 'b'.repeat(64),
        file: 'foundation20260430.zip',
    },
    brandedFoods: {
        upstream: 'FoodData_Central_branded_food_csv_2026-04-30.zip',
        upstreamSha256: 'c'.repeat(64),
        extract: 'brandedExtract20260430.jsonl',
        extractSha256: 'd'.repeat(64),
    },
    fnddsPrior: {
        label: 'fndds-2021-2023+nhanes-2021-2023-day1',
        survey: { upstream: 'FoodData_Central_survey_food_csv_2024-10-31.zip', upstreamSha256: 'e'.repeat(64) },
        intake: { upstream: 'wweia_day1_frequencies.csv', upstreamSha256: 'f'.repeat(64) },
    },
    fndds: {
        upstreams: {
            survey: { upstream: 'FoodData_Central_survey_food_csv_2024-10-31.zip', upstreamSha256: 'e'.repeat(64) },
        },
        extract: 'fnddsExtract20241031.jsonl',
        extractSha256: '1'.repeat(64),
    },
};

describe('parseSourcePins', () => {
    it('parses the five pinned sources', () => {
        expect(parseSourcePins(JSON.stringify(PINS))).toEqual(PINS);
    });

    it.each([
        ['an unknown top-level entry', { ...PINS, survey: PINS.fnddsPrior.survey }],
        ['an unknown key inside an entry', { ...PINS, srLegacy: { ...PINS.srLegacy, note: 'x' } }],
        ['a missing entry', { srLegacy: PINS.srLegacy, foundation: PINS.foundation, brandedFoods: PINS.brandedFoods }],
        ['an upper-case digest', { ...PINS, srLegacy: { ...PINS.srLegacy, upstreamSha256: 'A'.repeat(64) } }],
        ['a short digest', { ...PINS, srLegacy: { ...PINS.srLegacy, upstreamSha256: 'a'.repeat(63) } }],
        ['a committed file name that is a path', { ...PINS, srLegacy: { ...PINS.srLegacy, file: '../srLegacy.zip' } }],
        ['a committed file name with a hyphen', { ...PINS, srLegacy: { ...PINS.srLegacy, file: 'sr-legacy.zip' } }],
        ['an upstream name that is a path', { ...PINS, srLegacy: { ...PINS.srLegacy, upstream: 'a/b.zip' } }],
        [
            'an FNDDS extract read from a different survey download than the prior',
            {
                ...PINS,
                fndds: {
                    ...PINS.fndds,
                    upstreams: { survey: { ...PINS.fndds.upstreams.survey, upstreamSha256: '9'.repeat(64) } },
                },
            },
        ],
    ])('refuses %s', (_label, pins) => {
        expect(() => parseSourcePins(JSON.stringify(pins))).toThrow(
            expect.objectContaining({ name: 'SourcePinsFormatError' }),
        );
    });

    it('refuses text that is not JSON with the same named error', () => {
        let caught: unknown;

        try {
            parseSourcePins('{');
        } catch (error) {
            caught = error;
        }

        expect(isSourcePinsFormatError(caught)).toBe(true);
    });
});

describe('readPinnedBytes', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'pinned-'));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('returns the bytes when they match the pin', async () => {
        const bytes = Buffer.from('pinned bytes');
        const path = join(dir, 'a.bin');
        writeFileSync(path, bytes);

        await expect(readPinnedBytes(path, sha256(bytes))).resolves.toEqual(bytes);
    });

    it('refuses one flipped byte, naming the file and both digests', async () => {
        const bytes = Buffer.from('pinned bytes');
        const path = join(dir, 'a.bin');
        const tampered = Buffer.from(bytes);
        tampered[0] = (tampered[0] ?? 0) ^ 0x01;
        writeFileSync(path, tampered);

        await expect(readPinnedBytes(path, sha256(bytes))).rejects.toSatisfy(
            (error: unknown) =>
                isSourcePinMismatchError(error) &&
                error.file === path &&
                error.expected === sha256(bytes) &&
                error.actual === sha256(tampered),
        );
    });

    it('refuses a missing file as a mismatch with no actual digest', async () => {
        await expect(readPinnedBytes(join(dir, 'absent.bin'), 'a'.repeat(64))).rejects.toSatisfy(
            (error: unknown) => isSourcePinMismatchError(error) && error.actual === null,
        );
    });

    it('refuses a pin that is not a SHA-256 digest before reading anything', async () => {
        const path = join(dir, 'a.bin');
        writeFileSync(path, 'x');

        await expect(readPinnedBytes(path, 'not-a-digest')).rejects.toThrow(/SHA-256/);
    });
});

describe('zipEntrySource', () => {
    it('lists file entries by basename, skipping directory entries', async () => {
        const source = await zipEntrySource(
            await makeZip({
                'FoodData_Central_x/': '',
                'FoodData_Central_x/food.csv': 'a',
                'FoodData_Central_x/nutrient.csv': 'b',
            }),
        );

        try {
            expect(source.names).toEqual(['food.csv', 'nutrient.csv']);
        } finally {
            source.close();
        }
    });

    it('streams an entry by basename, and answers undefined for a name it does not hold', async () => {
        const source = await zipEntrySource(await makeZip({ 'dir/food.csv': 'fdc_id\n1\n' }));

        try {
            const stream = await source.open('food.csv');

            if (stream === undefined) {
                throw new Error('food.csv should be present');
            }

            expect(await text(stream)).toBe('fdc_id\n1\n');
            await expect(source.open('food_portion.csv')).resolves.toBeUndefined();
        } finally {
            source.close();
        }
    });

    it('refuses two entries that share a basename, since a basename would then name two files', async () => {
        const bytes = await makeZip({ 'a/food.csv': '1', 'b/food.csv': '2' });

        await expect(zipEntrySource(bytes)).rejects.toSatisfy(isArchiveLayoutError);
    });

    it('refuses bytes that are not a zip with the named layout error', async () => {
        await expect(zipEntrySource(Buffer.from('not a zip'))).rejects.toSatisfy(isArchiveLayoutError);
    });
});

describe('openPinnedArchive', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'pinned-zip-'));
        vi.mocked(fromBufferPromise).mockClear();
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('opens an archive whose bytes match the pin', async () => {
        const bytes = await makeZip({ 'x/food.csv': 'a' });
        const path = join(dir, 'x.zip');
        writeFileSync(path, bytes);

        const source = await openPinnedArchive(path, sha256(bytes));

        try {
            expect(source.names).toEqual(['food.csv']);
            expect(fromBufferPromise).toHaveBeenCalledTimes(1);
        } finally {
            source.close();
        }
    });

    it('⛔ refuses a tampered archive byte BEFORE the zip reader ever sees the bytes', async () => {
        const bytes = await makeZip({ 'x/food.csv': 'a' });
        const tampered = Buffer.from(bytes);
        const last = tampered.length - 1;
        tampered[last] = (tampered[last] ?? 0) ^ 0x01;
        const path = join(dir, 'x.zip');
        writeFileSync(path, tampered);

        await expect(openPinnedArchive(path, sha256(bytes))).rejects.toSatisfy(isSourcePinMismatchError);
        expect(fromBufferPromise).not.toHaveBeenCalled();
    });
});
