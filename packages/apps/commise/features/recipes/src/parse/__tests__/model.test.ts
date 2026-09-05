/**
 * The parse surface's PURE model — every projection both platform leaves render through.
 *
 * Written from the published contract and the service's own rules, not from the components:
 *
 *  - `parseJobAggregate.ts` — `running` while any line is pending, `partial` when none are pending and some
 *    are retryable, `complete` when all are terminal.
 *  - `parseJobExpiry.ts` / `ParseJobsDal.gateMutation` — the TTL sweep rides a 15-minute tick while a
 *    mutation is refused the instant `expires_at <= now()`, so the wire `status` and the real deadline
 *    disagree for up to a quarter of an hour.
 *  - `parseJobs.schema.ts` — `reviewReasons` is `string[]`, to be treated as opaque display keys WITH A
 *    FALLBACK; a proposal carries a food NAME and never an id (R19).
 *  - `ingredientQuantity.ts` — an ABSENT quantity is never a `0` and never a fabricated `1` (R40).
 *
 * The mutation lens applied throughout: every assertion below fails if the projection is broken in the one
 * way that state could plausibly be broken, and the boundary cases (expiry to the millisecond, an unknown
 * reason key, a line that named no foods) are asserted rather than the happy path alone.
 */
import { describe, expect, it } from 'vitest';

import { NotFoundError, ParseJobExpiredError } from '@kitchensink/recipe-service-client';
import type { ParseJobLineView, ParseJobResponse, ParseProposal } from '@kitchensink/recipe-service-client';

import { recipeParseMessages } from '../messages.js';
import {
    PARSE_JOB_STALL_BOUND_MS,
    toParseJobProgress,
    toParseJobViewState,
    toParseLineModel,
    toParseSubmissionModel,
} from '../model.js';

const messages = recipeParseMessages.en;
const NOW = Date.parse('2026-09-02T12:00:00.000Z');

/** A job with the deadline comfortably ahead, so `expiresAt` never decides a test that is not about it. */
function job(overrides: Partial<ParseJobResponse> = {}): ParseJobResponse {
    return {
        id: '00000000-0000-4000-8000-00000000d001',
        status: 'running',
        createdAt: '2026-09-02T11:59:00.000Z',
        expiresAt: new Date(NOW + 3_600_000).toISOString(),
        lines: [],
        ...overrides,
    };
}

function line(overrides: Partial<ParseJobLineView> = {}): ParseJobLineView {
    return { lineIndex: 0, sourceLine: '2 cups flour', status: 'pending', proposal: null, ...overrides };
}

function proposal(overrides: Partial<ParseProposal> = {}): ParseProposal {
    return {
        raw: '2 cups flour',
        quantity: { kind: 'exact', value: 2 },
        unit: 'cup',
        statedMeasure: '2 cups',
        foods: [{ name: 'flour', prep: null }],
        reviewReasons: [],
        ...overrides,
    };
}

// ── toParseSubmissionModel ────────────────────────────────────────────────────────────────────────

describe('toParseSubmissionModel — what the cook is told BEFORE the round trip', () => {
    it('counts the admissible lines the job would actually store, not the raw newlines', () => {
        // The shared splitter trims and drops blanks. A count taken off `text.split('\n')` would promise a
        // cook four lines and create two.
        const model = toParseSubmissionModel('2 cups flour\n\n   \n1 tsp salt', messages);

        expect(model.lineCount).toBe(2);
        expect(model.canSubmit).toBe(true);
        expect(model.refusals).toEqual([]);
    });

    it('refuses an empty paste with a sentence, and blocks submission', () => {
        const model = toParseSubmissionModel('   \n\n ', messages);

        expect(model.canSubmit).toBe(false);
        expect(model.lineCount).toBe(0);
        expect(model.refusals).toEqual([messages.refusalNoLines]);
    });

    it('names the OFFENDING LINE in 1-based terms — a cook counts from one, the wire from zero', () => {
        const model = toParseSubmissionModel(`ok\n${'x'.repeat(1001)}`, messages);

        expect(model.canSubmit).toBe(false);
        expect(model.refusals).toEqual(['Line 2 is longer than 1000 characters. Shorten it and try again.']);
    });

    it('reports EVERY offending line at once, not one round trip at a time', () => {
        const long = 'x'.repeat(1001);
        const model = toParseSubmissionModel(`${long}\nok\n${long}`, messages);

        expect(model.refusals).toHaveLength(2);
        expect(model.refusals[0]).toContain('Line 1');
        expect(model.refusals[1]).toContain('Line 3');
    });

    it('refuses a paste past the line cap, naming the cap', () => {
        const model = toParseSubmissionModel(
            Array.from({ length: 201 }, (_, i) => `line ${String(i)}`).join('\n'),
            messages,
        );

        expect(model.canSubmit).toBe(false);
        expect(model.refusals).toContain('That’s more than 200 lines. Paste them in smaller batches.');
    });

    it('admits a paste sitting exactly ON the caps — the bounds are inclusive', () => {
        const atLineCap = Array.from({ length: 200 }, (_, i) => `line ${String(i)}`).join('\n');

        expect(toParseSubmissionModel(atLineCap, messages).canSubmit).toBe(true);
        expect(toParseSubmissionModel('x'.repeat(1000), messages).canSubmit).toBe(true);
    });
});

// ── toParseJobProgress ────────────────────────────────────────────────────────────────────────────

describe('toParseJobProgress', () => {
    it('counts each line status once and settles only the terminal ones', () => {
        const progress = toParseJobProgress(
            job({
                lines: [
                    line({ lineIndex: 0, status: 'parsed', proposal: proposal() }),
                    line({ lineIndex: 1, status: 'unparseable' }),
                    line({ lineIndex: 2, status: 'failed_retryable' }),
                    line({ lineIndex: 3, status: 'pending' }),
                ],
            }),
        );

        expect(progress).toEqual({ total: 4, parsed: 1, unparseable: 1, retryable: 1, pending: 1, settled: 2 });
    });

    it('does NOT count a retryable line as settled — it is outstanding work, not a verdict', () => {
        const progress = toParseJobProgress(job({ lines: [line({ status: 'failed_retryable' })] }));

        expect(progress.settled).toBe(0);
        expect(progress.retryable).toBe(1);
    });

    it('reports an empty job as zero of zero rather than dividing by nothing', () => {
        expect(toParseJobProgress(job({ lines: [] }))).toEqual({
            total: 0,
            parsed: 0,
            unparseable: 0,
            retryable: 0,
            pending: 0,
            settled: 0,
        });
    });
});

// ── toParseJobViewState ───────────────────────────────────────────────────────────────────────────

describe('toParseJobViewState — the one place a state is decided', () => {
    it('is loading while the first view has not arrived', () => {
        expect(toParseJobViewState({ job: undefined, error: undefined, now: NOW, runningSince: NOW })).toEqual({
            kind: 'loading',
        });
    });

    it('is running while work is in progress', () => {
        const state = toParseJobViewState({
            job: job({ status: 'running', lines: [line()] }),
            error: undefined,
            now: NOW,
            runningSince: NOW,
        });

        expect(state.kind).toBe('running');
    });

    it('is settling for a partial job — some lines did not go through, and may yet', () => {
        const state = toParseJobViewState({
            job: job({ status: 'partial', lines: [line({ status: 'failed_retryable' })] }),
            error: undefined,
            now: NOW,
            runningSince: NOW,
        });

        expect(state.kind).toBe('settling');
    });

    it('is ready once every line is terminal', () => {
        const state = toParseJobViewState({
            job: job({ status: 'complete', lines: [line({ status: 'parsed', proposal: proposal() })] }),
            error: undefined,
            now: NOW,
            runningSince: NOW,
        });

        expect(state.kind).toBe('ready');
    });

    it('is stalled once a running job has been running past the bound', () => {
        // ⛔ The failure this exists for: a DLQ'd message leaves its line `pending` forever, the aggregate's
        // first arm KEEPS the status, and the job stays `running` until the 24-hour TTL. Without this the
        // cook watches a spinner for a day with no control and no explanation.
        const state = toParseJobViewState({
            job: job({ status: 'running', lines: [line()] }),
            error: undefined,
            now: NOW + PARSE_JOB_STALL_BOUND_MS + 1,
            runningSince: NOW,
        });

        expect(state.kind).toBe('stalled');
    });

    it('is still running exactly ON the bound — the boundary is not yet past', () => {
        const state = toParseJobViewState({
            job: job({ status: 'running', lines: [line()] }),
            error: undefined,
            now: NOW + PARSE_JOB_STALL_BOUND_MS,
            runningSince: NOW,
        });

        expect(state.kind).toBe('running');
    });

    it('does NOT stall a settling job — a partial job is waiting on messages, not stuck', () => {
        const state = toParseJobViewState({
            job: job({ status: 'partial', lines: [line({ status: 'failed_retryable' })] }),
            error: undefined,
            now: NOW + PARSE_JOB_STALL_BOUND_MS * 10,
            runningSince: NOW,
        });

        expect(state.kind).toBe('settling');
    });

    it('is expired when the STORED status says so', () => {
        const state = toParseJobViewState({
            job: job({ status: 'expired' }),
            error: undefined,
            now: NOW,
            runningSince: NOW,
        });

        expect(state.kind).toBe('expired');
    });

    it('⛔ is expired once expiresAt has passed, even while the stored status still says running', () => {
        // The TTL sweep rides a 15-minute tick; `gateMutation` refuses on the TIMESTAMP. For that whole
        // window a status-only reading would render a live job and offer controls the server answers 409 to.
        const state = toParseJobViewState({
            job: job({ status: 'running', expiresAt: new Date(NOW - 1).toISOString(), lines: [line()] }),
            error: undefined,
            now: NOW,
            runningSince: NOW,
        });

        expect(state.kind).toBe('expired');
    });

    it('is still live exactly ON the deadline — the service refuses at `<=`, so the client must too', () => {
        const state = toParseJobViewState({
            job: job({ status: 'running', expiresAt: new Date(NOW).toISOString(), lines: [line()] }),
            error: undefined,
            now: NOW,
            runningSince: NOW,
        });

        expect(state.kind).toBe('expired');
    });

    it('treats an unreadable expiresAt as expired — an unreadable deadline fails CLOSED', () => {
        const state = toParseJobViewState({
            job: { ...job({ status: 'running', lines: [line()] }), expiresAt: 'not-a-date' },
            error: undefined,
            now: NOW,
            runningSince: NOW,
        });

        expect(state.kind).toBe('expired');
    });

    it('is missing for a 404 — a stranger and an absent job are ONE answer', () => {
        const state = toParseJobViewState({
            job: undefined,
            error: new NotFoundError('nope', 'PARSE_JOB_NOT_FOUND'),
            now: NOW,
            runningSince: NOW,
        });

        expect(state.kind).toBe('missing');
    });

    it('is expired for the mutation-side expiry refusal', () => {
        const state = toParseJobViewState({
            job: undefined,
            error: new ParseJobExpiredError(),
            now: NOW,
            runningSince: NOW,
        });

        expect(state.kind).toBe('expired');
    });

    it('is failed for any other error', () => {
        const state = toParseJobViewState({
            job: undefined,
            error: new Error('boom'),
            now: NOW,
            runningSince: NOW,
        });

        expect(state.kind).toBe('failed');
    });

    it('⛔ prefers the JOB over a stale error — a poll that recovers must leave the error state', () => {
        // TanStack keeps the last `error` alongside fresh `data` after a refetch succeeds. Reading the error
        // first would pin a recovered surface on its failure screen forever.
        const state = toParseJobViewState({
            job: job({ status: 'complete', lines: [line({ status: 'parsed', proposal: proposal() })] }),
            error: new Error('a poll that has since recovered'),
            now: NOW,
            runningSince: NOW,
        });

        expect(state.kind).toBe('ready');
    });

    it('carries the progress on every state that has a job, so a leaf never recomputes it', () => {
        const state = toParseJobViewState({
            job: job({
                status: 'running',
                lines: [line(), line({ lineIndex: 1, status: 'parsed', proposal: proposal() })],
            }),
            error: undefined,
            now: NOW,
            runningSince: NOW,
        });

        expect(state.kind === 'running' && state.progress.settled).toBe(1);
    });
});

// ── toParseLineModel ──────────────────────────────────────────────────────────────────────────────

describe('toParseLineModel', () => {
    /**
     * The two row names are DIFFERENT on purpose, and the difference is the platform's, not the copy's.
     * Web names a `<li>`, which does not suppress its contents, so `label` alone is the row's name there.
     * Native groups the header into ONE accessibility element — the only way the name reaches iOS at all,
     * and the only way it survives Fabric's view flattening on Android — and a grouped element is read
     * INSTEAD of its children, so its name must restate what those children say.
     */
    it('⛔ composes a native row name that restates the line, its text and its status', () => {
        const model = toParseLineModel(
            line({ lineIndex: 0, sourceLine: '2 cups flour', status: 'parsed', proposal: proposal() }),
            messages,
            'en',
        );

        expect(model.label).toBe('Line 1');
        expect(model.headerLabel).toBe('Line 1: 2 cups flour. Read');
    });

    it('renders the measure through the shared formatter both platforms already use', () => {
        const model = toParseLineModel(line({ status: 'parsed', proposal: proposal() }), messages, 'en');

        expect(model.measure).toBe('2 cup');
    });

    it('⛔ renders NO NUMBER for an absent quantity — never a 0, never a fabricated 1 (R40)', () => {
        const model = toParseLineModel(
            line({
                status: 'parsed',
                proposal: proposal({ quantity: { kind: 'absent' }, unit: null, statedMeasure: 'the size of an egg' }),
            }),
            messages,
            'en',
        );

        expect(model.measure).toBe(messages.lineNoMeasure);
        expect(model.measure).not.toContain('0');
        expect(model.measure).not.toContain('1');
    });

    it('keeps a unit an absent quantity still states — "a pinch" is a measure with no number', () => {
        const model = toParseLineModel(
            line({ status: 'parsed', proposal: proposal({ quantity: { kind: 'absent' }, unit: 'pinch' }) }),
            messages,
            'en',
        );

        expect(model.measure).toBe('pinch');
    });

    it('renders a range with the en dash both platforms print', () => {
        const model = toParseLineModel(
            line({ status: 'parsed', proposal: proposal({ quantity: { kind: 'range', low: 2, high: 3 } }) }),
            messages,
            'en',
        );

        expect(model.measure).toBe('2–3 cup');
    });

    it('carries every food the line named, in order, with its prep', () => {
        const model = toParseLineModel(
            line({
                status: 'parsed',
                proposal: proposal({
                    foods: [
                        { name: 'onion', prep: 'chopped' },
                        { name: 'garlic', prep: null },
                    ],
                }),
            }),
            messages,
            'en',
        );

        expect(model.foods).toEqual([
            { name: 'onion', prep: 'chopped' },
            { name: 'garlic', prep: null },
        ]);
    });

    it('reports a line that named no foods as a FACT, not a failure — a heading is a legitimate line', () => {
        const model = toParseLineModel(
            line({ status: 'parsed', proposal: proposal({ foods: [], reviewReasons: ['group_header'] }) }),
            messages,
            'en',
        );

        expect(model.foods).toEqual([]);
        expect(model.emptyFoodsNotice).toBe(messages.lineNoFoods);
    });

    it('localizes a review reason this build knows', () => {
        const model = toParseLineModel(
            line({ status: 'parsed', proposal: proposal({ reviewReasons: ['group_header'] }) }),
            messages,
            'en',
        );

        expect(model.reviewReasons).toEqual(['This looks like a heading, not an ingredient']);
    });

    it('⛔ falls back for a reason key this build has never seen — never a blank chip, never raw snake_case', () => {
        // The wire types reasons as opaque strings precisely so the pipeline may add one ahead of a released
        // mobile binary. A missing entry must degrade to a vague-but-true sentence.
        const model = toParseLineModel(
            line({ status: 'parsed', proposal: proposal({ reviewReasons: ['a_reason_from_the_future'] }) }),
            messages,
            'en',
        );

        expect(model.reviewReasons).toEqual([messages.reasonUnknown]);
        expect(model.reviewReasons[0]).not.toContain('_');
    });

    it('offers no proposal fields at all for a line that has not landed', () => {
        const model = toParseLineModel(line({ status: 'pending' }), messages, 'en');

        expect(model.measure).toBeUndefined();
        expect(model.foods).toBeUndefined();
        expect(model.reviewReasons).toEqual([]);
        expect(model.statusLabel).toBe(messages.linePending);
    });

    it('labels each line status with its own word and tone', () => {
        expect(toParseLineModel(line({ status: 'parsed', proposal: proposal() }), messages, 'en')).toMatchObject({
            statusLabel: messages.lineParsed,
            tone: 'success',
        });
        expect(toParseLineModel(line({ status: 'unparseable' }), messages, 'en')).toMatchObject({
            statusLabel: messages.lineUnparseable,
            tone: 'error',
        });
        expect(toParseLineModel(line({ status: 'failed_retryable' }), messages, 'en')).toMatchObject({
            statusLabel: messages.lineRetryable,
            tone: 'warning',
        });
        expect(toParseLineModel(line({ status: 'pending' }), messages, 'en')).toMatchObject({
            statusLabel: messages.linePending,
            tone: 'progress',
        });
    });

    it('⛔ tells an UNPARSEABLE line apart from a RETRYABLE one — only one of them a retry can help', () => {
        // `unparseable` is terminal (the validator loop exhausted); `retry` re-drives ONLY the
        // `failed_retryable` population. Rendering them alike would offer a control that provably does
        // nothing for half the lines it appears on.
        expect(toParseLineModel(line({ status: 'unparseable' }), messages, 'en').tone).not.toBe(
            toParseLineModel(line({ status: 'failed_retryable' }), messages, 'en').tone,
        );
    });

    it('numbers the row from ONE for a human while keeping the wire index for the API', () => {
        const model = toParseLineModel(line({ lineIndex: 4 }), messages, 'en');

        expect(model.lineIndex).toBe(4);
        expect(model.label).toBe('Line 5');
        expect(model.editLabel).toBe('Edit line 5');
    });
});
