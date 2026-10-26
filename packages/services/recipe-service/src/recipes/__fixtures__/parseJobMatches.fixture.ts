/**
 * Test fixtures for the paste matcher (ADR-0071): an in-memory {@link ParseJobMatchesPort} with the SAME rules the
 * real repository enforces in SQL, and a stored parse-job line.
 *
 * ⚠️ The rules are restated here so the unit and integration tiers can exercise the matcher against them; the LOCAL
 * e2e (`tests/e2e/parseJobs/parseJobMatches.e2e.test.ts`) is what proves the SQL keeps them. If the two ever
 * disagree, the e2e is the authority.
 */
import { lineDigest, type LineDigest } from '@kitchensink/recipe-core/parsing/parse-key';

import { sha256Hex } from '../../common/sha256.js';
import type { ParseJobLineRecord, ParseJobRecord } from '../parseJobs.service.js';
import type {
    EnqueueClaim,
    EnqueueRequest,
    MatchSlot,
    NewParseJobMatch,
    ParseJobMatch,
    ParseJobMatchesPort,
} from '../domain/parseJobMatch.js';

/** An in-memory matches repository, with the rows it holds exposed for assertions. */
export interface InMemoryParseJobMatches extends ParseJobMatchesPort {
    /** Every row, by `jobId:line:food`. */
    readonly rows: Map<string, Omit<ParseJobMatch, 'lineDigestNow'> & { readonly jobId: string }>;
    /** The owner of each job, so `findForJob` can apply the owner filter. */
    readonly owners: Map<string, string>;
}

const keyOf = (jobId: string, slot: MatchSlot): string =>
    `${jobId}:${String(slot.lineIndex)}:${String(slot.foodIndex)}`;

/**
 * An in-memory {@link ParseJobMatchesPort}, restating the repository's SQL rules (the LOCAL e2e is their authority):
 * a write lands only for the line's current digest, the same judgement keeps the first writer and another replaces it,
 * and a claim is a lease for one digest and key, released only by its own timestamp.
 *
 * ⚠️ The lost-request re-claim is restated on AGE alone: this double cannot see the verdict or attempts tables, which
 * the real claim also requires to be empty.
 *
 * @param owners - Job id → owner, for the read's owner filter.
 * @param lineDigestOf - The line's stored digest now, when a suite edits lines; absent, every row's own digest is
 *     taken as current.
 * @returns The repository.
 */
export function inMemoryParseJobMatches(
    owners: ReadonlyMap<string, string> = new Map(),
    lineDigestOf?: (jobId: string, lineIndex: number) => LineDigest | undefined,
): InMemoryParseJobMatches {
    const rows: InMemoryParseJobMatches['rows'] = new Map();
    const ownerMap = new Map(owners);
    const digestNow = (jobId: string, lineIndex: number, fallback: LineDigest): LineDigest =>
        lineDigestOf?.(jobId, lineIndex) ?? fallback;

    return {
        rows,
        owners: ownerMap,
        findForJob: async (ownerId, jobId) =>
            ownerMap.get(jobId) !== ownerId
                ? []
                : [...rows.values()]
                      .filter((row) => row.jobId === jobId)
                      .sort((a, b) => a.lineIndex - b.lineIndex || a.foodIndex - b.foodIndex)
                      .map(({ jobId: _jobId, ...match }) => ({
                          ...match,
                          lineDigestNow: digestNow(jobId, match.lineIndex, match.lineDigest),
                      })),
        saveMatches: async (jobId: string, matches: readonly NewParseJobMatch[]) => {
            for (const match of matches) {
                // Rule 2: only for the line's current digest.
                if (digestNow(jobId, match.lineIndex, match.lineDigest) !== match.lineDigest) {
                    continue;
                }

                const key = keyOf(jobId, match);
                const existing = rows.get(key);

                // Rule 3: the same judgement keeps the first writer; another replaces it, enqueue reset.
                if (existing === undefined || existing.judgementDigest !== match.judgementDigest) {
                    rows.set(key, { ...match, jobId, enqueuedAt: null });
                }
            }
        },
        claimEnqueue: async (jobId: string, requests: readonly EnqueueRequest[], staleAfterSeconds: number) => {
            const won: EnqueueClaim[] = [];
            const now = Date.now();

            for (const request of requests) {
                const row = rows.get(keyOf(jobId, request));
                const lost = row?.enqueuedAt != null && row.enqueuedAt.getTime() < now - staleAfterSeconds * 1_000;

                // Rule 4: an owed row for the request's digest and key, unclaimed or lost, is claimed once.
                if (
                    row !== undefined &&
                    row.review === 'owed' &&
                    row.lineDigest === request.lineDigest &&
                    row.verificationKey === request.verificationKey &&
                    (row.enqueuedAt === null || lost)
                ) {
                    const claimedAt = new Date(now);

                    rows.set(keyOf(jobId, request), { ...row, enqueuedAt: claimedAt });
                    won.push({ ...request, claimedAt });
                }
            }

            return won;
        },
        releaseEnqueue: async (jobId: string, claims: readonly EnqueueClaim[]) => {
            for (const claim of claims) {
                const row = rows.get(keyOf(jobId, claim));

                // Only THIS claim is released.
                if (
                    row !== undefined &&
                    row.lineDigest === claim.lineDigest &&
                    row.verificationKey === claim.verificationKey &&
                    row.enqueuedAt?.getTime() === claim.claimedAt.getTime()
                ) {
                    rows.set(keyOf(jobId, claim), { ...row, enqueuedAt: null });
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

/**
 * One parse-job line record. Defaults to a parsed line with one food, whose digest is the REAL digest of its text
 * (as the create path stores it), so the job view's staleness check agrees with the store.
 */
export function makeParseJobLine(overrides: Partial<ParseJobLineRecord> = {}): ParseJobLineRecord {
    const sourceLine = overrides.sourceLine ?? '2 cups whole milk';

    return {
        lineIndex: 0,
        sourceLine,
        lineDigest: lineDigest(sourceLine, sha256Hex),
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
