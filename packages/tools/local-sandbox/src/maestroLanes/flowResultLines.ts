/**
 * What the door says about each planned flow when the lanes are done: one line, with a fixed status word, so a flow
 * that did not pass cannot hide behind a lane that exited 0. `grep -E 'FAILED|NO RESULT|skipped'` finds every non-pass.
 *
 * A flow passes only on a recorded `passed`. A flow with no record at all (a lane that stopped quietly) is `NO RESULT`.
 */
import { ONE_OFF_DIR } from '@kitchensink/e2e-plan/maestroFlows';

import type { FlowResult } from '@kitchensink/e2e-plan/recordedScreens';

/** The words a line ends a one-off with when it did not pass: its screenshots show a run that did not finish well. */
const NOT_EVIDENCE = 'screenshots not evidence';

const STATUS: Readonly<Record<FlowResult, string>> = { passed: 'passed', failed: 'FAILED', skipped: 'skipped' };

/** The planned flows once each, in plan order. */
const planned = (flows: readonly string[]): readonly string[] => [...new Set(flows)];

/**
 * The planned flows that have no recorded pass, in plan order, once each. Pure.
 *
 * @param flows - The flows the lanes were given.
 * @param results - Each flow's recorded result.
 * @returns The flows that failed, were skipped or recorded nothing.
 */
export const notPassed = (flows: readonly string[], results: ReadonlyMap<string, FlowResult>): readonly string[] =>
    planned(flows).filter((flow) => results.get(flow) !== 'passed');

/**
 * One line per planned flow: `<platform> <flow>: passed|FAILED|skipped|NO RESULT`. A one-off flow that did not pass also
 * says its screenshots are not evidence. Pure.
 *
 * @param input - The platform, the flows its lanes were given, and each flow's recorded result.
 * @returns The lines, in plan order.
 */
export function flowResultLines(input: {
    readonly platform: string;
    readonly flows: readonly string[];
    readonly results: ReadonlyMap<string, FlowResult>;
}): readonly string[] {
    return planned(input.flows).map((flow) => {
        const result = input.results.get(flow);
        const status = result === undefined ? 'NO RESULT' : STATUS[result];
        const mark = result !== 'passed' && flow.startsWith(`${ONE_OFF_DIR}/`) ? `, ${NOT_EVIDENCE}` : '';

        return `${input.platform} ${flow}: ${status}${mark}`;
    });
}
