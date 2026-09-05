/**
 * INTEGRATION TIER — the handler against the REAL CRF engine, and its answer against the REAL zod.
 *
 * This is as close to "a deployed invocation returns a parse for a known line" as anything that does not
 * deploy can get: the handler module is imported into a real interpreter with `ingredient-parser-nlp`
 * installed, invoked, and its answer fed through the boundary the caller will use. A unit test can prove
 * neither half — it would mock the engine, and the engine's output shape IS the thing under test.
 *
 * ## ⛔ It also reproduces the READ-ONLY FILESYSTEM, because that is how this function first died
 *
 * The engine's `en/_utils.py` calls `download_nltk_resources()` at IMPORT. If the part-of-speech tagger is
 * not on nltk's search path it calls `nltk.download(…)`, whose first act is `os.makedirs` under `$HOME`.
 * On Lambda that raised `OSError: [Errno 30] Read-only file system: '/home/sbx_user1051'` — after a green
 * build, a green synth and a successfully-loaded code package. A test asserting that `NLTK_DATA` is SET
 * would not have caught it and would not catch its return; only running the import path can.
 *
 * So the two tests at the bottom invoke the handler with `HOME` pointed at a directory it may not write,
 * once WITHOUT the staged corpus (which must fail, exactly there) and once WITH it (which must parse).
 *
 * ⚠️ Needs `python3` with `ingredient-parser-nlp==2.3.0` installed (`.github/workflows/_ci.yml` already
 * installs it for the cookbook-import parse comparison, in the same job that calls this tier). SKIPS with a
 * loud reason rather than failing when it is absent, mirroring how the DB-backed tiers guard on
 * `DATABASE_URL` — but it is called by name from CI, so the skip is a local convenience, not a hiding place.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseEngineResponse } from '../src/engine.schema.js';
import { ASSET_DIRECTORY, NLTK_DATA_DIRECTORY } from '../infra/lib/packaging.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = path.join(packageRoot, 'src');
const stagedCorpus = path.join(packageRoot, ASSET_DIRECTORY, NLTK_DATA_DIRECTORY);

/** Whether this machine can import the engine at all. */
function engineInstalled(): boolean {
    try {
        execFileSync('python3', ['-c', 'import ingredient_parser'], { stdio: 'ignore' });

        return true;
    } catch {
        return false;
    }
}

/**
 * Invoke `handler.handle` in a real interpreter and return its raw answer.
 *
 * @param event - The event to pass, serialized as JSON.
 * @returns The handler's return value, decoded but NOT validated — validating here would hide the very
 *   thing the assertions below are for.
 * @sideEffect Spawns `python3`.
 */
function invoke(event: unknown): unknown {
    const program = [
        'import json, sys',
        'sys.path.insert(0, sys.argv[1])',
        'from handler import handle',
        'print(json.dumps(handle(json.loads(sys.argv[2]))))',
    ].join('\n');

    return JSON.parse(
        execFileSync('python3', ['-c', program, sourceDirectory, JSON.stringify(event)], { encoding: 'utf8' }),
    ) as unknown;
}

/**
 * Invoke `handler.handle` with a chosen environment, and report how it went.
 *
 * @param environment - Variables to set (or, for `undefined`, to REMOVE) for the child.
 * @returns The child's exit status and its merged output.
 * @sideEffect Spawns `python3`.
 */
function invokeWithEnvironment(environment: Readonly<Record<string, string | undefined>>): {
    readonly status: number;
    readonly output: string;
} {
    const program = [
        'import json, sys',
        'sys.path.insert(0, sys.argv[1])',
        'from handler import handle',
        'print(json.dumps(handle({"lines": ["1 cup plain flour, sifted"]})))',
    ].join('\n');

    // ⚠️ The engine is installed into the USER site directory, which python resolves through `$HOME`.
    // Moving `$HOME` to make the download fail would otherwise also hide the engine, and the test would
    // pass its negative control for the wrong reason. Resolved under the REAL home, before it moves.
    const userSite = execFileSync('python3', ['-m', 'site', '--user-site'], { encoding: 'utf8' }).trim();
    const child = spawnSync('python3', ['-c', program, sourceDirectory], {
        encoding: 'utf8',
        env: Object.fromEntries(
            Object.entries({ ...process.env, PYTHONPATH: userSite, ...environment }).filter(
                ([, value]) => value !== undefined,
            ),
        ) as NodeJS.ProcessEnv,
    });

    return { status: child.status ?? -1, output: `${child.stdout ?? ''}${child.stderr ?? ''}` };
}

/**
 * A directory the current user may not write into, standing in for Lambda's read-only `$HOME`.
 *
 * @param run - What to do while it exists.
 * @sideEffect Creates, chmods and removes a temporary directory.
 */
function withUnwritableHome(run: (home: string) => void): void {
    const home = mkdtempSync(path.join(tmpdir(), 'crf-readonly-home-'));

    chmodSync(home, 0o555);

    try {
        run(home);
    } finally {
        // Restored so the run's temp-root teardown can remove it.
        chmodSync(home, 0o755);
    }
}

describe.skipIf(!engineInstalled())('the CRF handler, against the real engine', () => {
    it('returns a parse for a known line that survives the boundary', () => {
        const response = parseEngineResponse(invoke({ lines: ['1 cup plain flour, sifted'] }));
        const [result] = response.results;

        expect(response.engine).toBe('crf');
        expect(result?.status).toBe('parsed');

        if (result?.status !== 'parsed') {
            return;
        }

        expect(result.names.join(' ')).toContain('flour');
        expect(result.measure).toContain('cup');
        expect(result.preparation).toContain('sifted');
    });

    it('echoes every submitted line back, in order, so a caller can assert the pairing', () => {
        const lines = ['2 eggs', '1 tbsp olive oil', 'a pinch of salt'];
        const response = parseEngineResponse(invoke({ lines }));

        expect(response.results).toHaveLength(lines.length);
        expect(response.results.map((result) => result.sentence.toLowerCase())).toEqual(
            expect.arrayContaining([expect.stringContaining('egg')]),
        );
    });

    it('never emits foundation_foods, which is what the boundary would refuse', () => {
        // ⛔ The engine CAN attach an FDC match. Consuming it would stand up a second, unowned resolution
        // authority beside `resolutionCascade.ts` — and it is measurably wrong. `parseEngineResponse` is
        // strict, so this assertion is really "the handler never even offers it": if it ever did, the call
        // above would throw rather than silently dropping the key.
        const raw = invoke({ lines: ['1 cup soy flour'] }) as { results: Record<string, unknown>[] };

        expect(raw.results.every((result) => !('foundation_foods' in result))).toBe(true);
        expect(() => parseEngineResponse(raw)).not.toThrow();
    });

    it('reports the engine version the requirements pin, because the cache key depends on it', () => {
        const response = parseEngineResponse(invoke({ lines: ['1 onion'] }));

        expect(response.engineVersion).toBe('2.3.0');
    });

    it('refuses a request outside the declared bounds rather than parsing what it can', () => {
        // The refusal must reach the caller as a failed invocation, not as an empty answer.
        expect(() => invoke({ lines: [] })).toThrow();
        expect(() => invoke({ lines: [''] })).toThrow();
        expect(() => invoke({ lines: ['x'.repeat(513)] })).toThrow();
        expect(() => invoke({ notLines: ['1 onion'] })).toThrow();
    });

    it('answers per line, so nonsense beside a real line loses neither', () => {
        // Per-line failure is the contract. Whether the CRF chokes on the first line or gamely reads it is
        // the engine's business — what must hold is that the batch still returns two results, each carrying
        // its own status, rather than the invocation failing as a whole.
        const response = parseEngineResponse(invoke({ lines: ['!!! ??? ###', '1 cup water'] }));

        expect(response.results).toHaveLength(2);
        expect(response.results.every((result) => result.status === 'parsed' || result.status === 'failed')).toBe(true);
        expect(response.results.at(-1)?.status).toBe('parsed');
    });
});

/**
 * THE PROOF OF THE FIX, by invocation rather than inspection.
 *
 * ⛔ These are the tests that would have caught the defect. Everything above imports the engine in an
 * environment where the tagger happens to be on nltk's search path already (`~/nltk_data` on a developer
 * machine), so all of it passed while the deployed function was throwing on its first cold start.
 *
 * ⚠️ NEEDS NETWORK, which the rest of this file did not. The negative control lets the engine get as far as
 * `nltk.download`, and nltk fetches its package index before it touches the filesystem — so without network
 * the control fails with a `URLError` instead of the permission error it is asserting. The tier this file
 * belongs to already requires network for pip, and CI runs it in that job.
 *
 * Both run with `$HOME` pointed at a directory the process may not write into. On Lambda the whole
 * filesystem outside `/tmp` is mounted read-only and `os.makedirs` reports `EROFS` (errno 30); here the
 * directory is merely mode 0555 and it reports `EACCES` (errno 13). ⚠️ Stated rather than glossed: the
 * errno differs, because a test cannot mount a read-only filesystem. What is identical is the thing that
 * matters — the same `os.makedirs` call in `nltk/downloader.py` raises `OSError`, so a build that has not
 * staged the corpus cannot pass by quietly downloading it.
 */
describe.skipIf(!engineInstalled())('the staged NLTK corpus, on a filesystem the engine cannot write to', () => {
    beforeAll(() => {
        // The corpus is a build product. The packaging tier stages it too, but file order is not a
        // contract, so this tier makes sure of its own precondition rather than inheriting one.
        if (!existsSync(stagedCorpus)) {
            execFileSync('npx', ['tsx', 'infra/bin/buildAsset.ts'], { cwd: packageRoot, stdio: 'inherit' });
        }
    }, 600_000);

    it('⛔ NEGATIVE CONTROL — without it, the engine reaches for the network and dies writing to $HOME', () => {
        // Without this, the test below proves nothing: on any machine with `~/nltk_data` it would pass with
        // the corpus deleted from the asset entirely, which is the state that was DEPLOYED.
        withUnwritableHome((home) => {
            const attempt = invokeWithEnvironment({ HOME: home, NLTK_DATA: undefined });

            expect(attempt.status).not.toBe(0);
            // The engine's own line, then the failure. Both halves matter: the first says it decided to
            // download, the second says the filesystem refused — the production failure, one errno over.
            expect(attempt.output).toContain('Downloading required NLTK resource');
            expect(attempt.output).toMatch(/OSError|PermissionError/u);
            expect(attempt.output).toContain(path.join(home, 'nltk_data'));
        });
    });

    it('parses a line from the STAGED corpus alone, downloading nothing', () => {
        withUnwritableHome((home) => {
            const attempt = invokeWithEnvironment({ HOME: home, NLTK_DATA: stagedCorpus });

            expect(attempt.status, attempt.output).toBe(0);
            // ⛔ Not merely "it did not crash". The engine announces a download before attempting one, so
            // its ABSENCE is the assertion that the tagger was found in the asset.
            expect(attempt.output).not.toContain('Downloading required NLTK resource');

            const [result] = parseEngineResponse(JSON.parse(attempt.output)).results;

            expect(result?.status).toBe('parsed');

            if (result?.status !== 'parsed') {
                return;
            }

            // The part-of-speech tags this corpus provides are a CRF feature (`features["pos"]`), so a
            // parse this specific is also evidence the tagger was really read, not merely present.
            expect(result.names.join(' ')).toContain('flour');
            expect(result.measure).toContain('cup');
            expect(result.preparation).toContain('sifted');
        });
    });
});
