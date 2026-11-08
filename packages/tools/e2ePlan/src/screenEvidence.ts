/**
 * What a Maestro run observed, written by the screen recorder and read by the narrowing script.
 *
 * One JSON report per platform. It is the contract between the two: the recorder used to print English sentences and the
 * script parsed them back, so a rewording would have silently emptied the evidence. A reader here refuses anything that
 * is not the shape.
 */
import { z } from 'zod';

import type { ScreenCheck, FlowResult } from './screenCheck.js';
import type { Evidence } from './narrowFlowRows.js';

const flowEvidence = z.object({
    flow: z.string().min(1),
    result: z.enum(['passed', 'failed', 'skipped']),
    /** Screens the flow's row names that the flow did not show. */
    wider: z.array(z.string()),
    /** Screens the flow showed that its row lacks. */
    added: z.array(z.string()),
});

const evidenceSchema = z.object({
    version: z.literal(1),
    platform: z.string().min(1),
    flows: z.array(flowEvidence),
});

export type ScreenEvidence = z.infer<typeof evidenceSchema>;

/**
 * Builds one platform's report from its check and its flows' results.
 *
 * @param platform - The platform the records came from.
 * @param check - The recorder's check of that platform.
 * @param results - Each flow's recorded result.
 * @returns The report, flows in the order of their ids.
 */
export function screenEvidence(
    platform: string,
    check: ScreenCheck,
    results: ReadonlyMap<string, FlowResult>,
): ScreenEvidence {
    return {
        version: 1,
        platform,
        flows: [...results.keys()]
            .sort((a, b) => a.localeCompare(b))
            .map((flow) => ({
                flow,
                result: results.get(flow) ?? 'skipped',
                wider: [...(check.wider.find((row) => row.flow === flow)?.screens ?? [])],
                added: [...(check.missing.find((row) => row.flow === flow)?.screens ?? [])],
            })),
    };
}

/**
 * Reads a report.
 *
 * @param text - The file's text.
 * @param label - The file's name, for the error.
 * @returns The report.
 * @throws When the text is not a report: a reader that guessed would read damage as "nothing to narrow".
 */
export function parseScreenEvidence(text: string, label: string): ScreenEvidence {
    try {
        return evidenceSchema.parse(JSON.parse(text));
    } catch (error) {
        throw new Error(
            `error: ${label} is not a screen report (${error instanceof Error ? error.message : 'unreadable'})`,
            {
                cause: error,
            },
        );
    }
}

/**
 * A report as the narrowing reads it: per flow, its result and the two screen sets.
 *
 * @param report - A parsed report.
 * @returns Flow id to what the run said about it.
 */
export function evidenceOf(report: ScreenEvidence): Evidence {
    return new Map(
        report.flows.map(
            (entry) =>
                [
                    entry.flow,
                    { result: entry.result, wider: new Set(entry.wider), added: new Set(entry.added) },
                ] as const,
        ),
    );
}
