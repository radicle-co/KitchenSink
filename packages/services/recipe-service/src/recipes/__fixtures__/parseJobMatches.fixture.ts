/**
 * Test fixtures for the paste matcher (ADR-0071): an in-memory {@link ParseJobMatchesPort} with the SAME three rules the
 * real repository enforces in SQL, and a stored parse-job line.
 *
 * ⚠️ The rules are restated here so the unit and integration tiers can exercise the matcher against them; the LOCAL
 * e2e (`tests/e2e/parseJobs/parseJobMatches.e2e.test.ts`) is what proves the SQL keeps them. If the two ever
 * disagree, the e2e is the authority.
 */
import type { ParseJobLineRecord, ParseJobRecord } from '../parseJobs.service.js';
import type { MatchSlot, NewParseJobMatch, ParseJobMatch, ParseJobMatchesPort } from '../domain/parseJobMatch.js';

/** An in-memory matches repository, with the rows it holds exposed for assertions. */
export interface InMemoryParseJobMatches extends ParseJobMatchesPort {
    /** Every row, by `jobId:line:food`. */
    readonly rows: Map<string, ParseJobMatch & { readonly jobId: string }>;
    /** The owner of each job, so `findForJob` can apply the owner filter. */
    readonly owners: Map<string, string>;
}

const keyOf = (jobId: string, slot: MatchSlot): string =>
    `${jobId}:${String(slot.lineIndex)}:${String(slot.foodIndex)}`;

/**
 * An in-memory {@link ParseJobMatchesPort}.
 *
 * @param owners - Job id → owner, for the read's owner filter.
 * @returns The repository.
 */
export function inMemoryParseJobMatches(owners: ReadonlyMap<string, string> = new Map()): InMemoryParseJobMatches {
    const rows = new Map<string, ParseJobMatch & { readonly jobId: string }>();
    const ownerMap = new Map(owners);

    return {
        rows,
        owners: ownerMap,
        findForJob: async (ownerId, jobId) =>
            ownerMap.get(jobId) !== ownerId
                ? []
                : [...rows.values()]
                      .filter((row) => row.jobId === jobId)
                      .sort((a, b) => a.lineIndex - b.lineIndex || a.foodIndex - b.foodIndex)
                      .map(({ jobId: _jobId, ...match }) => match),
        saveMatches: async (jobId: string, matches: readonly NewParseJobMatch[]) => {
            for (const match of matches) {
                const key = keyOf(jobId, match);
                const existing = rows.get(key);

                // Rule 2: the same digest keeps the first writer; another digest replaces, enqueue reset.
                if (existing === undefined || existing.lineDigest !== match.lineDigest) {
                    rows.set(key, { ...match, jobId, enqueuedAt: null });
                }
            }
        },
        claimEnqueue: async (jobId: string, slots: readonly MatchSlot[]) => {
            const won: MatchSlot[] = [];

            for (const slot of slots) {
                const row = rows.get(keyOf(jobId, slot));

                // Rule 3: only an owed row with a key is claimed, once.
                if (row !== undefined && row.verificationKey !== null && row.enqueuedAt === null) {
                    rows.set(keyOf(jobId, slot), { ...row, enqueuedAt: new Date() });
                    won.push({ lineIndex: slot.lineIndex, foodIndex: slot.foodIndex });
                }
            }

            return won;
        },
        releaseEnqueue: async (jobId: string, slots: readonly MatchSlot[]) => {
            for (const slot of slots) {
                const row = rows.get(keyOf(jobId, slot));

                if (row !== undefined) {
                    rows.set(keyOf(jobId, slot), { ...row, enqueuedAt: null });
                }
            }
        },
    };
}

/** A stored proposal as the worker lands it: the fields the wire projection reads. */
export function makeStoredProposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        raw: '2 cups whole milk',
        quantity: { kind: 'exact', value: 2 },
        unit: 'cup',
        statedMeasure: '2 cups',
        foods: [{ name: 'whole milk', prep: null }],
        reviewReasons: [],
        ...overrides,
    };
}

/** One parse-job line record. Defaults to a parsed line with one food. */
export function makeParseJobLine(overrides: Partial<ParseJobLineRecord> = {}): ParseJobLineRecord {
    return {
        lineIndex: 0,
        sourceLine: '2 cups whole milk',
        lineDigest: 'digest-0',
        status: 'parsed',
        proposal: makeStoredProposal(),
        llmAttempts: 1,
        attempts: 1,
        claimAgeSeconds: null,
        ...overrides,
    };
}

/** One parse-job record. Defaults to a live, complete job. */
export function makeParseJobRecord(overrides: Partial<ParseJobRecord> = {}): ParseJobRecord {
    return {
        id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        status: 'complete',
        createdAt: new Date('2026-10-25T10:00:00.000Z'),
        expiresAt: new Date(Date.now() + 3_600_000),
        lines: [makeParseJobLine()],
        quietSeconds: 0,
        ...overrides,
    };
}
