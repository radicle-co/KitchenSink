/**
 * The deploy-time CRF smoke's pure classifiers.
 *
 * ## Why this smoke exists at all
 *
 * ADR-0025 records, as a standing residual, that the asset's arm64 / CPython 3.13 wheels "have never been
 * loaded by a Python 3.13 interpreter on ARM" and that "the first real proof is a deploy". A Lambda whose
 * code package cannot import deploys CLEAN — `cdk deploy` exits 0, CloudFormation reports success — and
 * dies on its first cold start. Nothing downstream reports that: `crfInvoke.ts` maps a failed invoke to
 * `unavailable` per line and ADR-0026 §3 has the pipeline read that as `single-engine llm`, which is the
 * RIGHT behaviour (absence is not dissent) and is exactly why a permanently broken engine is invisible.
 *
 * So the deploy is the only place it can be caught, and this is the only check that fires at zero traffic.
 *
 * ## What is asserted here, and what is not
 *
 * Every decision the smoke makes is a pure function of what the invocation returned, so all of them are
 * tested directly. The I/O — spawning the CLI, the single throttle retry, reading the payload file — lives
 * in `main` and is exercised end to end by the deploy itself; there is nothing between the classifiers and
 * the CLI worth a mock.
 *
 * ⛔ The engine's response shape is NOT re-asserted here. It is validated in the smoke by
 * `parseEngineResponse`, the package's own zod, whose contract is covered by
 * `src/__tests__/engine.schema.test.ts`. A second description of that shape in this file would be the
 * drift ADR-0014 and ADR-0025 are both written around.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    classifyEngineVersion,
    classifyInvocation,
    classifyPayload,
    classifyReading,
    pinnedEngineVersion,
} from '../smoke/deployedSmoke.js';

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('classifyInvocation — `aws lambda invoke` exits 0 when the FUNCTION threw', () => {
    it('accepts a clean invocation', () => {
        expect(classifyInvocation(0, 'None\n', '')).toMatchObject({ ok: true });
    });

    it('⛔ FAILS a FunctionError — the cold-start ImportError ADR-0025 warns about', () => {
        const verdict = classifyInvocation(0, 'Unhandled', '');

        expect(verdict.ok).toBe(false);
        // The message has to name the likely cause, because at 3am "the engine threw" is not actionable and
        // the arm64 wheels are the standing suspect on a first deploy.
        expect(verdict.reason).toMatch(/arm64/);
    });

    it('⛔ FAILS a transport failure, and keeps the CLI’s own diagnostic', () => {
        const verdict = classifyInvocation(255, '', 'An error occurred (ResourceNotFoundException)');

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toMatch(/ResourceNotFoundException/);
    });

    it('treats an empty or null FunctionError as "did not throw"', () => {
        // `--query FunctionError --output text` prints `None`; other shapes print nothing. Neither is a
        // failure, and reading either as one would red every healthy deploy.
        expect(classifyInvocation(0, '', '').ok).toBe(true);
        expect(classifyInvocation(0, 'null', '').ok).toBe(true);
    });
});

describe('classifyPayload — a transport success carrying nothing is not a healthy engine', () => {
    it('accepts a payload', () => {
        expect(classifyPayload('{"engine":"crf"}').ok).toBe(true);
    });

    it('⛔ FAILS an empty payload', () => {
        expect(classifyPayload('   \n').ok).toBe(false);
    });
});

describe('classifyEngineVersion — the deployed engine must be the PINNED engine', () => {
    it('accepts the pinned version', () => {
        expect(classifyEngineVersion('2.3.0', '2.3.0').ok).toBe(true);
    });

    it('⛔ FAILS a version the pin does not name, and says why it matters', () => {
        const verdict = classifyEngineVersion('2.3.0', '2.4.0');

        expect(verdict.ok).toBe(false);
        // Not cosmetic: the engine version is part of the parse cache key precisely so a bump cannot reuse
        // the previous model's answers.
        expect(verdict.reason).toMatch(/cach/i);
    });
});

describe('classifyReading — the proof the interpreter loaded and the MODEL ran', () => {
    it('accepts one parsed row for one submitted line', () => {
        expect(classifyReading(['parsed']).ok).toBe(true);
    });

    it('⛔ FAILS when the engine refuses the simplest possible line', () => {
        const verdict = classifyReading(['failed']);

        expect(verdict.ok).toBe(false);
        // The distinction the message must preserve: the function RAN, so this is the model or its data,
        // not the packaging — a different thing to go and look at.
        expect(verdict.reason).toMatch(/not the packaging/);
    });

    it('⛔ FAILS when the batch is not echoed one-for-one', () => {
        expect(classifyReading([]).ok).toBe(false);
        expect(classifyReading(['parsed', 'parsed']).ok).toBe(false);
    });
});

describe('pinnedEngineVersion — the version is DERIVED from requirements.txt, never restated', () => {
    it('reads the real pin', () => {
        // Anchors the derivation against the actual file: a copy of the number in the smoke would be a
        // fourth place for a pin ADR-0025 already calls load-bearing three times over to drift.
        expect(pinnedEngineVersion(path.join(packageRoot, 'requirements.txt'))).toMatch(/^\d+\.\d+\.\d+$/u);
    });

    it('⛔ refuses a requirements file that does not pin the engine exactly', () => {
        expect(() => pinnedEngineVersion(path.join(packageRoot, 'package.json'))).toThrow(/does not pin/u);
    });
});
