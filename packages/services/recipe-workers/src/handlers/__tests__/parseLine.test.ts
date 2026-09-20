/**
 * The service parse leg (plan U8) — the transient/terminal split, R17's digest guard, and KTD-F's
 * cache-bounded redelivery, driven from fakes with no network and no spend.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it, vi, type Mock } from 'vitest';
import { lineDigest as realLineDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import { FOODNESS_MODEL_ID } from '@kitchensink/recipe-core/parsing/foodness-prompt';
import {
    NOVA_2_LITE_MODEL_ID,
    registryEntryFor,
    residencyClearance,
} from '@kitchensink/recipe-core/spend/spend-arithmetic';

import {
    compareParses,
    type EngineAnswer,
    type ParsedLine,
    type ParseEnginePort,
} from '@kitchensink/recipe-import-core';

import { PARSE_LEG_MODEL_ID, landingOf, processParseLine, type ParseLineDeps } from '../parseLine.js';
import { UNWARRANTED_MODEL_ID, UNWARRANTED_REGISTRY } from '../../parsing/__tests__/unwarrantedModel.js';

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const LINE = '2 cups all-purpose flour';
const JOB = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const message = (overrides: Partial<Parameters<typeof processParseLine>[1]> = {}) => ({
    jobId: JOB,
    lineIndex: 0,
    sourceLine: LINE,
    lineDigest: digest(`v1:${LINE}`).slice(0, 64),
    userId: 'u-1',
    requestedAt: '2026-08-31T12:00:00.000Z',
    ...overrides,
});

const parsedLine = (foods: readonly string[]): ParsedLine => ({
    raw: LINE,
    statedMeasure: '2 cups',
    quantity: { kind: 'exact', value: 2 },
    unit: 'cup',
    foods: foods.map((name) => ({ name, prep: null })),
    reviewReasons: [],
    provenance: { statedMeasure: 'crf', quantity: 'crf', unit: 'crf', foods: 'crf' },
});

/** A fake engine answering every line with `answer` (or throwing). */
const engineOf = (
    engine: 'crf' | 'llm',
    answer: EngineAnswer | (() => never),
): ParseEnginePort<typeof engine> & { calls: string[][] } => {
    const calls: string[][] = [];

    return {
        engine,
        engineVersion: `${engine}-test`,
        calls,
        parse: vi.fn().mockImplementation((lines: string[]) => {
            calls.push(lines);

            if (typeof answer === 'function') {
                answer();
            }

            return Promise.resolve(lines.map(() => answer));
        }),
    } as never;
};

/** The fence the acquire double grants — the one value a correct release must carry back. */
const GRANTED_FENCE = '2026-01-01 00:00:00+00';

/**
 * The LANDING statements among the recorded queries.
 *
 * ⛔ Every case below used to ask `/UPDATE recipe_parse_job_lines/`, which meant "the landing" only while
 * the landing was the one statement touching that table. U6's CLAIM touches it too, ahead of the engines —
 * so that regex started answering `true` for runs whose whole point is that NOTHING landed, and five cases
 * asserting the transient/refused classes went green-to-red for the right reason. The claim is the one that
 * joins `recipe_parse_jobs`; a landing never does.
 */
function landings<T extends { readonly text: string }>(queries: readonly T[]): readonly T[] {
    return queries.filter(
        (query) => /UPDATE recipe_parse_job_lines/u.test(query.text) && !/FROM recipe_parse_jobs/u.test(query.text),
    );
}

function build(
    overrides: Partial<ParseLineDeps> & {
        cacheRows?: unknown[];
        llm?: unknown;
        claimAttempt?: number | null;
        /**
         * Which of the lease's three outcomes this build produces. Defaults to `granted`.
         *
         * ⛔ ONE FIELD, not two booleans. Two would make `{ granted: false, unavailable: true }`
         * representable and meaningless — the same conflation `LeaseOutcome`'s own docstring argues against
         * one file over, reintroduced in the suite that exists to keep the three states apart.
         */
        lease?: 'granted' | 'refused' | 'unavailable';
    } = {},
) {
    const queries: { text: string; params: unknown[] }[] = [];
    /**
     * Every DELETE the handler issued against the lease table — the release path, made observable.
     *
     * ⛔ THE PARAMS, NOT JUST THE STATEMENT. The fence is the whole correctness of the release: a DELETE
     * carrying the wrong one matches no row, so every release becomes a silent no-op and the lease runs to
     * its full expiry. Recording only the text left that unobservable — the wiring could be replaced with
     * any literal and every case here stayed green.
     */
    const leaseReleases: { digest: unknown; fence: unknown }[] = [];
    /**
     * Every wait the handler asked for, instantly.
     *
     * ⛔ THIS IS WHAT MAKES `refused` AND `unavailable` DISTINGUISHABLE. With an inline timer the two
     * branches had identical observable effects — both resolve, both release nothing — so a test for
     * either passed for the other, and collapsing the three states back into a boolean went undetected.
     * Recording the request rather than serving it also takes the 1.5s of real wall clock out of the
     * refused case.
     */
    const sleeps: number[] = [];

    const pool = {
        query: vi.fn().mockImplementation((text: string, params: unknown[]) => {
            queries.push({ text, params });

            if (/SELECT line_digest/.test(text)) {
                return Promise.resolve({ rows: overrides.cacheRows ?? [] });
            }

            // ⛔ The CLAIM (U6) is told apart from the LANDING by its `FROM recipe_parse_jobs` join, not by
            // order: both are `UPDATE recipe_parse_job_lines`, and a fake that answered them identically
            // would let a suite pass while the claim returned no attempt number — which is precisely the
            // refusal that stops the pipeline. `claimAttempt` is what these cases assume about the world:
            // this delivery is the Nth, under the allowance.
            if (/FROM recipe_parse_jobs/.test(text)) {
                return Promise.resolve({
                    rows: overrides.claimAttempt === null ? [] : [{ attempts: overrides.claimAttempt ?? 1 }],
                    rowCount: overrides.claimAttempt === null ? 0 : 1,
                });
            }

            if (/UPDATE recipe_parse_job_lines/.test(text)) {
                return Promise.resolve({ rows: [], rowCount: 1 });
            }

            // ⛔ THE LEASE MUST BE ANSWERED, AND GRANTED BY DEFAULT. A catch-all that returns zero rows
            // is read by `acquireParseLease` as a REFUSAL, which takes every case in this file down the
            // refused branch to sleep `PARSE_LEASE_WAIT_MS` of real time — and, worse than slow, leaves
            // `held` and `unavailable` unexercised and the `finally` release never run.
            if (/INSERT INTO ingredient_parse_leases/.test(text)) {
                if (overrides.lease === 'unavailable') {
                    return Promise.reject(new Error('lease table unreachable'));
                }

                const granted = overrides.lease !== 'refused';

                return Promise.resolve({
                    rows: granted ? [{ fence: GRANTED_FENCE }] : [],
                    rowCount: granted ? 1 : 0,
                });
            }

            if (/DELETE FROM ingredient_parse_leases/.test(text)) {
                leaseReleases.push({ digest: params?.[0], fence: params?.[1] });

                return Promise.resolve({ rows: [], rowCount: 1 });
            }

            return Promise.resolve({ rows: [], rowCount: 0 });
        }),
    };
    const crf = engineOf('crf', parsedLine(['flour'])) as ParseEnginePort<'crf'> & {
        calls: string[][];
        parse: Mock;
    };
    // The gated deps are reached only through the llm engine: settings that resolve and a bedrock that
    // answers.
    const deps: ParseLineDeps = {
        stage: 'prod',
        gated: {
            stage: 'prod',
            deployRegion: 'us-east-1',
            settings: {
                resolve: vi.fn().mockResolvedValue({ ceilingMicros: 100_000_000, modelId: 'amazon.nova-micro-v1:0' }),
            },
            ledger: { reserve: vi.fn().mockResolvedValue({ kind: 'reserved', reservedMicros: 100 }), settle: vi.fn() },
            bedrock: {
                converse: vi.fn().mockResolvedValue({
                    kind: 'answered',
                    text: '[]',
                    stopReason: 'end_turn',
                    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                }),
            },
            emit: vi.fn(),
            now: () => new Date('2026-08-31T12:00:01.000Z'),
        } as never,
        crf,
        pool: pool as never,
        digest,
        emit: vi.fn(),
        parseModelId: 'amazon.nova-micro-v1:0',
        claimLeaseSeconds: 150,
        deliveryAllowance: 20,
        sleep: async (milliseconds: number) => {
            sleeps.push(milliseconds);
        },
        ...overrides,
    };

    return { deps, pool, queries, crf, leaseReleases, sleeps };
}

/**
 * Deps whose parse model is a FIXTURE entry with no residency warrant — the refusal path's subject.
 *
 * ⛔ A fixture rather than a real model: tying this to whichever shipped entry lacked a warrant made the
 * coverage vanish the moment one was granted. See `parsing/__tests__/unwarrantedModel.ts`.
 */
function buildUnwarranted(overrides: Partial<ParseLineDeps> = {}) {
    const built = build({ parseModelId: UNWARRANTED_MODEL_ID, ...overrides });

    (built.deps.gated as { registry?: unknown }).registry = UNWARRANTED_REGISTRY;

    return built;
}

describe('R17 — the digest guard', () => {
    it('⛔ a message whose digest does not match its line is DISCARDED — no engines, no landing', async () => {
        const { deps, pool, crf } = build({});

        await processParseLine(deps, message({ lineDigest: 'a'.repeat(64) }));

        expect(crf.parse).not.toHaveBeenCalled();
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('the landing UPDATE is guarded on the recomputed digest', async () => {
        const { deps, queries } = build({});
        const m = { ...message(), lineDigest: computeRealDigest() };

        await processParseLine(deps, m);

        const landing = landings(queries)[0];

        expect(landing?.params?.[2]).toBe(computeRealDigest());
    });
});

/** The REAL digest the handler recomputes — derived through the same recipe-core function. */
function computeRealDigest(): string {
    return realLineDigest(LINE, digest);
}

/**
 * ⛔ THE DENOMINATOR IS THE POINT — a discard COUNT cannot tell an incident from a quiet queue.
 *
 * `parse landing discarded` went from ~11% of landings to 99.9% and ran ~780/hour for three days
 * (2026-09-11 → 09-13, measured from `/aws/lambda/kitchensink-recipe-workers-{prod,pr-91}`: 4,647 then
 * 29,085 then 16,969 discards a day, against a near-zero baseline before it). Nothing reported it, because
 * the only record was a `logger.info` line. The user-visible consequence is an import that never completes:
 * the line stays `pending`, the job never reaches a terminal aggregate, and it expires 24 hours later with
 * no error and nothing to click.
 *
 * So the metric is emitted ONCE PER LANDING ATTEMPT, `1` when the update matched zero rows and `0` when it
 * matched. One series then carries both quantities CloudWatch needs — `Sum` is the discards, `SampleCount`
 * is the attempts — which is what lets the alarm divide instead of guessing a count that means something
 * different at every traffic level.
 *
 * ⛔ AND IT MUST NOT BE EMITTED ANYWHERE ELSE. A refusal and a transient failure attempt NO landing; if
 * either emitted, `SampleCount` would stop meaning "landings attempted" and the ratio would read low
 * precisely during the engine outage that produces the most non-attempts. The three tests below are that
 * invariant, and the last two are the ones that fail if someone "helpfully" moves the emit up to the top of
 * the handler.
 */
describe('the parse-landing discard metric (the detection half of the silent 93%)', () => {
    it('emits 1 when the landing matches no rows — the line moved on', async () => {
        const emit = vi.fn();
        const { deps, pool } = build({ emit });

        (pool.query as Mock).mockImplementation((text: string) => {
            if (/FROM recipe_parse_jobs/.test(text)) {
                return Promise.resolve({ rows: [{ attempts: 1 }], rowCount: 1 });
            }

            if (/SELECT line_digest/.test(text)) {
                return Promise.resolve({ rows: [] });
            }

            // The landing — and the aggregate, which this case never reaches.
            return Promise.resolve({ rows: [], rowCount: 0 });
        });

        await processParseLine(deps, { ...message(), lineDigest: computeRealDigest() });

        expect(emit).toHaveBeenCalledWith(
            expect.objectContaining({
                namespace: 'Commise/RecipeParse',
                name: 'ParseLandingDiscarded',
                stage: 'prod',
                value: 1,
            }),
        );
    });

    it('emits 0 when the landing lands — WITHOUT this datapoint the rate has no denominator', async () => {
        const emit = vi.fn();
        const { deps } = build({ emit });

        await processParseLine(deps, { ...message(), lineDigest: computeRealDigest() });

        expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: 'ParseLandingDiscarded', value: 0 }));
    });

    it('⛔ emits NOTHING on a residency refusal — no landing was attempted, so it is not a non-discard', async () => {
        const emit = vi.fn();
        const { deps } = buildUnwarranted({ emit });

        await processParseLine(deps, { ...message(), lineDigest: computeRealDigest() });

        expect(
            emit.mock.calls.flat().filter((call) => (call as { name?: string })?.name === 'ParseLandingDiscarded'),
        ).toEqual([]);
    });

    it('⛔ emits NOTHING when a transient failure re-throws — an outage must not dilute the ratio', async () => {
        const emit = vi.fn();
        const { deps, crf } = build({ emit });

        (crf.parse as Mock).mockRejectedValue(new Error('Function not found'));

        await expect(processParseLine(deps, { ...message(), lineDigest: computeRealDigest() })).rejects.toThrow();

        expect(
            emit.mock.calls.flat().filter((call) => (call as { name?: string })?.name === 'ParseLandingDiscarded'),
        ).toEqual([]);
    });
});

describe('the exhaustion landing split (amended 2026-08-31)', () => {
    const base = {
        raw: LINE,
        statedMeasure: '2 cups',
        quantity: { kind: 'exact', value: 2 },
        unit: 'cup',
        provenance: { statedMeasure: 'llm', quantity: 'llm', unit: 'llm', foods: 'llm' },
        llmAttempts: 4,
    } as const;

    it("a MIXED-exhaustion line — kept foods beside a not_a_food record — lands 'parsed', not 'unparseable'", () => {
        const landing = landingOf({
            ...base,
            foods: [{ name: 'flour', prep: null }],
            reviewReasons: ['not_a_food'],
        });

        expect(landing.status).toBe('parsed');
    });

    it("an all-foods-refused exhaustion still lands 'unparseable' (R6)", () => {
        const landing = landingOf({ ...base, foods: [], reviewReasons: ['not_a_food'] });

        expect(landing.status).toBe('unparseable');
    });

    it("⛔ a parse with NO foods lands 'unparseable' whatever its reasons say — a measure bound to nothing is not a clean parse", () => {
        // Measured over 1,265 lines: the parse model returned a measurement and an EMPTY food list on 28 of
        // them. Nothing puts `not_a_food` on a parse no validator ever disputed, so the second conjunct
        // could never be satisfied — the line landed `parsed`, with an empty name and `needsReview: false`,
        // and nobody was ever sent to look at it.
        const landing = landingOf({ ...base, foods: [], reviewReasons: [] });

        expect(landing.status).toBe('unparseable');
        // ⛔ TERMINAL, not discarded: `unparseable` KEEPS the proposal, so the measure the model did read is
        // still in front of the cook who edits the line.
        expect(landing.proposal).not.toBeNull();
    });

    it("a foodless line whose only reason is a measurement dispute also lands 'unparseable'", () => {
        const landing = landingOf({ ...base, foods: [], reviewReasons: ['measurement_unverified'] });

        expect(landing.status).toBe('unparseable');
    });

    it("a measurement-only exhaustion lands 'parsed' with its review flag riding in the proposal", () => {
        const landing = landingOf({
            ...base,
            foods: [{ name: 'salt', prep: null }],
            reviewReasons: ['measurement_unverified'],
        });

        expect(landing.status).toBe('parsed');
        expect(landing.proposal?.reviewReasons).toContain('measurement_unverified');
    });

    /**
     * ⛔ R5 (owner ruling 2026-09-19) — the comparator now hands this handler a line whose ONE food is the
     * source text itself, so the zero-foods test above can no longer catch it: the list is not empty, and
     * every word in it came from the cook rather than from a reader. `name_is_source_line` is what says so,
     * and reading it is what stops a placeholder landing as a clean `parsed` name for the catalog to
     * resolve — the exact defect the zero-foods widening was made to close, arriving one shape later.
     */
    it("⛔ a PLACEHOLDER name — the source line itself — lands 'unparseable', never 'parsed'", () => {
        const landing = landingOf({
            ...base,
            foods: [{ name: LINE, prep: null }],
            reviewReasons: ['not_a_food', 'name_is_source_line'],
        });

        expect(landing.status).toBe('unparseable');
        // ⛔ TERMINAL, not discarded: the words the cook pasted are still in front of them to edit.
        expect(landing.proposal?.foods).toEqual([{ name: LINE, prep: null }]);
    });

    it('⚠️ and nothing else changes — a real food beside the same terminal record still lands parsed', () => {
        const landing = landingOf({
            ...base,
            foods: [{ name: 'flour', prep: null }],
            reviewReasons: ['not_a_food'],
        });

        expect(landing.status).toBe('parsed');
    });

    /**
     * ⛔ THE END-TO-END SHAPE OF THE REASON SPLIT (2026-09-19), asserted here because this is the layer the
     * consequence is visible at — and because the two halves live in different packages, so nothing else
     * looks at both.
     *
     * The CRF reads `a large frying-pan` as `1 large :: frying-pan`; the LLM's every name was rejected by
     * the foodness judge, so its leg terminates `foods: []` under `not_a_food`. R1 then binds the CRF's
     * food. What is asserted is the PAIR: the line lands `parsed` — it HAS a food, and the mixed-exhaustion
     * precedent above is the same reading — and the validator's verdict is in the proposal a cook is shown,
     * so `needsReview` is true and somebody is sent to look.
     *
     * ⛔ Before the split, `compareParses` filtered `not_a_food` on ANY rescue, so this merged with
     * `reviewReasons: []` and landed `parsed` with nothing flagged at all. The status is not what changed;
     * what changed is that the line no longer arrives silent.
     */
    it('⛔ a CRF-rescued line whose LLM names a judge REJECTED lands parsed, but never silent', () => {
        const merged = compareParses({
            crf: {
                raw: 'a large frying-pan',
                statedMeasure: '1 large',
                quantity: { kind: 'exact', value: 1 },
                unit: null,
                foods: [{ name: 'frying-pan', prep: null }],
                reviewReasons: [],
                provenance: { statedMeasure: 'crf', quantity: 'crf', unit: 'crf', foods: 'crf' },
            },
            llm: {
                raw: 'a large frying-pan',
                statedMeasure: null,
                quantity: { kind: 'absent' },
                unit: null,
                foods: [],
                reviewReasons: ['not_a_food'],
                provenance: { statedMeasure: 'llm', quantity: 'llm', unit: 'llm', foods: 'llm' },
            },
        }).merged;

        const landing = landingOf(merged);

        expect(landing.status).toBe('parsed');
        expect(landing.proposal?.reviewReasons).toContain('not_a_food');
    });
});

describe('the transient/terminal split', () => {
    it('⛔ a gated-leg throw re-throws AFTER the run, BEFORE any landing — the message redelivers', async () => {
        const { deps, queries } = build({});
        (deps.gated.ledger.reserve as Mock).mockResolvedValue({
            kind: 'denied',
            period: '2026-08',
        });

        await expect(processParseLine(deps, { ...message(), lineDigest: computeRealDigest() })).rejects.toThrow(
            /ceiling/,
        );
        expect(landings(queries).length > 0).toBe(false);
    });

    it('⛔ a CRF INVOCATION failure is transient too — the line retries, it does not land single-engine', async () => {
        // ADR-0026's 2026-08-31 update lists "a CRF invocation failure" in the TRANSIENT set, beside the
        // ceiling denial and the Bedrock transport failure, on its own stated ground: none of them is
        // evidence about the ingredient, and "recording any of them as an outcome would turn an outage into
        // a permanent fact about a line".
        //
        // ⛔ The handler used to collect ONLY `tier === 'llm'`, so a line parsed during a CRF outage landed
        // the LLM's single-engine reading as its permanent answer — the outage becoming the fact. That is
        // the same argument this suite's gated-leg case above already makes, one engine over.
        const { deps, queries } = build({});

        (deps.crf.parse as Mock).mockRejectedValue(new Error('Function not found'));

        await expect(processParseLine(deps, { ...message(), lineDigest: computeRealDigest() })).rejects.toThrow(
            /Function not found/,
        );
        expect(landings(queries).length > 0).toBe(false);
    });

    it('⛔ but a CRF ABSENCE that is not a failure still LANDS — ADR-0026 §3 is untouched', async () => {
        // THE NEGATIVE CONTROL for the case above, and the one that keeps the fix from over-reaching. A port
        // that RETURNS `{ unavailable: true }` said "I read this line and had no opinion" — the engine is
        // healthy. That is `single-engine`, a legitimate per-line outcome, and it lands. Treating every CRF
        // absence as transient would make every hard line retry to the DLQ, which is §3's "absence is not
        // dissent" broken in the opposite direction.
        const { deps, queries } = build({});

        (deps.crf.parse as Mock).mockImplementation((lines: string[]) =>
            Promise.resolve(lines.map(() => ({ unavailable: true }))),
        );

        await processParseLine(deps, { ...message(), lineDigest: computeRealDigest() });

        expect(landings(queries).length > 0).toBe(true);
    });

    /**
     * ⛔ THE FOURTH CLASS — REFUSED (ADR-0024 §4b) — and it is neither of the two above.
     *
     * It shares the TRANSIENT set's rule that nothing may land: a merge produced while an engine was silenced
     * by a deployment fault must not become this line's permanent answer, which is the identical argument the
     * two CRF cases above make. It shares NONE of its rule that a retry might help: a residency refusal is
     * deterministic in (model, region), so re-throwing it would burn the queue's whole `maxReceiveCount` to
     * reach the same answer and would report a standing product decision as DLQ depth — the one signal
     * ADR-0024 layer 4 watches.
     *
     * ⚠️ It is also the case the "just return absence" design gets WRONG, silently: absence here would take
     * the negative-control path directly above and LAND a single-engine answer, green, for a config fault.
     */
    it('⛔ a RESIDENCY refusal lands nothing AND redelivers nothing — the fourth class', async () => {
        const { deps, queries } = buildUnwarranted();

        await expect(
            processParseLine(deps, { ...message(), lineDigest: computeRealDigest() }),
        ).resolves.toBeUndefined();

        expect(landings(queries).length > 0).toBe(false);
        expect(deps.gated.bedrock.converse).not.toHaveBeenCalled();
    });

    it('lets a residency refusal WIN over a concurrent transient failure — nothing can land either way', async () => {
        // ⚠️ Why the handler searches the whole collection rather than reading the first element: a run can
        // carry a CRF outage AND a refusal, and re-throwing the outage would put a permanently-failing
        // message onto the redelivery path for a fault redelivery cannot fix.
        const { deps, queries } = buildUnwarranted();

        (deps.crf.parse as Mock).mockRejectedValue(new Error('Function not found'));

        await expect(
            processParseLine(deps, { ...message(), lineDigest: computeRealDigest() }),
        ).resolves.toBeUndefined();

        expect(landings(queries).length > 0).toBe(false);
    });

    it('a STORE tier failure is NOT transient — a broken cache costs a call, never the line', async () => {
        // `corrections` and `cache` failures degrade into a re-parse, which is the pipeline's own rule
        // ("failing the line because the cache would not take it would cost a correct answer in order to
        // save a future call — exactly backwards"). Collecting every tier indiscriminately would make an
        // unreachable cache an outage.
        const { deps, queries, pool } = build({});

        pool.query.mockImplementation((text: string) => {
            if (/SELECT line_digest/.test(text)) {
                return Promise.reject(new Error('cache unreachable'));
            }

            // The CLAIM must still succeed — this case is about a broken CACHE, not a refused claim, and a
            // fake that failed both would prove the line did not land for the wrong reason.
            if (/FROM recipe_parse_jobs/.test(text)) {
                queries.push({ text, params: [] });

                return Promise.resolve({ rows: [{ attempts: 1 }], rowCount: 1 });
            }

            if (/UPDATE recipe_parse_job_lines/.test(text)) {
                queries.push({ text, params: [] });

                return Promise.resolve({ rows: [], rowCount: 1 });
            }

            return Promise.resolve({ rows: [], rowCount: 0 });
        });

        await processParseLine(deps, { ...message(), lineDigest: computeRealDigest() });

        expect(landings(queries).length > 0).toBe(true);
    });

    it('⛔ KTD-F: the surviving engine’s answer is CACHED before the re-throw', async () => {
        // This is what makes "an engine outage retries" affordable rather than a spend amplifier against
        // ADR-0024's one $100 pool: the redelivery re-reads whatever succeeded and re-pays only what did
        // not. Re-throwing before the pipeline's write-back would bill a fresh Bedrock call for every
        // redelivery of every line during a CRF outage.
        const { deps, queries } = build({});

        (deps.crf.parse as Mock).mockRejectedValue(new Error('Function not found'));
        (deps.gated.bedrock.converse as Mock).mockResolvedValue({
            kind: 'answered',
            // The wire shape `modelParseAnswerSchema` accepts: a ROOT ARRAY of relational records.
            text: JSON.stringify([
                {
                    food_items: ['flour'],
                    measurement: { quantity: '2', unit: 'cups', unit_type: 'volume' },
                    preparations: null,
                    equipment: null,
                },
            ]),
            stopReason: 'end_turn',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        });

        await expect(processParseLine(deps, { ...message(), lineDigest: computeRealDigest() })).rejects.toThrow();

        // The write-back is attempted for whatever answered, and it happens BEFORE the handler re-throws.
        expect(queries.some((query) => /INSERT INTO ingredient_parse_cache/.test(query.text))).toBe(true);
    });

    it('a clean run lands `parsed` with the merged proposal', async () => {
        // ⛔ REWRITTEN, not edited-to-compile. This case used to run on the default fixture, whose Bedrock
        // fake answers `'[]'` — an LLM parse with NO foods. `FIELD_WINNERS.foods` is `'llm'`, so the merge
        // took that empty list and discarded the CRF's `flour`, and the case then asserted that a proposal
        // binding NOTHING lands `parsed`: the very defect, certified green. Its second assertion was
        // vacuous besides — `toContain('flour')` matched the `raw` text `'2 cups all-purpose flour'`
        // carried inside the serialized proposal, so it passed with an empty food list.
        //
        // A "clean run" needs a clean answer from BOTH engines, so the LLM now answers with a real food,
        // and the assertion reads the FOODS out of the proposal instead of grepping its JSON.
        const { deps, queries } = build({});

        (deps.gated.bedrock.converse as Mock).mockResolvedValue({
            kind: 'answered',
            text: JSON.stringify([
                {
                    food_items: ['flour'],
                    measurement: { quantity: '2', unit: 'cups', unit_type: 'volume' },
                    preparations: null,
                    equipment: null,
                },
            ]),
            stopReason: 'end_turn',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        });

        await processParseLine(deps, { ...message(), lineDigest: computeRealDigest() });

        const landing = landings(queries)[0];
        const proposal = JSON.parse(String(landing?.params?.[4])) as ParsedLine;

        expect(landing?.params?.[3]).toBe('parsed');
        expect(proposal.foods.map((food) => food.name)).toContain('flour');
    });

    it("⛔ a foodless MERGED outcome reaches the landing UPDATE as 'unparseable' — the classifier is not the only thing that has to be right", async () => {
        // The net sits at the LANDING, not only inside the validator loop: `FIELD_WINNERS.foods` is `'llm'`,
        // so a merged line can carry zero foods for reasons the loop never saw — a single-engine answer, a
        // cached parse, an engine that is not the looped one. This case drives the CRF's own foodless parse
        // through the real handler.
        const { deps, queries } = build({ crf: engineOf('crf', parsedLine([])) as never });

        await processParseLine(deps, { ...message(), lineDigest: computeRealDigest() });

        const landing = landings(queries)[0];

        expect(landing?.params?.[3]).toBe('unparseable');
    });

    it('updates the JOB aggregate after a landing', async () => {
        const { deps, queries } = build({});

        await processParseLine(deps, { ...message(), lineDigest: computeRealDigest() });

        expect(queries.some((query) => /UPDATE recipe_parse_jobs/.test(query.text))).toBe(true);
    });
});

/**
 * ⛔ EVERY MODEL THIS HANDLER PINS MUST BE RESIDENCY-CLEAR (ADR-0024 §4b) — the guard that turns a silent
 * degradation into a red build.
 *
 * The residency refusal is decided at RUNTIME by `planReservation`, and it does not fail the handler: the
 * line simply never lands, staying `pending` until its job's TTL sweeps it. That is the right disposition for
 * a deployment fault — and a terrible way to learn that the SHIPPED pin is unreachable, because the symptom
 * is a stalled import rather than an error. `PARSE_LEG_MODEL_ID` was `amazon.nova-2-lite-v1:0`, which is
 * `INFERENCE_PROFILE`-only over three regions and carries no warrant, so wiring residency in WITHOUT this
 * assertion would have shipped a parse leg that landed nothing at all and raised no test.
 *
 * ⚠️ The RULE is asserted, not the value: this stays green the day 016 warrants a cross-region model, and
 * goes red the moment a pin moves to one it has not.
 */
describe('the shipped model pins are callable', () => {
    it.each([
        ['parse leg', PARSE_LEG_MODEL_ID],
        ['foodness validator', FOODNESS_MODEL_ID],
    ])('%s pins a model residency clears', (_leg, modelId) => {
        const entry = registryEntryFor(modelId);

        if (entry === undefined) {
            throw new Error(`${modelId} is not in the registry at all`);
        }

        expect(residencyClearance(entry, 'us-east-1')).not.toBe('unapproved');
    });

    it('pins Nova 2 Lite for the parse leg — warranted by the owner ruling of 2026-09-12', () => {
        // ⛔ A LITERAL on purpose. The assertion above proves the RULE holds; this one records WHICH model the
        // ruling landed on, so a change of parse model is a change of this line and shows up in the diff
        // beside whatever accuracy evidence justified it (ADR-0026 §9's gold set).
        //
        // ⚠️ This moved BACK to Nova 2 Lite because the residency question was ANSWERED, not routed around:
        // the owner recorded a `residencyApproval` on the registry entry (ADR-0024 §4b), which is the single
        // edit the refusal was always waiting on. The rule test above is what proves the answer is real —
        // had the warrant not been recorded, this pin would be uncallable and that test, not this one, fails.
        expect(PARSE_LEG_MODEL_ID).toBe(NOVA_2_LITE_MODEL_ID);
    });
});

describe('KTD-F — the cache bounds redelivery amplification', () => {
    it('⛔ a redelivered line with BOTH engines cached calls NO engine at all', async () => {
        const storedDigest = realLineDigest(LINE, digest);
        const cachedFacts = {
            statedMeasure: '2 cups',
            quantity: { kind: 'exact', value: 2 },
            unit: 'cup',
            foods: [{ name: 'flour', prep: null }],
        };
        const { deps, crf } = build({
            cacheRows: [
                { line_digest: storedDigest, engine: 'crf', engine_version: 'crf-test', parse: cachedFacts },
                {
                    line_digest: storedDigest,
                    engine: 'llm',
                    engine_version: 'amazon.nova-micro-v1:0@v2',
                    parse: cachedFacts,
                },
            ],
        });

        await processParseLine(deps, { ...message(), lineDigest: storedDigest });

        expect(crf.parse).not.toHaveBeenCalled();
        expect(deps.gated.bedrock.converse).not.toHaveBeenCalled();
    });
});

describe('processParseLine — the per-digest parse lease', () => {
    /**
     * ⛔ THE RELEASE PATH HAD NO UNIT COVERAGE AT ALL until this suite's pool double learned the lease
     * statements. Before that the acquire fell through to a catch-all returning zero rows, which reads as a
     * REFUSAL — so all 28 cases took the refused branch, slept `PARSE_LEASE_WAIT_MS` of real time (24.1s
     * across the file), and the `finally` release never executed once.
     *
     * ⚠️ `unavailable` is the state that has never run anywhere, in any tier, which is why it is asserted
     * here rather than left to the integration suite: it is the branch the three-state refactor introduced,
     * and a two-state regression would silently restore the wait it exists to avoid.
     */
    it('releases the lease it was granted, once, UNDER THE FENCE THE ACQUIRE RETURNED', async () => {
        const { deps, leaseReleases } = build();
        const digest = computeRealDigest();

        await processParseLine(deps, { ...message(), lineDigest: digest });

        // GRANTED_FENCE is what the acquire double hands back; releasing under anything else deletes
        // nobody's row and leaves the lease standing until it expires.
        expect(leaseReleases).toEqual([{ digest, fence: GRANTED_FENCE }]);
    });

    it('⛔ waits for the holder when refused, and releases nothing — that row is not ours', async () => {
        const { deps, leaseReleases, sleeps } = build({ lease: 'refused' });

        await processParseLine(deps, { ...message(), lineDigest: computeRealDigest() });

        expect(leaseReleases).toEqual([]);
        // ⛔ The wait is the half that separates this from `unavailable`. Without it, both branches are
        // "resolved, released nothing" and either test passes for the other state.
        expect(sleeps).toHaveLength(1);
    });

    it('⛔ parses WITHOUT waiting when the lease cannot be CONSULTED, and releases nothing', async () => {
        const { deps, leaseReleases, sleeps } = build({ lease: 'unavailable' });

        // A rejection must not fail the parse, and must not schedule the refused branch's wait.
        await expect(
            processParseLine(deps, { ...message(), lineDigest: computeRealDigest() }),
        ).resolves.toBeUndefined();
        expect(leaseReleases).toEqual([]);

        // ⛔ THE ASSERTION THE STATE EXISTS FOR. The dominant failure here is the shared database — the
        // lease table and the parse cache are reached through the SAME pool — so the cache read the wait
        // exists to make succeed is very likely failing too. Waiting would buy a near-zero-probability hit
        // at 1.5s of billed Lambda PER LINE, exactly when the database is degraded: a latency amplifier
        // under the failure it is meant to tolerate.
        //
        // ⚠️ Not every unavailable case is a degraded database — the deploy window before migration 0049
        // applies in a stage is one where the table is missing and the cache is healthy. That case
        // degrades to pre-lease behaviour, which is accepted.
        expect(sleeps).toEqual([]);
    });
});
