/**
 * The memory the machine could give the lanes now: the one reader, for every door.
 *
 * `os.freemem()` is right on Linux (libuv reads `MemAvailable`) and on Windows. On macOS it counts only never-used pages,
 * and `vm_stat`'s free, inactive and speculative pages undercount by about half on a loaded Mac, so a planner on either
 * plans too few lanes or, worse, trusts a figure it cannot explain. There the kernel's own `memory_pressure` percentage is
 * the source, and a margin of it is counted: that figure includes pages the kernel reclaims only under pressure.
 *
 * A read that fails is an error. Falling back to `os.freemem()` would plan lanes on the figure known to be wrong.
 */
import { execFileSync } from 'node:child_process';
import { freemem, totalmem } from 'node:os';

/** The share of the kernel's free percentage the planner counts. */
export const MEMORY_SAFETY_MARGIN = 0.8;

/** Raised when macOS memory cannot be read, so no lane count can be planned. */
export class MemoryReadError extends Error {
    public constructor(detail: string) {
        super(`error: cannot read the free memory of this Mac from memory_pressure (${detail}); no lanes are planned`);
        this.name = 'MemoryReadError';
        Object.setPrototypeOf(this, MemoryReadError.prototype);
    }
}

/**
 * Type guard for {@link MemoryReadError}.
 *
 * @param error - Any thrown value.
 * @returns Whether it is a {@link MemoryReadError}.
 */
export function isMemoryReadError(error: unknown): error is MemoryReadError {
    return error instanceof MemoryReadError;
}

/**
 * The system-wide free percentage out of `memory_pressure` output.
 *
 * @param text - What `memory_pressure` printed.
 * @returns A number from 0 to 100.
 * @throws {MemoryReadError} When the line is missing or the number is out of range.
 */
export function parseFreePercent(text: string): number {
    const found = /System-wide memory free percentage:\s*(\d+)%/u.exec(text)?.[1];

    if (found === undefined) {
        throw new MemoryReadError('the output has no "System-wide memory free percentage" line');
    }

    const percent = Number(found);

    if (percent > 100) {
        throw new MemoryReadError(`the free percentage is ${percent}%`);
    }

    return percent;
}

/**
 * Bytes the planner may count out of a free percentage.
 *
 * @param memsize - The machine's memory in bytes.
 * @param freePercent - From {@link parseFreePercent}.
 * @returns Bytes, with the safety margin applied.
 */
export const bytesFromFreePercent = (memsize: number, freePercent: number): number =>
    Math.floor(memsize * (freePercent / 100) * MEMORY_SAFETY_MARGIN);

export interface MemorySources {
    readonly platform: NodeJS.Platform;
    readonly freemem: () => number;
    readonly totalmem: () => number;
    readonly memoryPressure: () => string;
}

const realSources = (): MemorySources => ({
    platform: process.platform,
    freemem,
    totalmem,
    memoryPressure: () => execFileSync('memory_pressure', { encoding: 'utf8' }),
});

/**
 * Memory the machine could give the lanes now.
 *
 * @sideEffect Runs `memory_pressure` on macOS.
 * @param sources - Injected for tests; the real ones by default.
 * @returns Bytes.
 * @throws {MemoryReadError} On macOS, when `memory_pressure` fails or prints something unexpected.
 */
export function availableMemoryBytes(sources: MemorySources = realSources()): number {
    if (sources.platform !== 'darwin') {
        return sources.freemem();
    }

    let output: string;

    try {
        output = sources.memoryPressure();
    } catch (error) {
        throw new MemoryReadError(error instanceof Error ? error.message : String(error));
    }

    return bytesFromFreePercent(sources.totalmem(), parseFreePercent(output));
}
