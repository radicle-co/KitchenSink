import type { ParseJobResponse } from '@kitchensink/schema-recipe';

import { makeParseJob, makeParseJobLine, makeParseProposal, PASTE_JOB_ID } from '../../__fixtures__/parseJobs.js';
import { emptyPasteMatchSession, reducePasteMatchSession } from '../pasteMatchSession.js';

/** The session after the job was accepted and its one food joined the draft (only joined foods are drawn). */
export const JOINED_SESSION = [
    { type: 'jobAccepted', jobId: PASTE_JOB_ID } as const,
    { type: 'lineJoined', key: '0:0', draftKey: 'd-1' } as const,
].reduce(reducePasteMatchSession, emptyPasteMatchSession);

/** A one-line, one-food parse job whose line was pasted as `raw` and states `statedMeasure`. */
export function makePasteJob(raw: string, statedMeasure: string | null): ParseJobResponse {
    return makeParseJob({
        status: 'complete',
        lines: [
            makeParseJobLine({
                sourceLine: raw,
                status: 'parsed',
                proposal: makeParseProposal({ raw, statedMeasure }),
            }),
        ],
    });
}

/** Pasted lines with their stated measure: the row must show each exactly as the cook pasted it. */
export const PASTED_LINES: readonly (readonly [raw: string, statedMeasure: string])[] = [
    ['2 cups milk', '2 cups'],
    ['2 cups, sifted flour', '2 cups'],
    ['3 tablespoons, plus 1 tablespoon, butter', '3 tablespoons'],
    ['2 cups; sifted flour', '2 cups'],
    ['1/2 cup flour', '1'],
    ['2-3 cups flour', '2'],
    ['1.5 cups flour', '1'],
];
