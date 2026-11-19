/**
 * @module dockerReadError — a failed Docker or `ss` read, and the refusal it becomes.
 *
 * The answer to a failed read is a refusal: it is never "nothing is there".
 */
import { refusalLine } from './stackPorts.js';

/** A Docker read that failed. The answer to a failed read is a refusal: it is never "nothing is there". */
export class DockerReadError extends Error {
    /** The command that failed, for example `docker ps -a`. */
    readonly command: string;
    /** What Docker said, trimmed. */
    readonly detail: string;

    public constructor(command: string, detail: string) {
        super(`${command} failed (${detail})`);
        this.name = 'DockerReadError';
        this.command = command;
        this.detail = detail;
        Object.setPrototypeOf(this, DockerReadError.prototype);
    }
}

/** Whether a value is a {@link DockerReadError}. */
export function isDockerReadError(value: unknown): value is DockerReadError {
    return value instanceof DockerReadError;
}

/**
 * The refusal line for a failed Docker read. Pure.
 *
 * @param door - The door that refuses.
 * @param error - The failed read.
 * @returns One R9 line.
 */
export function dockerReadRefusal(door: string, error: DockerReadError): string {
    return refusalLine(
        door,
        error.command,
        `failed (${error.detail})`,
        `Start Docker, or fix it, then run ${door} again.`,
    );
}
