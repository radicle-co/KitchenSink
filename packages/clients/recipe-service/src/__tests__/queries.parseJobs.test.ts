/**
 * The parse-job READ SEAM (`parseJobQueries`) — its key, its fetcher, and the rule that actually matters
 * here: WHEN THE POLL STOPS, AND HOW FAST IT RUNS.
 *
 * ⚠️ REWRITTEN TWICE. The first version asserted that a `partial` job stops the poll; the second justified polling it
 * with a self-heal that U6 has since mostly closed. What is true now (plan 2026-10-15-011):
 *
 *  1. A `failed_retryable` line comes from two writers — the producer's enqueue-failure mark and the worker's landing
 *     when neither engine answered — and `claimLine` (`handlers/parseLine.ts`) only claims a `pending` line, so a
 *     message that arrives AFTER the mark is refused.
 *  2. A worker that claimed BEFORE the mark still lands — the landing `UPDATE` has no status predicate — and
 *     `PARSE_JOB_AGGREGATE_SQL` re-derives a `partial` job on that landing.
 *
 * So a `partial` job can still move, but only by that narrow race: it polls at the slow settling cadence, and a line
 * left `failed_retryable` waits on the cook (Try again, or Add as written).
 *
 * ⛔ THERE IS NO TIME LIMIT (owner ruling 2026-10-13: "it takes as long as it takes"). A `running` job polls until it
 * settles or expires. What keeps a long wait from becoming a request storm is the BACK-OFF: when every pending line
 * reads `stalled`, nothing is moving, so the poll drops to the settling cadence until something does.
 *
 * ⛔ AND EXPIRY IS DERIVED FROM `expiresAt`, NOT READ OFF `status`. The TTL sweep runs on a 15-minute tick
 * while `ParseJobsDal.gateMutation` refuses a mutation the instant `expires_at <= now()` — so for up to a
 * quarter of an hour `GET` answers `running` while `retry`/`editLine` both `409`. The sweep's own docstring
 * says the `202` carries `expiresAt` "so the client knows the review deadline"; a client that only read
 * `status` would poll a dead job and offer controls the server refuses.
 *
 * The states that DO stop it, each for its own reason:
 *  - `complete` — every line is terminal; nothing can change.
 *  - `expired` — the sweep closed it, and the aggregate's `WHERE` guard means a late landing cannot reopen it.
 *  - past `expiresAt` — the same fact, before the sweep has caught up.
 *  - `undefined` — consulted before the first response lands; a cadence here starts a second request on
 *    top of the initial fetch.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ParseJobResponse } from '@kitchensink/schema-recipe';

import type { RecipeServiceClient } from '../client.js';
import {
    DEFAULT_PARSE_JOB_POLL_INTERVAL_MS,
    PARSE_JOB_SETTLING_POLL_INTERVAL_MS,
    parseJobPollIntervalOf,
    parseJobQueries,
    recipeServiceKeys,
} from '../index.js';
import { FIXTURE_PARSE_JOB_UUID, makeParseJob, makeParseJobLine } from '../__fixtures__/parseJobs.js';

/** A client stand-in carrying only the methods these factories call. */
function makeFakeClient(methods: Partial<RecipeServiceClient>): RecipeServiceClient {
    return methods as RecipeServiceClient;
}

/** The factory under test, with a fetcher that is never called unless a test calls it. */
function detailOptions(pollIntervalMs?: number) {
    const client = makeFakeClient({ getParseJob: vi.fn() });

    return parseJobQueries(client).detail(FIXTURE_PARSE_JOB_UUID, pollIntervalMs);
}

/** Read a factory's `refetchInterval` as the callable TanStack invokes with the live query. */
function pollDecision(
    options: { readonly refetchInterval?: unknown },
    data: ParseJobResponse | undefined,
): number | false {
    const refetchInterval = options.refetchInterval as (query: {
        state: { data: ParseJobResponse | undefined };
    }) => number | false;

    return refetchInterval({ state: { data } });
}

/** A job whose TTL is comfortably ahead, so `expiresAt` never decides the outcome under test. */
function live(status: ParseJobResponse['status']): ParseJobResponse {
    return makeParseJob({ status, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
}

describe('parseJobQueries.detail — key and fetcher', () => {
    it('keys the job under its own parse-jobs namespace and calls getParseJob', async () => {
        const getParseJob = vi.fn().mockResolvedValue(makeParseJob());
        const options = parseJobQueries(makeFakeClient({ getParseJob })).detail(FIXTURE_PARSE_JOB_UUID);

        expect(options.queryKey).toEqual(recipeServiceKeys.parseJob(FIXTURE_PARSE_JOB_UUID));
        await options.queryFn?.({} as never);
        expect(getParseJob).toHaveBeenCalledExactlyOnceWith(FIXTURE_PARSE_JOB_UUID);
    });

    it('gives two jobs two distinct cache entries', () => {
        expect(recipeServiceKeys.parseJob('a')).not.toEqual(recipeServiceKeys.parseJob('b'));
    });

    it('keeps the parse-job namespace OUT of the recipe key regions a recipe write stales', () => {
        // R19: a parse binds nothing. A recipe/list/search/collection write changes no parse job, and a
        // parse job changes no recipe — so an accidental nesting under `recipes` would make every recipe
        // write refetch every open parse job (and vice versa, once a review creates a recipe).
        const key = [...recipeServiceKeys.parseJob(FIXTURE_PARSE_JOB_UUID)];

        expect(key.slice(0, recipeServiceKeys.recipes.length)).not.toEqual([...recipeServiceKeys.recipes]);
        expect(key[0]).toBe(recipeServiceKeys.all[0]);
    });
});

describe('parseJobQueries.detail — the poll keeps running while the job can still move', () => {
    it('polls at the default cadence while the job is running', () => {
        expect(pollDecision(detailOptions(), live('running'))).toBe(DEFAULT_PARSE_JOB_POLL_INTERVAL_MS);
    });

    it('KEEPS POLLING a partial job, at the settling cadence — a claim taken before the mark still lands', () => {
        // See the module docstring: a worker that claimed before the mark lands with no status predicate.
        expect(pollDecision(detailOptions(), live('partial'))).toBe(PARSE_JOB_SETTLING_POLL_INTERVAL_MS);
    });

    it('settles a partial job more slowly than a running one — it is waiting, not working', () => {
        expect(PARSE_JOB_SETTLING_POLL_INTERVAL_MS).toBeGreaterThan(DEFAULT_PARSE_JOB_POLL_INTERVAL_MS);
    });

    it('honours a caller-supplied cadence for the running case', () => {
        expect(pollDecision(detailOptions(9000), live('running'))).toBe(9000);
    });

    it('leaves the settling cadence alone when the running cadence is overridden', () => {
        // The override names how often to watch work IN PROGRESS. A settling job is a different question,
        // and folding them would let a fast override turn the long tail into a request storm.
        expect(pollDecision(detailOptions(50), live('partial'))).toBe(PARSE_JOB_SETTLING_POLL_INTERVAL_MS);
    });
});

describe('parseJobQueries.detail — the poll stops when nothing more can be learned', () => {
    it('stops on a complete job — every line is terminal', () => {
        expect(pollDecision(detailOptions(), live('complete'))).toBe(false);
    });

    it('stops on an expired job — a late landing cannot reopen it', () => {
        expect(pollDecision(detailOptions(), live('expired'))).toBe(false);
    });

    it('stops once expiresAt has passed, even while the stored status still says running', () => {
        // ⛔ THE 15-MINUTE SWEEP WINDOW. `gateMutation` refuses a mutation on the TIMESTAMP, so the job is
        // already dead to `retry`/`editLine` while `GET` still answers `running`. Polling it learns nothing.
        const stale = makeParseJob({ status: 'running', expiresAt: new Date(Date.now() - 1000).toISOString() });

        expect(pollDecision(detailOptions(), stale)).toBe(false);
    });

    it('stops on a partial job past its TTL too — expiry outranks settling', () => {
        const stale = makeParseJob({ status: 'partial', expiresAt: new Date(Date.now() - 1000).toISOString() });

        expect(pollDecision(detailOptions(), stale)).toBe(false);
    });

    it('does not schedule a poll before the first response has landed', () => {
        expect(pollDecision(detailOptions(), undefined)).toBe(false);
    });

    it('does not poll on an unparseable expiresAt — an unreadable deadline fails CLOSED', () => {
        // `Date.parse` answers `NaN` here, and every comparison against `NaN` is false — so a naive
        // `parsed <= now` check would fall through and poll forever. The guard is explicit for that reason.
        const broken = { ...makeParseJob({ status: 'running' }), expiresAt: 'not-a-date' };

        expect(pollDecision(detailOptions(), broken)).toBe(false);
    });
});

/**
 * The cadence as a pure decision (`parseJobPollIntervalOf`, plan 2026-10-15-011) — the back-off that replaces the
 * client's old 3-minute give-up. A stalled paste is still watched, just less often.
 */
describe('parseJobPollIntervalOf — no time limit, but no storm', () => {
    const NOW = Date.parse('2026-10-15T10:00:00.000Z');
    const LIVE = '2026-10-16T10:00:00.000Z';

    function runningWith(phases: readonly ('queued' | 'reading' | 'retrying' | 'delayed' | 'stalled' | null)[]) {
        return makeParseJob({
            status: 'running',
            expiresAt: LIVE,
            lines: phases.map((phase, lineIndex) =>
                phase === null
                    ? makeParseJobLine({ lineIndex, status: 'parsed' })
                    : makeParseJobLine({ lineIndex, progress: { phase } }),
            ),
        });
    }

    it.each([
        { why: 'lines are being read', phases: ['reading', 'queued'], cadence: 'running' },
        { why: 'one line is stalled but another is moving', phases: ['stalled', 'delayed'], cadence: 'running' },
        { why: 'the landed lines do not count as moving', phases: [null, 'stalled', 'stalled'], cadence: 'settling' },
        { why: 'every pending line is stalled', phases: ['stalled', 'stalled'], cadence: 'settling' },
        { why: 'every line landed and the aggregate is due', phases: [null], cadence: 'running' },
    ] as const)('a running job where $why polls at the $cadence cadence', ({ phases, cadence }) => {
        expect(parseJobPollIntervalOf(runningWith(phases), NOW, 4000)).toBe(
            cadence === 'running' ? 4000 : PARSE_JOB_SETTLING_POLL_INTERVAL_MS,
        );
    });

    it('keeps watching a stalled paste for as long as it lives — no clock gives up on it', () => {
        const stalled = runningWith(['stalled']);

        expect(parseJobPollIntervalOf(stalled, Date.parse(LIVE) - 1, 4000)).toBe(PARSE_JOB_SETTLING_POLL_INTERVAL_MS);
        expect(parseJobPollIntervalOf(stalled, Date.parse(LIVE), 4000)).toBe(false);
    });

    it('stops on the terminal states and polls partial slowly', () => {
        expect(parseJobPollIntervalOf(makeParseJob({ status: 'complete', expiresAt: LIVE }), NOW, 4000)).toBe(false);
        expect(parseJobPollIntervalOf(makeParseJob({ status: 'expired', expiresAt: LIVE }), NOW, 4000)).toBe(false);
        expect(parseJobPollIntervalOf(makeParseJob({ status: 'partial', expiresAt: LIVE }), NOW, 4000)).toBe(
            PARSE_JOB_SETTLING_POLL_INTERVAL_MS,
        );
    });
});
