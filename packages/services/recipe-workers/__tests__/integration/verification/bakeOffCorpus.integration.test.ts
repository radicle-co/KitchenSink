/**
 * THE CORPUS GENERATOR against a REAL seeded food catalog — the tier the unit suite structurally cannot cover.
 *
 * ⛔ WHAT A FIXTURE CATALOG CANNOT TELL YOU, and why each of these matters:
 *
 *  1. **That the SQL is right at all.** The unit tests hand the generator an array. They cannot tell you the
 *     query names columns that exist, that `status = 'RESOLVED'` is a legal comparison against the `food_status`
 *     enum, or that `tombstoned_at` is a column and not a field somebody imagined.
 *  2. **That the real catalog can actually FILL the classes.** The fixture is 24 rows chosen to have siblings
 *     and form counterparts. The seeded catalog is 8,094 USDA rows chosen by nobody, and whether ~2,100 of them
 *     invert cleanly is a fact about USDA's naming conventions that only the real data can settle.
 *  3. **That the run is reproducible END TO END**, not just inside one process — same seed, same catalog, two
 *     separate invocations of the CLI an operator actually types, byte for byte. That is the property the whole
 *     substitution rests on: a bake-off result nobody can regenerate is a result nobody can audit.
 *  4. **That every candidate is a real row of THAT catalog.** A generator that invented a plausible food name
 *     would produce a corpus whose "ground truth by construction" claim is false, and every unit test would
 *     still pass.
 *
 * ⛔ It runs the SCRIPT, as a subprocess, rather than importing its internals — because what has to work is the
 * command in the report's reproduction section, including its argument parsing and its file writing.
 *
 * Runs against `FOOD_DATABASE_URL`; skipped in lockstep without it.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { parseCorpusJsonl } from '../../../src/verification/corpus.js';

const FOOD_DATABASE_URL = process.env['FOOD_DATABASE_URL'];
const canRun = Boolean(FOOD_DATABASE_URL);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '../../../src/scripts/generateBakeOffCorpus.ts');

const run = promisify(execFile);

/** A corpus size small enough to keep the suite quick, large enough to fill all four classes. */
const TARGET_SIZE = 400;

let workspace = '';

/** Generate one corpus with the CLI, exactly as the report's reproduction section documents it. */
async function generate(fileName: string, seed: number): Promise<string> {
    const out = path.join(workspace, fileName);

    await run(
        'npx',
        [
            'tsx',
            SCRIPT,
            '--catalog-url',
            FOOD_DATABASE_URL ?? '',
            '--seed',
            String(seed),
            '--size',
            String(TARGET_SIZE),
            '--out',
            out,
        ],
        { cwd: path.join(__dirname, '../../..'), timeout: 120_000 },
    );

    return out;
}

describe.skipIf(!canRun)('generateBakeOffCorpus against the seeded catalog', () => {
    beforeAll(() => {
        workspace = mkdtempSync(path.join(tmpdir(), 'bakeoff-corpus-'));
    });

    afterAll(() => {
        rmSync(workspace, { recursive: true, force: true });
    });

    it('reproduces byte-for-byte across two separate invocations of the CLI', async () => {
        const first = await generate('a.jsonl', 4242);
        const second = await generate('b.jsonl', 4242);

        expect(readFileSync(second, 'utf8')).toBe(readFileSync(first, 'utf8'));
        expect(readFileSync(`${second}.manifest.json`, 'utf8')).toBe(readFileSync(`${first}.manifest.json`, 'utf8'));
    }, 180_000);

    it('offers only candidates that really exist in the catalog it read', async () => {
        const out = await generate('c.jsonl', 7);
        const lines = parseCorpusJsonl(readFileSync(out, 'utf8'));

        const client = new pg.Client({ connectionString: FOOD_DATABASE_URL });

        await client.connect();

        try {
            const names = await client.query<{ name: string }>('select name from food where name is not null');
            const known = new Set(names.rows.map((row) => row.name));

            expect(lines.length).toBeGreaterThan(0);

            for (const line of lines) {
                // ⛔ The claim "ground truth by construction" is FALSE the moment a candidate is invented.
                expect(known.has(line.candidateFoodName)).toBe(true);
                expect(known.has(line.sourceRowName ?? '')).toBe(true);
            }
        } finally {
            await client.end();
        }
    }, 180_000);

    it('fills every class the real catalog can supply, and records the one it cannot', async () => {
        const out = await generate('d.jsonl', 11);
        const manifest = JSON.parse(readFileSync(`${out}.manifest.json`, 'utf8')) as {
            catalogRowCount: number;
            invertibleRowCount: number;
            classBalance: Record<string, number>;
            classShortfalls: Record<string, number>;
        };

        // The three plentiful classes must hit the target exactly; the wrong-form class is genuinely scarce on
        // USDA data and is expected to fall short — that is a fact about the catalog, reported not hidden.
        expect(manifest.classBalance['correct']).toBe(TARGET_SIZE / 4);
        expect(manifest.classBalance['nearMissIdentity']).toBe(TARGET_SIZE / 4);
        expect(manifest.classBalance['quantityUnitError']).toBe(TARGET_SIZE / 4);
        expect(manifest.classShortfalls['correct']).toBe(0);
        expect(manifest.classBalance['wrongFormIdentity']).toBeGreaterThan(0);

        // A catalog that invert-filters down to nothing would produce a corpus of zero-length classes with no
        // other symptom, so the working set is asserted rather than assumed.
        expect(manifest.invertibleRowCount).toBeGreaterThan(500);
        expect(manifest.invertibleRowCount).toBeLessThan(manifest.catalogRowCount);
    }, 180_000);

    it('pairs each near miss with its correct twin, on real data', async () => {
        const out = await generate('e.jsonl', 13);
        const lines = parseCorpusJsonl(readFileSync(out, 'utf8'));
        const correct = lines.filter((line) => line.contrastClass === 'correct').map((line) => line.sourceLine);
        const nearMiss = lines
            .filter((line) => line.contrastClass === 'nearMissIdentity')
            .map((line) => line.sourceLine);

        expect(nearMiss.length).toBeGreaterThan(0);
        expect([...nearMiss].sort()).toEqual([...correct].sort());
    }, 180_000);
});
