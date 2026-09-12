/**
 * A call-ledger double that keeps the contract `SourceCallLogDao.admit` states (`AdmitInput`): a call is recorded only
 * while every lane's calls inside the trailing window are under `ceiling` AND the caller's own lane's calls are under
 * `laneCeiling`. It lets a suite drive the real `RollingWindowLimiter` without a database; the real ledger's atomicity
 * under concurrency is the LOCAL e2e tier's (`tests/e2e/sourceAdmission.e2e.test.ts`).
 */
import type { SourceCallChannel } from '../../src/sources/transport/transportPorts.js';
import type { AdmitInput } from '../../src/foods/dao/sourceCallLog.dao.js';
import type { WindowLedger } from '../../src/sources/RollingWindowLimiter.js';

/** One call the ledger holds: the lane that spent it and when, epoch milliseconds. */
export interface LedgerCall {
    readonly lane: SourceCallChannel;
    readonly at: number;
}

/** A clock a suite moves by hand, epoch milliseconds. */
export interface TestClock {
    now: number;
}

/**
 * The calls inside a trailing window. Pure.
 *
 * @param calls - The ledger's calls.
 * @param clock - The ledger's clock.
 * @param windowSeconds - The window.
 * @returns The calls inside it.
 */
function inWindowOf(calls: readonly LedgerCall[], clock: TestClock, windowSeconds: number): LedgerCall[] {
    return calls.filter((call) => call.at > clock.now - windowSeconds * 1000);
}

/**
 * Whether the window leaves room for one more call on the input's lane, as `AdmitInput` states the rule. Pure.
 *
 * @param calls - The ledger's calls.
 * @param clock - The ledger's clock.
 * @param input - The admission.
 * @returns True while both counts are under their ceilings.
 */
function underCeilings(calls: readonly LedgerCall[], clock: TestClock, input: AdmitInput): boolean {
    const inWindow = inWindowOf(calls, clock, input.windowSeconds);
    const own = inWindow.filter((call) => call.lane === input.lane);

    return inWindow.length < input.ceiling && own.length < input.laneCeiling;
}

/**
 * Build the ledger over `calls`, appending each call it admits.
 *
 * @param calls - The calls already in the ledger.
 * @param clock - The ledger's clock.
 * @returns The ledger.
 */
export function countingLedger(calls: LedgerCall[], clock: TestClock): WindowLedger {
    return {
        admit: async (input) => {
            if (!underCeilings(calls, clock, input)) {
                return { admitted: false, reason: 'ceiling', retryAt: new Date(clock.now).toISOString() };
            }

            calls.push({ lane: input.lane, at: clock.now });

            return { admitted: true };
        },
        windowStatus: async (input) => {
            const inWindow = inWindowOf(calls, clock, input.windowSeconds);

            return {
                byLane: {
                    interactive: inWindow.filter((call) => call.lane === 'interactive').length,
                    worker: inWindow.filter((call) => call.lane === 'worker').length,
                },
                paused: !underCeilings(calls, clock, input),
            };
        },
        pruneAged: async () => 0,
    };
}

/**
 * `count` calls on `lane`, each `ageSeconds` before the clock.
 *
 * @param count - How many calls.
 * @param lane - The lane that spent them.
 * @param clock - The clock they are dated against.
 * @param ageSeconds - How old each one is.
 * @returns The calls.
 */
export function callsOn(count: number, lane: SourceCallChannel, clock: TestClock, ageSeconds = 1): LedgerCall[] {
    return Array.from({ length: count }, () => ({ lane, at: clock.now - ageSeconds * 1000 }));
}
