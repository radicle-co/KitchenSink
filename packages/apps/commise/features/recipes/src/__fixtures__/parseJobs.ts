/**
 * @module @commise/features-recipes/__fixtures__ — `make*` factories for the parse-job wire views the Ingredients
 * section's paste reads (`/api/v1/recipe-parse-jobs`). Local, so this package's tests depend on no client package's
 * fixtures. Each accepts a `Partial<T>`; the defaults are the state a fresh job is in (one PENDING line, no proposal).
 */
import type { ParseJobLineView, ParseJobResponse, ParseProposal, ParseProposalFood } from '@kitchensink/schema-recipe';

/** A job id; the wire's `id` is a UUID. */
export const PASTE_JOB_ID = '00000000-0000-4000-8000-00000000e001';

/** One proposed food: a name to resolve, never a binding (R19). */
export function makeParseProposalFood(overrides: Partial<ParseProposalFood> = {}): ParseProposalFood {
    return { name: 'flour', prep: null, ...overrides };
}

/** One line's proposal. */
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

/** One job line, pending with no proposal unless overridden. */
export function makeParseJobLine(overrides: Partial<ParseJobLineView> = {}): ParseJobLineView {
    return { lineIndex: 0, sourceLine: '2 cups flour', status: 'pending', proposal: null, ...overrides };
}

/** A running job with one pending line unless overridden. Live for a day from 2026-10-09T10:00Z. */
export function makeParseJob(overrides: Partial<ParseJobResponse> = {}): ParseJobResponse {
    return {
        id: PASTE_JOB_ID,
        status: 'running',
        createdAt: '2026-10-09T10:00:00.000Z',
        expiresAt: '2026-10-10T10:00:00.000Z',
        lines: [makeParseJobLine()],
        ...overrides,
    };
}
