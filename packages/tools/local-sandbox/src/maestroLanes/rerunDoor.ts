/**
 * The rerun limit as the door uses it: keys from the platform, the iOS device, the flow, HEAD and the flow file's blob;
 * one line for each refused flow; and the history file, read once after the lanes are planned and written once when
 * they are done. The host lock the door already holds serialises two doors, so a read, a run and a write never
 * interleave.
 *
 * A one-off is keyed by its name alone: its staged folder is named for the run, so a rerun of the same file would
 * otherwise be a new key every time.
 *
 * @pattern Adapter — `createRerunDoor` puts the pure rule of `rerunLimit.ts` behind the two hooks `laneRun.ts` calls
 * @sideEffect Reads the history file in `checkRerun` and writes it in `recordRerun`.
 */
import { ONE_OFF_DIR } from '@kitchensink/e2e-plan/maestroFlows';

import type { FlowOutcome, PlannedFlows } from './laneRun.js';
import { readRerunHistory, writeRerunHistory } from './rerunHistoryStore.js';
import { failuresOf, recordOutcomes, rerunDecision, rerunKey, type RerunHistory } from './rerunLimit.js';

/** What the door knows that the rule does not. */
export interface RerunDoorPorts {
    readonly historyFile: string;
    /** `git rev-parse HEAD` of the tree the door runs from. */
    readonly head: string;
    /** The blob sha of a flow's own YAML file in the working tree. */
    blobOf(flow: string): string;
    readonly iosDevice: string;
    /** `MAESTRO_PROBLEM`: the reference a problem report was filed under. */
    readonly reference?: string;
    /** The time now, ISO 8601. */
    now(): string;
    /** A history file that cannot be used: said once, then read as empty. */
    report(line: string): void;
}

/** The two hooks `laneRun.ts` takes. */
interface RerunDoor {
    checkRerun(planned: readonly PlannedFlows[]): readonly string[];
    recordRerun(outcomes: readonly FlowOutcome[]): void;
}

const ONE_OFF_RUN_FOLDER = new RegExp(`^${ONE_OFF_DIR}/[^/]+/`, 'u');

/** The flow id a key is made from: a one-off without its run folder. */
const keyedFlow = (flow: string): string => flow.replace(ONE_OFF_RUN_FOLDER, `${ONE_OFF_DIR}/`);

/**
 * The door's two hooks over one history file.
 *
 * @param ports - The history file, the git facts, the reference, the clock and where to report.
 * @returns `checkRerun` to refuse before anything starts, and `recordRerun` to count how the lanes ended.
 */
export function createRerunDoor(ports: RerunDoorPorts): RerunDoor {
    // What `checkRerun` decided to keep (it holds the reference that released a flow), for `recordRerun` to build on.
    let kept: RerunHistory | undefined;
    const labels = new Map<string, string>();

    const keyOf = (platform: string, flow: string): string => {
        const key = rerunKey({
            platform,
            device: ports.iosDevice,
            flowId: keyedFlow(flow),
            head: ports.head,
            blob: ports.blobOf(flow),
        });
        labels.set(key, `${flow} (${platform}${platform === 'ios' ? ` ${ports.iosDevice}` : ''})`);

        return key;
    };

    return {
        checkRerun: (planned) => {
            const history = readRerunHistory(ports.historyFile, ports.report);
            const decision = rerunDecision(history, {
                keys: planned.flatMap((plan) => plan.flows.map((flow) => keyOf(plan.platform, flow))),
                now: ports.now(),
                ...(ports.reference === undefined ? {} : { reference: ports.reference }),
            });

            if (decision.allowed) {
                kept = decision.history;

                return [];
            }

            return decision.refused.map(
                (key) =>
                    `refused ${labels.get(key) ?? key} at ${ports.head.slice(0, 7)}: ` +
                    `${String(failuresOf(history, key))} failed runs; file a problem report, then rerun with ` +
                    "MAESTRO_PROBLEM='<reference>'",
            );
        },
        recordRerun: (outcomes) => {
            const base = kept ?? readRerunHistory(ports.historyFile, ports.report);

            writeRerunHistory(
                ports.historyFile,
                recordOutcomes(
                    base,
                    outcomes.map((outcome) => ({ key: keyOf(outcome.platform, outcome.flow), failed: outcome.failed })),
                    ports.now(),
                ),
            );
        },
    };
}
