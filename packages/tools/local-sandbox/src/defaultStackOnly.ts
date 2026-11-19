/**
 * @module defaultStackOnly — the refusal `local:dev` and `dev:local` make for a stack that is not today's.
 *
 * Their host dev servers read each service's `.env.development`, which names the default stack's ports. Started against
 * another stack they would write into that session's data, so these two doors take only the default stack.
 */
import { DEFAULT_PORTS, isInvalidStackPortError, refusalLine, stackFrom, type Stack } from './stackPorts.js';

/** The variable and value that move the stack, as the refusal names them. */
function movedBy(env: Readonly<Record<string, string | undefined>>, stack: Stack): string {
    const port = env['LOCAL_SANDBOX_PORT'];

    return !stack.isDefault && port !== undefined
        ? `LOCAL_SANDBOX_PORT=${port}`
        : `LOCAL_SANDBOX_HOST_PORTS=${env['LOCAL_SANDBOX_HOST_PORTS'] ?? ''}`;
}

/**
 * The refusal, as one R9 line, when the environment names a stack other than the default one. Pure.
 *
 * @param door - The door that refuses: `local:dev` or `dev:local`.
 * @param env - The process environment.
 * @returns The line, or `undefined` when the stack is today's.
 */
export function defaultStackOnlyRefusal(
    door: string,
    env: Readonly<Record<string, string | undefined>>,
): string | undefined {
    let stack: Stack;

    try {
        stack = stackFrom(env);
    } catch (error) {
        if (isInvalidStackPortError(error)) {
            return refusalLine(door, error.refused, error.why, error.fix);
        }

        throw error;
    }

    if (stack.isDefault && DEFAULT_PORTS.every(([service, port]) => stack.hostPort(service, port) === port)) {
        return undefined;
    }

    return refusalLine(
        door,
        movedBy(env, stack),
        "moves the stack, and the host dev servers read .env.development, which names the default stack's ports",
        `Unset LOCAL_SANDBOX_PORT and LOCAL_SANDBOX_HOST_PORTS, then run ${door} again.`,
    );
}
