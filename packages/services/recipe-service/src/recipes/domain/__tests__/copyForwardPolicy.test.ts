/**
 * The pure copy-forward policy — "may this line's answer be reused instead of re-queued?"
 *
 * Written RED-first from `docs/plans/2026-09-19-001-feat-parse-job-enqueue-dedup-plan.md` §5.
 *
 * ⛔ WHAT THIS MODULE IS FOR, because the obvious reading of the defect points somewhere else. The parse
 * queue received 1,650,952 `NumberOfMessagesSent` in September for a 2,502-line corpus — a PRODUCER count,
 * not redelivery — because nothing between `create` and `queue.enqueue` ever asks whether the line has
 * already been answered. The worker's `ingredient_parse_cache` read is real but sits AFTER the send, the
 * receive and the claim, so it saves the engine call and nothing else.
 *
 * ⛔ WHY THE CACHE IS NOT THE SOURCE HERE. `ingredient_parse_cache` is keyed
 * `(line_digest, engine, engine_version)` and holds ONE ROW PER ENGINE; a parse-job line's `proposal` is the
 * MERGED `ParsedLine` that `compareParses` adjudicates out of both. recipe-service depends on neither
 * `recipe-import-core` (so it cannot merge) nor the engines' version strings (so it cannot tell a current
 * row from a superseded one). Reading the cache from here could therefore only skip a line whose stored
 * answer might be a retired model's — the exact silent-skip failure the plan's §2 rejects. The source is
 * instead the caller's OWN prior job lines, whose `proposal` is already merged.
 *
 * ⚠️ THE CONSEQUENCE, stated rather than hidden: `recipe_parse_job_lines` carries no engine version, so this
 * policy is VERSION-BLIND. The recency window is a PROXY for version-awareness, not the check — a model pin
 * changed inside the window still serves the old answer. The owed follow-up is to record the engine version
 * on the landed line (a `parseLine.ts` change) and gate on it instead of on age.
 */
import { describe, expect, it } from 'vitest';

import { evaluateCopyForward, type CopyForwardCandidate, type CopyForwardInput } from '../copyForwardPolicy.js';

const NOW = new Date('2026-09-19T12:00:00.000Z');
const DIGEST_FLOUR = 'v1:aaaa';
const DIGEST_EGGS = 'v1:bbbb';
const MAX_AGE_HOURS = 168;

/** A landed proposal, shaped like the worker's stored `ParsedLine`. */
function makeProposal(raw: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        raw,
        quantity: { kind: 'exact', value: 2 },
        unit: 'cup',
        statedMeasure: '2 cups',
        foods: [{ name: 'flour', prep: null }],
        reviewReasons: [],
        ...overrides,
    };
}

function makeCandidate(overrides: Partial<CopyForwardCandidate> = {}): CopyForwardCandidate {
    return {
        lineDigest: DIGEST_FLOUR,
        status: 'parsed',
        proposal: makeProposal('2 cups flour'),
        llmAttempts: 1,
        landedAt: new Date('2026-09-18T12:00:00.000Z'),
        ...overrides,
    };
}

function makeInput(overrides: Partial<CopyForwardInput> = {}): CopyForwardInput {
    return {
        lines: [{ sourceLine: '2 cups flour', lineDigest: DIGEST_FLOUR }],
        candidates: [makeCandidate()],
        now: NOW,
        maxAgeHours: MAX_AGE_HOURS,
        correctionsChangedAt: null,
        ...overrides,
    };
}

describe('evaluateCopyForward — what is copied', () => {
    it('enqueues a line nothing has ever answered (first sight)', () => {
        const [decision] = evaluateCopyForward(makeInput({ candidates: [] }));

        expect(decision).toEqual({ kind: 'enqueue' });
    });

    it('copies an exact repeat of a parsed line, so no message is produced for it', () => {
        const [decision] = evaluateCopyForward(makeInput());

        expect(decision?.kind).toBe('copy');
        expect(decision).toMatchObject({ status: 'parsed', llmAttempts: 1 });
    });

    /**
     * `unparseable` is TERMINAL and keeps its proposal (`landingOf` in `parseLine.ts`), so it is a real
     * answer — "we read this and could not understand it" — and re-queuing it buys the same answer again.
     */
    /**
     * ⛔ REVERSED BY OWNER RULING (2026-09-19): "let's not cache failed_retryable and unparseable". This
     * case previously asserted that an `unparseable` line WAS copied, on the argument that `landingOf`
     * assigns it to a successful parse that found no food, so re-queuing buys the same answer.
     *
     * ⚠️ That argument was about cost and silent about the cook. The same status is what an exhausted
     * validator loop lands, and the column cannot tell the two apart — so copying it forward means a line
     * the parser could not read is never re-read.
     */
    it('⛔ does NOT copy an unparseable line — a failure is never carried forward', () => {
        const [decision] = evaluateCopyForward(makeInput({ candidates: [makeCandidate({ status: 'unparseable' })] }));

        expect(decision).toEqual({ kind: 'enqueue' });
    });

    /**
     * ⛔ `failed_retryable` is NOT an answer — it is "we kept trying and could not get to it". Copying it
     * would turn a transient outage into a permanent fact about an ingredient, which is the exact error
     * ADR-0026 §3 names for `single-engine` vs `differ`.
     */
    it.each([
        ['failed_retryable', 'failed_retryable'],
        ['pending', 'pending'],
    ])('never copies a %s line — it carries no answer', (_label, status) => {
        const [decision] = evaluateCopyForward(
            makeInput({
                candidates: [makeCandidate({ status: status as CopyForwardCandidate['status'] })],
            }),
        );

        expect(decision).toEqual({ kind: 'enqueue' });
    });

    it('never copies a candidate whose proposal is null', () => {
        const [decision] = evaluateCopyForward(makeInput({ candidates: [makeCandidate({ proposal: null })] }));

        expect(decision).toEqual({ kind: 'enqueue' });
    });

    /**
     * FAIL SAFE TOWARD DOING THE WORK. A stored proposal this build cannot read is a row to re-earn, never
     * a row to serve: the rewrite below has to set `raw` on it, and a non-object has no `raw` to set.
     */
    it('never copies a proposal that is not an object — it re-earns the answer instead', () => {
        const [decision] = evaluateCopyForward(makeInput({ candidates: [makeCandidate({ proposal: 'nonsense' })] }));

        expect(decision).toEqual({ kind: 'enqueue' });
    });
});

describe('evaluateCopyForward — the recency window (the version-blindness proxy)', () => {
    it('does NOT copy a proposal older than the window; the line is re-queued', () => {
        const [decision] = evaluateCopyForward(
            makeInput({
                candidates: [makeCandidate({ landedAt: new Date('2026-06-01T12:00:00.000Z') })],
            }),
        );

        expect(decision).toEqual({ kind: 'enqueue' });
    });

    it('copies a proposal exactly AT the window boundary', () => {
        const landedAt = new Date(NOW.getTime() - MAX_AGE_HOURS * 3_600_000);

        const [decision] = evaluateCopyForward(makeInput({ candidates: [makeCandidate({ landedAt })] }));

        expect(decision?.kind).toBe('copy');
    });

    it('does NOT copy a proposal one millisecond past the boundary', () => {
        const landedAt = new Date(NOW.getTime() - MAX_AGE_HOURS * 3_600_000 - 1);

        const [decision] = evaluateCopyForward(makeInput({ candidates: [makeCandidate({ landedAt })] }));

        expect(decision).toEqual({ kind: 'enqueue' });
    });

    /**
     * ⛔ BOTH candidates sit INSIDE the recency window, and the rule is asserted in BOTH presentation
     * orders. An earlier version placed the loser OUTSIDE the window, so the window — not the ordering —
     * was what excluded it, and the assertion held just as well for a first-wins implementation.
     *
     * ⚠️ WHAT THIS DISCHARGES IS THE MODULE'S CONTRACT OVER A REORDERED CANDIDATE LIST, AND NOTHING ABOUT
     * THE PRODUCTION PATH. Exactly one row per digest reaches `evaluateCopyForward` in production, so this
     * loop cannot be what decides which answer is served there — see `COPY_FORWARD_CANDIDATES_SQL`'s
     * docstring in `../../dal/parseJobs.dal.ts`, which owns that rule and names the integration case that
     * protects it. The loop is still worth pinning because the function is TOTAL over the list it is
     * handed, and this is the tier that exercises that.
     */
    it.each([
        ['oldest first', ['older', 'newer']],
        ['newest first', ['newer', 'older']],
    ])('prefers the most recently landed candidate for one digest (%s)', (_order, units) => {
        const landedFor: Record<string, Date> = {
            older: new Date('2026-09-14T12:00:00.000Z'),
            newer: new Date('2026-09-18T12:00:00.000Z'),
        };
        const [decision] = evaluateCopyForward(
            makeInput({
                candidates: units.map((unit) =>
                    makeCandidate({
                        landedAt: landedFor[unit] as Date,
                        proposal: makeProposal('2 cups flour', { unit }),
                    }),
                ),
            }),
        );

        expect(decision).toMatchObject({ kind: 'copy' });
        expect((decision as { proposal: Record<string, unknown> }).proposal['unit']).toBe('newer');
    });
});

describe('evaluateCopyForward — HAZ-041: the copied proposal carries THIS line’s raw', () => {
    /**
     * ⛔ `ParsedLine.raw` is the cook's line BYTE-IDENTICAL, but `lineDigest` NFC-normalizes and collapses
     * whitespace — so two lines sharing a digest can differ in bytes. `runParsePipeline` says so outright:
     * "the digest asserts the two spellings are the same line, not that they are the same string."
     *
     * Without the rewrite the response would show a proposal quoting a DIFFERENT string than the row's own
     * `sourceLine`, in the same payload.
     */
    it('rewrites raw to the submitted spelling, not the spelling that was originally parsed', () => {
        const [decision] = evaluateCopyForward(
            makeInput({
                lines: [{ sourceLine: '2  cups   flour', lineDigest: DIGEST_FLOUR }],
                candidates: [makeCandidate({ proposal: makeProposal('2 cups flour') })],
            }),
        );

        expect((decision as { proposal: Record<string, unknown> }).proposal['raw']).toBe('2  cups   flour');
    });

    it('leaves every other stored field of the proposal untouched', () => {
        const [decision] = evaluateCopyForward(
            makeInput({ lines: [{ sourceLine: 'FLOUR, 2 cups', lineDigest: DIGEST_FLOUR }] }),
        );
        const proposal = (decision as { proposal: Record<string, unknown> }).proposal;

        expect(proposal).toMatchObject({
            quantity: { kind: 'exact', value: 2 },
            unit: 'cup',
            statedMeasure: '2 cups',
            foods: [{ name: 'flour', prep: null }],
            reviewReasons: [],
        });
    });
});

describe('evaluateCopyForward — batch shape', () => {
    it('returns exactly one decision per submitted line, positionally', () => {
        const decisions = evaluateCopyForward(
            makeInput({
                lines: [
                    { sourceLine: '2 cups flour', lineDigest: DIGEST_FLOUR },
                    { sourceLine: '3 eggs', lineDigest: DIGEST_EGGS },
                ],
            }),
        );

        expect(decisions).toHaveLength(2);
        expect(decisions[0]?.kind).toBe('copy');
        expect(decisions[1]?.kind).toBe('enqueue');
    });

    /**
     * ⛔ A paste may legitimately repeat an ingredient, and the paste is POSITIONAL — the cook gets their
     * own lines back. Both positions resolve independently, so a repeat inside one paste yields TWO job
     * lines. (Collapsing them onto one message is the hung job the plan's §2(c) rejects: the worker's
     * landing is `WHERE job_id AND line_index AND line_digest`, so the twin would never land.)
     */
    it('decides duplicate lines within one paste independently, never collapsing them', () => {
        const decisions = evaluateCopyForward(
            makeInput({
                lines: [
                    { sourceLine: '3 eggs', lineDigest: DIGEST_EGGS },
                    { sourceLine: '3 eggs', lineDigest: DIGEST_EGGS },
                ],
                candidates: [],
            }),
        );

        expect(decisions).toEqual([{ kind: 'enqueue' }, { kind: 'enqueue' }]);
    });

    it('copies BOTH positions when a repeated line already has an answer', () => {
        const decisions = evaluateCopyForward(
            makeInput({
                lines: [
                    { sourceLine: '2 cups flour', lineDigest: DIGEST_FLOUR },
                    { sourceLine: '2 cups flour', lineDigest: DIGEST_FLOUR },
                ],
            }),
        );

        expect(decisions.map((decision) => decision.kind)).toEqual(['copy', 'copy']);
    });

    it('consults nothing and returns nothing for an empty batch', () => {
        expect(evaluateCopyForward(makeInput({ lines: [], candidates: [] }))).toEqual([]);
    });

    it('ignores a candidate whose digest matches no submitted line', () => {
        const decisions = evaluateCopyForward(
            makeInput({
                lines: [{ sourceLine: '3 eggs', lineDigest: DIGEST_EGGS }],
                candidates: [makeCandidate({ lineDigest: DIGEST_FLOUR })],
            }),
        );

        expect(decisions).toEqual([{ kind: 'enqueue' }]);
    });
});

/**
 * ⛔ THE CORRECTIONS ORDERING RULE, which this whole tier sits above.
 *
 * `parsePipeline.ts` owns one rule: "A human correction outranks a cached parse; a cached parse outranks an
 * engine call." Copy-forward is a NEW TIER ABOVE `corrections`, in a different deployable, that cannot
 * consult the corrections tier at all. Left unaddressed, a cook corrects a parse, re-pastes the line,
 * silently gets the PRE-CORRECTION answer back, and corrects it again forever.
 *
 * The discharge is a WATERMARK: the newest moment anything in this caller's visible correction set changed.
 * An answer that landed BEFORE that moment may no longer reflect what a correction now says, so it is not
 * copied.
 *
 * ⛔ It asks only "did the set MOVE?" — never which correction wins. `parsePorts.ts` warns by name that two
 * readers with different precedence let a correction bind on one path and not the other, so this
 * deliberately does not re-derive `findInForce`'s ordering.
 *
 * ⚠️ The watermark is a SOUND BOUND (if nothing moved since the answer landed, no correction now in force
 * could have changed it). The recency window above is only a PROXY. The asymmetry is deliberate.
 */
describe('evaluateCopyForward — the corrections watermark', () => {
    it('copies when no correction has ever moved (a null watermark)', () => {
        const [decision] = evaluateCopyForward(makeInput({ correctionsChangedAt: null }));

        expect(decision?.kind).toBe('copy');
    });

    it('copies when the answer landed AFTER the last correction change', () => {
        const [decision] = evaluateCopyForward(
            makeInput({
                candidates: [makeCandidate({ landedAt: new Date('2026-09-18T12:00:00.000Z') })],
                correctionsChangedAt: new Date('2026-09-17T12:00:00.000Z'),
            }),
        );

        expect(decision?.kind).toBe('copy');
    });

    it('⛔ does NOT copy when a correction moved after the answer landed', () => {
        const [decision] = evaluateCopyForward(
            makeInput({
                candidates: [makeCandidate({ landedAt: new Date('2026-09-17T12:00:00.000Z') })],
                correctionsChangedAt: new Date('2026-09-18T12:00:00.000Z'),
            }),
        );

        expect(decision).toEqual({ kind: 'enqueue' });
    });

    /**
     * The boundary is decided toward RE-EARNING the answer: a correction recorded in the same instant the
     * answer landed may or may not have been visible to the parse, and the cheap wrong choice is to re-queue.
     */
    it('does NOT copy when the watermark is exactly the landing instant', () => {
        const landedAt = new Date('2026-09-18T12:00:00.000Z');

        const [decision] = evaluateCopyForward(
            makeInput({ candidates: [makeCandidate({ landedAt })], correctionsChangedAt: new Date(landedAt) }),
        );

        expect(decision).toEqual({ kind: 'enqueue' });
    });

    it('suppresses copy-forward for EVERY line once the watermark passes them all', () => {
        const decisions = evaluateCopyForward(
            makeInput({
                lines: [
                    { sourceLine: '2 cups flour', lineDigest: DIGEST_FLOUR },
                    { sourceLine: '3 eggs', lineDigest: DIGEST_EGGS },
                ],
                candidates: [
                    makeCandidate({ landedAt: new Date('2026-09-17T12:00:00.000Z') }),
                    makeCandidate({ lineDigest: DIGEST_EGGS, landedAt: new Date('2026-09-17T12:00:00.000Z') }),
                ],
                correctionsChangedAt: new Date('2026-09-18T12:00:00.000Z'),
            }),
        );

        expect(decisions).toEqual([{ kind: 'enqueue' }, { kind: 'enqueue' }]);
    });
});

describe('evaluateCopyForward — the kill switch', () => {
    /**
     * ⛔ `PARSE_COPY_FORWARD_MAX_AGE_HOURS = 0` disables the feature without a deploy: nothing can be newer
     * than "zero hours ago", so every line is re-queued. The watermark's blast radius is install-wide, so a
     * lever that does not need a code change is worth having.
     */
    it('copies nothing when the window is zero', () => {
        const decisions = evaluateCopyForward(makeInput({ maxAgeHours: 0 }));

        expect(decisions).toEqual([{ kind: 'enqueue' }]);
    });
});
