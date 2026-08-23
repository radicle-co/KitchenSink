/**
 * The adapter's FAILURE paths, driven by fake sidecars.
 *
 * ⚠️ These use a real child process running `node -e`, not a mocked `spawn`: the defects this file guards
 * against — a broken pipe, a stream that desynchronises, a half-written stdout — are properties of real
 * pipes, and a mock that resolves a promise would prove none of them. The happy path against the REAL CRF
 * model is `tests/crfParse.integration.test.ts`; this tier proves what happens when it goes wrong.
 */
import { describe, expect, it } from 'vitest';

import { parseLinesWithCrf } from '../crfProcess.js';

const ECHO_ROWS = `
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
    for (const raw of chunks.join('').split('\\n').filter((r) => r.trim().length > 0)) {
        const sentence = JSON.parse(raw);
        process.stdout.write(JSON.stringify({ sentence, measure: '', names: [], size: null, preparation: null, comment: null }) + '\\n');
    }
});
`;

/** Write a program to a temp file and hand its path to the adapter. */
async function runFake(program: string, lines: readonly string[]) {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'crf-fake-'));
    const script = join(dir, 'fake.mjs');

    writeFileSync(script, program, 'utf8');

    return parseLinesWithCrf(lines, { python: process.execPath, script });
}

describe('parseLinesWithCrf failure paths', () => {
    it('returns nothing for no input, without starting a process', async () => {
        expect(await parseLinesWithCrf([], { python: '/definitely/not/an/interpreter' })).toEqual([]);
    });

    it("reports the sidecar's exit code and stderr rather than a stack trace", async () => {
        await expect(
            runFake('process.stderr.write("ImportError: no ingredient_parser"); process.exit(3);', ['two eggs']),
        ).rejects.toThrow(/exited 3.*ImportError: no ingredient_parser/s);
    });

    it('survives a sidecar that dies BEFORE draining a corpus-sized stream — the broken-pipe case', async () => {
        // 40,000 lines is far past the 64 KB pipe buffer, so the write really does break mid-stream. Without
        // the stdin error handler this raises an uncaught EPIPE and kills the process instead of reporting.
        const lines = Array.from({ length: 40_000 }, (_, index) => `line ${index}`);

        await expect(runFake('process.stderr.write("boom"); process.exit(1);', lines)).rejects.toThrow(/exited 1/);
    }, 30_000);

    it("refuses a row it cannot read as the sidecar's shape", async () => {
        await expect(runFake('process.stdout.write("not json\\n");', ['two eggs'])).rejects.toThrow(/not JSON/);
    });

    it('refuses a run that produced the wrong number of rows', async () => {
        await expect(runFake(ECHO_ROWS, ['two eggs', 'a cup of milk']).then(() => 'ok')).resolves.toBe('ok');
        await expect(runFake('process.stdout.write("");', ['two eggs'])).rejects.toThrow(/returned 0 rows for 1 lines/);
    });

    it('⛔ refuses a stream that desynchronised, even though the COUNT still matches', async () => {
        const reversing = `
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
    const rows = chunks.join('').split('\\n').filter((r) => r.trim().length > 0).reverse();
    for (const raw of rows) {
        const sentence = JSON.parse(raw);
        process.stdout.write(JSON.stringify({ sentence, measure: '', names: [], size: null, preparation: null, comment: null }) + '\\n');
    }
});
`;

        await expect(runFake(reversing, ['two eggs', 'a cup of milk'])).rejects.toThrow(/mispaired/);
    });

    it('accepts a well-behaved sidecar, in order', async () => {
        const parses = await runFake(ECHO_ROWS, ['two eggs', 'a cup of milk', '3 cloves garlic']);

        expect(parses.map((parse) => parse.sentence)).toEqual(['two eggs', 'a cup of milk', '3 cloves garlic']);
    });

    it('rejects when the interpreter does not exist, rather than hanging', async () => {
        await expect(parseLinesWithCrf(['two eggs'], { python: '/definitely/not/an/interpreter' })).rejects.toThrow();
    });
});
