/**
 * The nightly stop's starter for the reclaim loop (ADR-0061).
 *
 * ⛔ THE STEP FUNCTIONS CLIENT IS IMPORTED LAZILY, INSIDE `startLoop`. The stop is the cost safety and the reclaim is an
 * improvement on it, so the stop must never fail because of the reclaim. A static import would fail the WHOLE scheduler
 * function at init if the package could not be loaded, and nothing would stop. Imported here, the same failure is one
 * more reclaim error: it is recorded, the stop has already finished, and the run fails afterwards.
 *
 * It sits in its own module so that nothing the stop loads statically names the client.
 *
 * @pattern Proxy — a lazy loader in front of the SDK client
 * @sideEffect Starts a Step Functions execution.
 */
import type { ReclaimApi } from '../../lib/sandbox-scheduler/scheduler.js';

/**
 * The stop's starter for the reclaim loop (ADR-0061).
 *
 * Starts the Standard state machine at iteration 0 under the given execution name. `ExecutionAlreadyExists` is NOT
 * handled here: it passes through, and `runStop` treats it as success. A missing state machine is an error rather
 * than a quiet skip, because a stop that cannot start its reclaim must say so.
 *
 * @param stateMachineArn - The reclaim state machine, from the function's environment.
 * @returns The port.
 */
export function createReclaimStarter(stateMachineArn: string | undefined): ReclaimApi {
    return {
        async startLoop(executionName: string): Promise<void> {
            if (stateMachineArn === undefined || stateMachineArn === '') {
                throw new Error('RECLAIM_STATE_MACHINE_ARN is not set, so the reclaim loop cannot be started');
            }

            const { SFNClient, StartExecutionCommand } = await import('@aws-sdk/client-sfn');

            await new SFNClient({}).send(
                new StartExecutionCommand({
                    stateMachineArn,
                    name: executionName,
                    input: JSON.stringify({ iteration: 0 }),
                }),
            );
        },
    };
}
