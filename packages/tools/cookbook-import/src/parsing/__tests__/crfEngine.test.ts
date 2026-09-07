/**
 * THE LOCAL PYTHON CRF, AS A PORT (plan U22, phase 5).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | KTD-13 — the version identifying the engine is the INSTALLED one | "the version it reports" |
 * | U22 — one answer per line, in order | "reads a batch in one process" |
 * | KTD-12 — a batch that died is absence, and the pipeline reads it as such | "a sidecar that dies" |
 * | HAZ-041 — `raw` is the SUBMITTED line, never the engine's echo of it | "raw is the line we sent" |
 *
 * ⚠️ Every case here runs a REAL process over a fake sidecar and a fake interpreter shim — the seam
 * `crfProcess.ts` deliberately left open ("so the adapter's four failure paths … are reachable from the unit
 * tier with a two-line fake instead of only from a machine that has the CRF model installed"). The tier that
 * runs the REAL engine is `tests/parsePipeline.integration.test.ts`.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { createCrfEngine } from '../crfEngine.js';

/** Whether a Python 3 interpreter and a POSIX shell are on this machine at all. */
function hasPython(): boolean {
    try {
        execFileSync('python3', ['-c', 'pass'], { stdio: 'ignore' });

        return process.platform !== 'win32';
    } catch {
        return false;
    }
}

const describeIfPython = hasPython() ? describe : describe.skip;

/** Write a throwaway file, optionally executable, and return its path. */
function fixture(name: string, body: string, executable = false): string {
    const path = join(mkdtempSync(join(tmpdir(), 'crfEngine-')), name);

    writeFileSync(path, body, 'utf8');

    if (executable) {
        chmodSync(path, 0o755);
    }

    return path;
}

/** A sidecar that echoes each line back as a single measured food. */
const ECHOING_SIDECAR = fixture(
    'fake.py',
    `import json, sys
for raw in sys.stdin:
    raw = raw.strip()
    if not raw:
        continue
    line = json.loads(raw)
    print(json.dumps({
        "sentence": line,
        "measure": "1 tablespoon",
        "names": [line],
        "size": None,
        "preparation": None,
        "comment": None,
    }))
`,
);

/** A sidecar that SHOUTS its echo — the mispairing `crfProcess.ts` calls "silent and total". */
const MISPAIRING_SIDECAR = fixture(
    'mispairs.py',
    `import json, sys
for raw in sys.stdin:
    raw = raw.strip()
    if not raw:
        continue
    line = json.loads(raw)
    print(json.dumps({
        "sentence": line.upper(),
        "measure": "",
        "names": [line],
        "size": None,
        "preparation": None,
        "comment": None,
    }))
`,
);

/** A sidecar that dies before printing anything. */
const DYING_SIDECAR = fixture('dies.py', 'import sys\nsys.exit(3)\n');

/**
 * An interpreter SHIM that reports a version we choose, and otherwise defers to the real `python3`.
 *
 * ⚠️ A shim rather than a stub, because the adapter uses the SAME interpreter for both jobs — reading the
 * installed version and running the sidecar — and that is the property worth exercising: a version read from
 * one interpreter while another ran the parse would name an engine that never answered.
 */
const INTERPRETER_SHIM = fixture(
    'python-shim',
    `#!/bin/sh
case "$1" in
  -c) echo "9.9.9" ;;
  *) exec python3 "$@" ;;
esac
`,
    true,
);

/** An interpreter shim that reports NO version — the engine is not installed. */
const BARE_INTERPRETER = fixture(
    'python-bare',
    `#!/bin/sh
case "$1" in
  -c) echo "ModuleNotFoundError" >&2; exit 1 ;;
  *) exec python3 "$@" ;;
esac
`,
    true,
);

describeIfPython('createCrfEngine', () => {
    it('reports the version the INTERPRETER has installed, never a constant of ours', async () => {
        // ⛔ `ingredient_parse_cache` is keyed on the version and its write is `DO NOTHING`, so a row written
        // under a declared-but-wrong version is PERMANENT within its generation. `requirements.txt`'s own
        // docstring already counts three places holding this pin; a fourth in TypeScript would be one nothing
        // keeps in step.
        const engine = await createCrfEngine({ python: INTERPRETER_SHIM, script: ECHOING_SIDECAR });

        expect(engine.engineVersion).toBe('ingredient-parser-nlp==9.9.9');
        expect(engine.engine).toBe('crf');
    }, 30_000);

    it('REFUSES to build when the engine is not installed, and says how to install it', async () => {
        // The honest failure, and the one worth having at wiring time rather than 2,000 lines into a run.
        await expect(createCrfEngine({ python: BARE_INTERPRETER, script: ECHOING_SIDECAR })).rejects.toThrow(
            /pip3 install/u,
        );
    }, 30_000);

    it('reads a batch in ONE process, one answer per line, in order', async () => {
        const engine = await createCrfEngine({ python: INTERPRETER_SHIM, script: ECHOING_SIDECAR });
        const answers = await engine.parse(['butter', 'sugar', 'flour']);

        expect(answers).toHaveLength(3);
        expect(answers.map((one) => ('unavailable' in one ? null : one.foods[0]?.name))).toEqual([
            'butter',
            'sugar',
            'flour',
        ]);
    }, 30_000);

    it('raw is the line WE sent, never the engine`s echo of it', async () => {
        // ⛔ `crfParse.ts` documents `sentence` as "the line as it was submitted, echoed back" while
        // `engine.schema.ts` documents the SAME field as "the parser's NORMALISED sentence". They cannot both
        // be true, so the adapter believes neither and passes the line it sent.
        const engine = await createCrfEngine({ python: INTERPRETER_SHIM, script: ECHOING_SIDECAR });
        const [one] = await engine.parse(['One and one-half cups of flour']);

        expect(one !== undefined && !('unavailable' in one) ? one.raw : null).toBe('One and one-half cups of flour');
    }, 30_000);

    it('a sidecar whose echo does not match REJECTS the batch — the stream is mispaired', async () => {
        // ⛔ The failure `crfProcess.ts` calls "the one failure here that corrupts the headline result
        // silently and totally": any count-preserving reordering pairs every model answer with a DIFFERENT
        // line's CRF reading, and every agreement figure looks perfectly clean. It is asserted at the process
        // layer, which is why this adapter does not re-derive it — and why this test proves it still fires.
        const engine = await createCrfEngine({ python: INTERPRETER_SHIM, script: MISPAIRING_SIDECAR });

        await expect(engine.parse(['butter'])).rejects.toThrow(/mispaired/u);
    }, 30_000);

    it('promotes the measure through the SHARED reading', async () => {
        const engine = await createCrfEngine({ python: INTERPRETER_SHIM, script: ECHOING_SIDECAR });
        const [one] = await engine.parse(['butter']);

        expect(one !== undefined && !('unavailable' in one) ? one.quantity : null).toEqual({ kind: 'exact', value: 1 });
        expect(one !== undefined && !('unavailable' in one) ? one.unit : null).toBe('tablespoon');
    }, 30_000);

    it('a sidecar that DIES rejects the whole batch rather than inventing per-line answers', async () => {
        // ⛔ It cannot tell which line it died on, so a per-line answer here would be an invention — and a
        // batch that half-succeeded would report a denominator it did not earn. The pipeline reads the
        // rejection as absence for EVERY line, which is KTD-12's correct outcome and the one ADR-0026
        // predicts for a CRF leg that fails to import.
        const engine = await createCrfEngine({ python: INTERPRETER_SHIM, script: DYING_SIDECAR });

        await expect(engine.parse(['butter'])).rejects.toThrow(/exited 3/u);
    }, 30_000);

    it('an empty batch costs no process at all', async () => {
        // The Lambda's own contract calls an empty batch "a caller defect (it costs a cold start to answer
        // nothing)", and `parseLinesWithCrf` short-circuits it. A run whose every line was corrected reaches
        // this path legitimately.
        const engine = await createCrfEngine({ python: INTERPRETER_SHIM, script: DYING_SIDECAR });

        await expect(engine.parse([])).resolves.toEqual([]);
    }, 30_000);
});
