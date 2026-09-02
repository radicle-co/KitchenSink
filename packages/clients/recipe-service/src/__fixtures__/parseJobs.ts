/**
 * `make*` fixture factories for the ASYNC PARSE-JOB resource (`/api/v1/recipe-parse-jobs`), following the
 * same rules as `./recipes.ts`: each accepts a `Partial<T>` of overrides and returns a fully-defined,
 * JSON-safe value, so a fixture round-trips through a fake fetch (`JSON.stringify` → `JSON.parse`) and
 * still `toEqual`s the input.
 *
 * ⛔ THE IDS ARE REAL UUIDs, and that is not cosmetic here the way `'rec_1'` is legal elsewhere.
 * `parseJobResponseSchema.id` is `z.uuid()` (not the loose `idSchema`), and the client PARSES every success
 * body — so a readable token would make every fixture fail at the boundary rather than at the assertion,
 * which reads like a client defect and is not one.
 *
 * ⚠️ `proposal` is `null` for a line that has not landed, and the default line here is deliberately the
 * PENDING one: a fixture whose default is the happy landing makes it easy to write a suite that never
 * exercises the state a freshly-created job is actually in.
 */
import type { ParseJobLineView, ParseJobResponse, ParseProposal, ParseProposalFood } from '@kitchensink/schema-recipe';

/** A `recipe_parse_jobs` row id. `parseJobResponseSchema.id` is `z.uuid()`, so a token would not parse. */
export const FIXTURE_PARSE_JOB_UUID = '00000000-0000-4000-8000-00000000d001';

/** A second job id, for tests that must show one job's cache entry is not another's. */
export const FIXTURE_OTHER_PARSE_JOB_UUID = '00000000-0000-4000-8000-00000000d002';

/** One food a parse proposes — a NAME to resolve, never a binding (R19: there is no id field on the wire). */
export function makeParseProposalFood(overrides: Partial<ParseProposalFood> = {}): ParseProposalFood {
    return { name: 'flour', prep: null, ...overrides };
}

/** The parsed proposal for one line — the wire projection of the worker's stored `ParsedLine`. */
export function makeParseProposal(overrides: Partial<ParseProposal> = {}): ParseProposal {
    return {
        raw: '2 cups flour',
        quantity: { kind: 'exact', value: 2 },
        unit: 'cup',
        statedMeasure: '2 cups',
        foods: [makeParseProposalFood()],
        reviewReasons: [],
        ...overrides,
    };
}

/** One line of a job view. Defaults to `pending` with no proposal — the state a fresh job is in. */
export function makeParseJobLine(overrides: Partial<ParseJobLineView> = {}): ParseJobLineView {
    return { lineIndex: 0, sourceLine: '2 cups flour', status: 'pending', proposal: null, ...overrides };
}

/** The job view every one of the four endpoints answers with. Defaults to a single-line `running` job. */
export function makeParseJob(overrides: Partial<ParseJobResponse> = {}): ParseJobResponse {
    return {
        id: FIXTURE_PARSE_JOB_UUID,
        status: 'running',
        createdAt: '2026-09-02T10:00:00.000Z',
        expiresAt: '2026-09-03T10:00:00.000Z',
        lines: [makeParseJobLine()],
        ...overrides,
    };
}

/** A `complete` job whose single line landed a clean proposal — the review surface's populated state. */
export function makeCompleteParseJob(overrides: Partial<ParseJobResponse> = {}): ParseJobResponse {
    return makeParseJob({
        status: 'complete',
        lines: [makeParseJobLine({ status: 'parsed', proposal: makeParseProposal() })],
        ...overrides,
    });
}
