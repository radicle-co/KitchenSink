/**
 * The body of `GET /api/v1/foods/search/progressive`, read into typed frames (ADR-0055 point 9; staff-architect review
 * ruling 1). The body is newline-delimited JSON, so it is split on the newline BYTE, and each line is decoded and parsed
 * with the food schema's own line schema (`progressiveSearchLineSchema`), which says how a frame type or an outcome this
 * client does not know is read. On top of it:
 *
 * - a `busy` or `limited` frame's seconds become the time they end, read from the clock when the frame arrives, as
 *   every other `retryAfterSeconds` is read where it is received;
 * - a line that is not a frame (not JSON, or the cut-off tail of a body that ended mid-frame), or that the line schema
 *   reads as nothing, is dropped.
 *
 * Hand-rolled, for a stated reason: no maintained NDJSON reader takes a WHATWG byte stream on both Hermes and the
 * browser, and the split is a few lines. The newline byte never occurs inside a multi-byte UTF-8 sequence, so each line
 * is decoded whole and no decoder state crosses a chunk.
 *
 * @pattern Parser at the boundary — each line becomes one typed frame, or nothing
 */
import {
    progressiveSearchLineSchema,
    type CompleteFrame,
    type DatabaseFrame,
    type SourceFrame,
} from '@kitchensink/schema-food';

import { jsonOf } from './jsonOf.js';

/** The byte every frame ends with. */
const NEWLINE = 0x0a;

/** A source frame whose wait has been turned into the time it ends. */
type TimedSourceFrame<Outcome extends 'busy' | 'limited'> = Omit<
    Extract<SourceFrame, { outcome: Outcome }>,
    'retryAfterSeconds'
> & {
    /** When the wait ends, in epoch milliseconds: the frame's arrival plus its `retryAfterSeconds`. */
    readonly retryAt: number;
};

/** One remote source's frame, as the client reads it. */
export type ProgressiveSourceFrame =
    | Extract<SourceFrame, { outcome: 'answered' | 'unavailable' }>
    | TimedSourceFrame<'busy'>
    | TimedSourceFrame<'limited'>;

/** One frame of the progressive search, as the client reads it. */
export type ProgressiveFrame = DatabaseFrame | ProgressiveSourceFrame | CompleteFrame;

/**
 * A source frame as the client reads it: a wait becomes the time it ends. Pure.
 *
 * @param frame - The frame.
 * @param receivedAt - When it arrived, in epoch milliseconds.
 * @returns The frame.
 */
function timedSourceFrameOf(frame: SourceFrame, receivedAt: number): ProgressiveSourceFrame {
    switch (frame.outcome) {
        case 'answered':
        case 'unavailable':
            return frame;
        case 'busy':
        case 'limited':
            return {
                type: 'source',
                source: frame.source,
                outcome: frame.outcome,
                retryAt: receivedAt + frame.retryAfterSeconds * 1_000,
            };

        default: {
            const unhandled: never = frame;

            return unhandled;
        }
    }
}

/**
 * One line as a frame, or `undefined` for a line that is not one. Pure.
 *
 * @param line - One decoded line of the body.
 * @param receivedAt - When the line arrived, in epoch milliseconds.
 * @returns The frame.
 */
function frameOf(line: string, receivedAt: number): ProgressiveFrame | undefined {
    const parsed = progressiveSearchLineSchema.safeParse(jsonOf(line));

    if (!parsed.success || parsed.data === null) {
        return undefined;
    }

    const frame = parsed.data;

    switch (frame.type) {
        case 'database':
        case 'complete':
            return frame;
        case 'source':
            return timedSourceFrameOf(frame, receivedAt);

        default: {
            const unhandled: never = frame;

            return unhandled;
        }
    }
}

/** `head` followed by `tail`, copied only when there is a head. Pure. */
function joined(head: Uint8Array, tail: Uint8Array): Uint8Array {
    if (head.length === 0) {
        return tail;
    }

    const bytes = new Uint8Array(head.length + tail.length);

    bytes.set(head);
    bytes.set(tail, head.length);

    return bytes;
}

/**
 * The body's lines, each decoded whole. A last line with no newline is yielded too: it is either a whole frame or the
 * cut-off tail of a body that ended mid-frame, which {@link frameOf} drops. A line that is not UTF-8 is dropped.
 */
async function* linesOf(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let pending = new Uint8Array(0);

    const decoded = (bytes: Uint8Array): string | undefined => {
        try {
            return decoder.decode(bytes);
        } catch {
            return undefined;
        }
    };

    for await (const chunk of chunks) {
        const bytes = joined(pending, chunk);
        let start = 0;
        let end = bytes.indexOf(NEWLINE, start);

        while (end !== -1) {
            const line = decoded(bytes.subarray(start, end));

            if (line !== undefined && line.trim() !== '') {
                yield line;
            }

            start = end + 1;
            end = bytes.indexOf(NEWLINE, start);
        }

        pending = bytes.slice(start);
    }

    const last = decoded(pending);

    if (last !== undefined && last.trim() !== '') {
        yield last;
    }
}

/**
 * The frames of a progressive search body, in the order they arrive.
 *
 * @param chunks - The body's bytes, as the transport hands them over.
 * @param clock - Reads the time, once per frame, when the frame arrives.
 * @returns The frames; the lines that are not frames are dropped.
 */
export async function* progressiveFramesOf(
    chunks: AsyncIterable<Uint8Array>,
    clock: () => number,
): AsyncGenerator<ProgressiveFrame> {
    for await (const line of linesOf(chunks)) {
        const frame = frameOf(line, clock());

        if (frame !== undefined) {
            yield frame;
        }
    }
}
