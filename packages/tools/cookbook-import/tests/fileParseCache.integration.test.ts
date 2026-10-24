/**
 * Integration tier — THE FILE-BACKED PARSE CACHE UNDER THE REAL PIPELINE (plan item C).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | item C — a repeated import does not re-ask a line it already read | "a second run asks nothing" |
 * | item C — the defect this closes is real | "NO_CACHE re-asks every line" |
 * | `parsePipeline.ts` `readableDigests` — a reading that binds nothing is never remembered | "binds nothing" |
 * | KTD-13 — the identity includes the engine's own version | "a version bump re-asks" |
 *
 * What this tier proves that the unit tier structurally cannot: the adapter is driven by the REAL
 * `runParsePipeline` against a REAL file, so what is written is what the pipeline chose to write and what is
 * served is what the pipeline accepts as a hit. A unit test drives the adapter's own two methods and would
 * agree with itself about both.
 *
 * ⚠️ No network and no engine: both ports are local doubles that COUNT what they were asked. Nothing here
 * reaches Bedrock or the CRF sidecar, so the tier costs nothing and runs everywhere.
 */
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    NO_CACHE,
    NO_CORRECTIONS,
    runParsePipeline,
    type EngineAnswer,
    type ParseCachePort,
    type ParsedLine,
    type ParseEnginePort,
    type ParsePipelineDeps,
    type ParsePipelineObservers,
} from '@kitchensink/recipe-import-core';
import type { HexDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFileParseCache } from '../src/parsing/fileParseCache.js';

/** The real hash, so the keys written here are the keys the shipped table would hold. */
const sha256: HexDigest = (value) => createHash('sha256').update(value).digest('hex');

/** Lines from the committed 1919 corpus: two that name a food, one the segmenter admitted that names none. */
const BINDING_LINES: readonly string[] = ['one cup of brown sugar', 'two cups of flour'];

/** A line a reader reads and finds no food in — an instruction the segmenter admitted. */
const FOODLESS_LINE = 'set in a cool place';

/** A reading that names one food, attributed to `engine`. */
function reading(raw: string, name: string, engine: 'crf' | 'llm'): ParsedLine {
    return {
        raw,
        statedMeasure: 'one cup',
        quantity: { kind: 'exact', value: 1 },
        unit: 'cup',
        foods: [{ name, prep: null }],
        reviewReasons: [],
        provenance: { statedMeasure: engine, quantity: engine, unit: engine, foods: engine },
    };
}

/** A reading that names NO food — read, and binding nothing. */
function foodless(raw: string, engine: 'crf' | 'llm'): ParsedLine {
    return {
        raw,
        statedMeasure: null,
        quantity: { kind: 'absent' },
        unit: null,
        foods: [],
        reviewReasons: [],
        provenance: { statedMeasure: engine, quantity: engine, unit: engine, foods: engine },
    };
}

/** An engine port that answers from a table and records every line it was asked about. */
function countingEngine<E extends 'crf' | 'llm'>(
    engine: E,
    engineVersion: string,
    asked: string[],
): ParseEnginePort<E> {
    return {
        engine,
        engineVersion,
        async parse(lines): Promise<readonly EngineAnswer[]> {
            asked.push(...lines);

            return lines.map((line) =>
                line === FOODLESS_LINE ? foodless(line, engine) : reading(line, line.split(' ').at(-1) ?? '', engine),
            );
        },
    };
}

/** Observers that fail the test rather than swallowing a tier failure this tier is not about. */
function loudObservers(failures: string[]): ParsePipelineObservers {
    return {
        onTierFailure: (tier, error) => {
            failures.push(`${tier}: ${String(error)}`);
        },
        onUnreadablePayload: (payload) => {
            failures.push(`unreadable: ${payload.tier}`);
        },
    };
}

/**
 * The ports for one run. ⚠️ The two engine versions are INDEPENDENT parameters: `ingredient_parse_cache` is
 * keyed per engine, so bumping one must re-partition only that engine's half.
 */
function depsWith(
    cache: ParseCachePort,
    crfAsked: string[],
    llmAsked: string[],
    versions: { readonly crf: string; readonly llm: string } = { crf: 'v1', llm: 'v1' },
): ParsePipelineDeps {
    return {
        corrections: NO_CORRECTIONS,
        cache,
        engines: {
            crf: countingEngine('crf', `ingredient-parser-nlp@${versions.crf}`, crfAsked),
            llm: countingEngine('llm', `amazon.nova-2-lite-v1:0@${versions.llm}`, llmAsked),
        },
        digest: sha256,
    };
}

describe('the file-backed parse cache under runParsePipeline', () => {
    let directory: string;
    let path: string;

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'cookbookImportParseCache'));
        path = join(directory, 'parseCache.jsonl');
    });

    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
    });

    it('a second run asks nothing — the whole point of item C', async () => {
        const failures: string[] = [];
        const firstCrf: string[] = [];
        const firstLlm: string[] = [];

        await runParsePipeline(
            BINDING_LINES,
            depsWith(createFileParseCache(path), firstCrf, firstLlm),
            { userId: undefined },
            loudObservers(failures),
        );

        expect(firstCrf).toEqual([...BINDING_LINES]);
        expect(firstLlm).toEqual([...BINDING_LINES]);

        const secondCrf: string[] = [];
        const secondLlm: string[] = [];
        const outcomes = await runParsePipeline(
            BINDING_LINES,
            depsWith(createFileParseCache(path), secondCrf, secondLlm),
            { userId: undefined },
            loudObservers(failures),
        );

        expect(secondCrf).toEqual([]);
        expect(secondLlm).toEqual([]);
        expect(outcomes.every((outcome) => outcome.tier === 'parse' && outcome.fromCache.length === 2)).toBe(true);
        expect(failures).toEqual([]);
    });

    it('NO_CACHE re-asks every line — the defect this closes, and the control on the counters', async () => {
        const failures: string[] = [];
        const firstCrf: string[] = [];
        const secondCrf: string[] = [];

        await runParsePipeline(
            BINDING_LINES,
            depsWith(NO_CACHE, firstCrf, []),
            { userId: undefined },
            loudObservers(failures),
        );
        await runParsePipeline(
            BINDING_LINES,
            depsWith(NO_CACHE, secondCrf, []),
            { userId: undefined },
            loudObservers(failures),
        );

        expect(firstCrf).toEqual([...BINDING_LINES]);
        expect(secondCrf).toEqual([...BINDING_LINES]);
    });

    it('a reading that binds nothing is never remembered, and a binding one is', async () => {
        const failures: string[] = [];
        const lines = [...BINDING_LINES, FOODLESS_LINE];

        const first = await runParsePipeline(
            lines,
            depsWith(createFileParseCache(path), [], []),
            { userId: undefined },
            loudObservers(failures),
        );

        // ⛔ Which rule held it back. Both engines ANSWERED, so the merge exists and it is `bindsNothing` —
        // not `merged === null`, the other disjunct `readableDigests` short-circuits on, which would make
        // this test pass for a reason it does not claim.
        expect(first.at(-1)?.parsed).not.toBeNull();

        const crfAsked: string[] = [];
        const llmAsked: string[] = [];

        await runParsePipeline(
            lines,
            depsWith(createFileParseCache(path), crfAsked, llmAsked),
            { userId: undefined },
            loudObservers(failures),
        );

        expect(crfAsked).toEqual([FOODLESS_LINE]);
        expect(llmAsked).toEqual([FOODLESS_LINE]);
        expect(failures).toEqual([]);
    });

    it('a CRF version bump re-asks the CRF and serves the model leg from the file', async () => {
        const failures: string[] = [];

        await runParsePipeline(
            BINDING_LINES,
            depsWith(createFileParseCache(path), [], []),
            { userId: undefined },
            loudObservers(failures),
        );

        const crfAsked: string[] = [];
        const llmAsked: string[] = [];
        const bumped = depsWith(createFileParseCache(path), crfAsked, llmAsked, { crf: 'v2', llm: 'v1' });

        await runParsePipeline(BINDING_LINES, bumped, { userId: undefined }, loudObservers(failures));

        expect(crfAsked).toEqual([...BINDING_LINES]);
        expect(llmAsked).toEqual([]);
    });

    it('the file it writes is not world-readable', async () => {
        await runParsePipeline(
            BINDING_LINES,
            depsWith(createFileParseCache(path), [], []),
            { userId: undefined },
            loudObservers([]),
        );

        // ⛔ BOTH ASSERTIONS READ ONE OPEN DESCRIPTOR, never the path twice. `statSync(path)` followed by
        // `readFileSync(path)` resolves the name a second time, so the mode this asserts and the bytes it
        // counts can come from two different files — the file-system race the SAST scan flags. There is no
        // pre-check left to lose the race: `openSync` failing IS the missing-file failure.
        const handle = openSync(path, 'r');

        try {
            expect(fstatSync(handle).mode & 0o777).toBe(0o600);
            expect(readFileSync(handle, 'utf-8').trimEnd().split('\n')).toHaveLength(BINDING_LINES.length * 2);
        } finally {
            closeSync(handle);
        }
    });
});
