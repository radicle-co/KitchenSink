/**
 * The CRF engine's WIRE CONTRACT, and the boundary that refuses anything else (ADR-0015 §3, GR-016).
 *
 * ## Why the response is validated at all when we wrote the handler ourselves
 *
 * Because the answer is not ours. `handler.py` flattens whatever `ingredient-parser-nlp` returned, and that
 * library is a third-party CRF whose output shape moves between releases — the case ADR-0014 calls the
 * INVERSE: a contract we do not own, validated at the boundary, with the consuming side declaring its own
 * type. A Lambda invocation is also a network hop that can return a throttle, a truncated body or another
 * function's payload entirely, and `Payload` is `any` at the SDK. So the response is parsed on receipt,
 * before it becomes anything.
 *
 * ## ⛔ `foundation_foods` is refused, not ignored
 *
 * The engine can attach an FDC match to each name. Accepting it would stand up a second, unowned
 * ingredient-resolution authority beside `resolutionCascade.ts`, and it is measurably wrong (it mis-mapped
 * soy flour in the sample). `strictObject` is what makes that a REFUSAL rather than a silent drop: if a
 * future handler starts emitting the field, this boundary fails loudly instead of letting the key travel
 * one layer further every release until somebody reads it.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    MAX_LINES,
    MAX_LINE_CHARS,
    engineRequestSchema,
    engineResponseSchema,
    parseEngineResponse,
} from '../engine.schema.js';

const parsedRow = {
    status: 'parsed',
    sentence: '1 cup plain flour',
    measure: '1 cup',
    names: ['plain flour'],
    size: null,
    preparation: null,
    comment: null,
};

const response = { engine: 'crf', engineVersion: '2.3.0', results: [parsedRow] };

describe('engineResponseSchema', () => {
    it('accepts the shape the handler emits', () => {
        expect(engineResponseSchema.safeParse(response).success).toBe(true);
    });

    it('accepts a per-line failure alongside a parse, because failure is per line', () => {
        const mixed = {
            ...response,
            results: [parsedRow, { status: 'failed', sentence: 'nonsense', reason: 'ValueError' }],
        };

        expect(engineResponseSchema.safeParse(mixed).success).toBe(true);
    });

    it('refuses a foundation_foods field rather than dropping it', () => {
        // ⛔ THE ASSERTION THIS FILE EXISTS FOR. A non-strict object would report success here and hand the
        // caller a value with the key quietly removed, which is how an unowned resolution authority gets
        // adopted by accident.
        const withFoundationFoods = {
            ...response,
            results: [{ ...parsedRow, foundation_foods: [{ fdc_id: 168_894, text: 'soy flour' }] }],
        };

        expect(engineResponseSchema.safeParse(withFoundationFoods).success).toBe(false);
    });

    it('refuses a result whose status it does not know', () => {
        const unknownStatus = { ...response, results: [{ ...parsedRow, status: 'partial' }] };

        expect(engineResponseSchema.safeParse(unknownStatus).success).toBe(false);
    });

    it('refuses a parsed row missing a field the caller reads', () => {
        const { measure: _dropped, ...withoutMeasure } = parsedRow;

        expect(engineResponseSchema.safeParse({ ...response, results: [withoutMeasure] }).success).toBe(false);
    });

    it('refuses names that are not strings, rather than coercing them', () => {
        const coerced = { ...response, results: [{ ...parsedRow, names: [7] }] };

        expect(engineResponseSchema.safeParse(coerced).success).toBe(false);
    });

    it('accepts an empty results array only when the caller asked for nothing — the schema does not judge', () => {
        // Boundary note, asserted so it is a decision rather than an oversight: an empty batch is refused by
        // the REQUEST schema, so an empty `results` can only mean the engine answered a request that never
        // passed validation. That is a caller-side invariant, not a shape rule, and is checked below.
        expect(engineResponseSchema.safeParse({ ...response, results: [] }).success).toBe(true);
    });
});

describe('parseEngineResponse', () => {
    it('returns the parsed value for a well-formed response', () => {
        const parsed = parseEngineResponse(response);

        expect(parsed.results[0]).toMatchObject({ status: 'parsed', names: ['plain flour'] });
    });

    it('throws naming the offending path rather than propagating the value', () => {
        // A malformed engine answer must not travel. The message carries the failing path so an operator can
        // tell "the engine changed shape" from "the invoke returned somebody else's payload".
        expect(() => parseEngineResponse({ engine: 'crf', engineVersion: '2.3.0', results: [{}] })).toThrow(/results/u);
    });

    it('throws on a response that is not an object at all', () => {
        // `InvokeCommand`'s `Payload` is `any`, and a throttled or truncated invoke can yield a string.
        expect(() => parseEngineResponse('ServiceException')).toThrow(/ingredient-parser/u);
    });

    it('does not return the input object it was handed', () => {
        // Negative control for the two above: a boundary that returns its input unvalidated would pass every
        // happy-path assertion in this file.
        const source = { ...response, results: [{ ...parsedRow, foundation_foods: [] }] };

        expect(() => parseEngineResponse(source)).toThrow();
    });
});

describe('engineRequestSchema', () => {
    it('accepts a batch of lines', () => {
        expect(engineRequestSchema.safeParse({ lines: ['1 cup flour'] }).success).toBe(true);
    });

    it('refuses an empty batch, so a no-op invocation is a caller defect and not a silent success', () => {
        expect(engineRequestSchema.safeParse({ lines: [] }).success).toBe(false);
    });

    it('refuses more lines than the handler will accept', () => {
        expect(engineRequestSchema.safeParse({ lines: Array.from({ length: 201 }, () => 'flour') }).success).toBe(
            false,
        );
    });

    it('refuses a line longer than the handler will accept', () => {
        expect(engineRequestSchema.safeParse({ lines: ['x'.repeat(513)] }).success).toBe(false);
    });

    it('states the same bounds the Python handler enforces', () => {
        // ⛔ THE CROSS-LANGUAGE SEAM, and the one place in this package where the two representations of one
        // piece of knowledge can drift. `MAX_LINES` / `MAX_LINE_CHARS` live in `handler.py` (which enforces
        // them at run time) and in the zod above (which is what callers are written against). NOTHING else in
        // this repository can see both: eslint does not read `.py`, the typecheck project does not include
        // it, and `packaging.test.ts` only asks whether files are present, never what they say.
        //
        // Read with the interpreter's own `ast`, not a regex, for the reason `assetInspection.ts` records —
        // a textual match reads the numbers in this comment. It is not IMPORTED from there because that
        // module belongs to the `infra/` tsconfig project, and reaching across would relocate a compile
        // boundary to save five lines.
        const program = [
            'import ast, sys, json',
            "tree = ast.parse(open(sys.argv[1], encoding='utf-8').read())",
            'found = {}',
            'for node in tree.body:',
            '    if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant):',
            '        for target in node.targets:',
            '            if isinstance(target, ast.Name):',
            '                found[target.id] = node.value.value',
            'print(json.dumps(found))',
        ].join('\n');
        const handler = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'handler.py');
        const constants = JSON.parse(execFileSync('python3', ['-c', program, handler], { encoding: 'utf8' })) as Record<
            string,
            unknown
        >;

        expect(constants['MAX_LINES'], 'handler.py no longer declares MAX_LINES').toBe(MAX_LINES);
        expect(constants['MAX_LINE_CHARS'], 'handler.py no longer declares MAX_LINE_CHARS').toBe(MAX_LINE_CHARS);
    });
});
