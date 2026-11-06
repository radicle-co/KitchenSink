import type { ParseJobResponse } from '@kitchensink/schema-recipe';

import { emptyPasteMatchSession, reducePasteMatchSession } from '../pasteMatchSession.js';

/** The session after the job was accepted and its one food joined the draft (only joined foods are drawn). */
export const JOINED_SESSION = [
    { type: 'jobAccepted', jobId: 'job-1' } as const,
    { type: 'lineJoined', key: '0:0', draftKey: 'd-1' } as const,
].reduce(reducePasteMatchSession, emptyPasteMatchSession);

/** A one-line, one-food parse job whose line was pasted as `raw` and states `statedMeasure`. */
export function makePasteJob(raw: string, statedMeasure: string | null): ParseJobResponse {
    return {
        id: 'job-1',
        status: 'complete',
        lines: [
            {
                lineIndex: 0,
                sourceLine: raw,
                status: 'parsed',
                progress: null,
                proposal: {
                    raw,
                    statedMeasure,
                    foods: [{ name: 'flour', prep: null }],
                },
            },
        ],
    } as unknown as ParseJobResponse;
}

/** Pasted lines with their stated measure: the row must show each exactly as the cook pasted it. */
export const PASTED_LINES: readonly (readonly [raw: string, statedMeasure: string])[] = [
    ['2 cups milk', '2 cups'],
    ['2 cups, sifted flour', '2 cups'],
    ['3 tablespoons, plus 1 tablespoon, butter', '3 tablespoons'],
    ['2 cups; sifted flour', '2 cups'],
];
