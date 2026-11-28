/**
 * The rewrite seam's contract suite (heldPublicSave U2, "Rewrite seam contract"). A shared `describe` that takes an
 * adapter factory: P10 runs it against the stub and a fake, and P4b runs it unedited against its adapter (a later
 * edit is a qse TEST-CHANGE). The factory receives ALL its I/O as injected doubles, so the suite can assert that no
 * mutating call was made.
 */
import type { SaveRefusalCause } from '@kitchensink/recipe-core/recipe-state';
import { describe, expect, it } from 'vitest';

import {
    parseRewriteWayAnswer,
    rewriteWayRawSchema,
    type BlockCause,
    type RewriteWayInput,
    type RewriteWayPort,
} from '../rewriteWay.js';

/** The I/O an adapter may read through; every write method records its call. */
export interface RewriteWayIo {
    readonly client: {
        readonly read: (path: string) => Promise<unknown>;
        readonly write: (path: string) => Promise<void>;
    };
    readonly storage: {
        readonly get: (key: string) => Promise<undefined>;
        readonly set: (key: string) => Promise<void>;
    };
    readonly queryCache: { readonly get: (key: string) => undefined; readonly set: (key: string) => void };
}

/** Builds the doubles and the list of mutating calls they record. */
function makeRecordingIo(): { readonly io: RewriteWayIo; readonly mutatingCalls: string[] } {
    const mutatingCalls: string[] = [];
    const io: RewriteWayIo = {
        client: {
            read: () => Promise.resolve(undefined),
            write: (path) => {
                mutatingCalls.push(`client.write ${path}`);

                return Promise.resolve();
            },
        },
        storage: {
            get: () => Promise.resolve(undefined),
            set: (key) => {
                mutatingCalls.push(`storage.set ${key}`);

                return Promise.resolve();
            },
        },
        queryCache: {
            get: () => undefined,
            set: (key) => {
                mutatingCalls.push(`queryCache.set ${key}`);
            },
        },
    };

    return { io, mutatingCalls };
}

/** Every refusal cause. A `Record` keyed by the type makes a new cause a compile error here, not a silent gap. */
const CAUSE_BY_KIND: Record<SaveRefusalCause, BlockCause> = {
    heldSource: { kind: 'heldSource' },
    tooClose: { kind: 'tooClose' },
    notApproved: { kind: 'notApproved' },
    sourceCorrected: { kind: 'sourceCorrected' },
};

export const CAUSES: readonly BlockCause[] = Object.values(CAUSE_BY_KIND);

/** One blocked input per door and cause kind. */
export const BLOCKED_INPUTS: readonly RewriteWayInput[] = CAUSES.flatMap((cause) =>
    (['save', 'publish'] as const).map((door) => ({ recipeId: 'rcp_1', door, cause })),
);

/**
 * @param name what is under test.
 * @param expected what the adapter must answer for one blocked input (a real adapter answers per cause).
 * @param makeAdapter builds the adapter from the recording doubles.
 */
export function describeRewriteWayContract(
    name: string,
    expected: (input: RewriteWayInput) => 'unavailable' | 'available',
    makeAdapter: (io: RewriteWayIo) => RewriteWayPort,
): void {
    describe(`rewrite way contract: ${name}`, () => {
        it.each(BLOCKED_INPUTS.map((input) => [`${input.door}/${input.cause.kind}`, input] as const))(
            'answers %s as expected',
            async (_label, input) => {
                const answer = await makeAdapter(makeRecordingIo().io).answer(input, new AbortController().signal);
                expect(parseRewriteWayAnswer(answer).kind).toBe(expected(input));
            },
        );

        it('rule 1: writes nothing through any injected double', async () => {
            const { io, mutatingCalls } = makeRecordingIo();
            const adapter = makeAdapter(io);

            for (const input of BLOCKED_INPUTS) {
                await adapter.answer(input, new AbortController().signal);
            }

            expect(mutatingCalls).toEqual([]);
        });

        it('rule 2: the same input gives the same answer in one session', async () => {
            const adapter = makeAdapter(makeRecordingIo().io);

            for (const input of BLOCKED_INPUTS) {
                const first = await adapter.answer(input, new AbortController().signal);
                const second = await adapter.answer(input, new AbortController().signal);
                expect(second).toEqual(first);
            }
        });

        it('rule 3: an answer is inside the raw shape, line key from the closed set', async () => {
            const adapter = makeAdapter(makeRecordingIo().io);

            for (const input of BLOCKED_INPUTS) {
                const answer = await adapter.answer(input, new AbortController().signal);
                expect(rewriteWayRawSchema.safeParse(answer).success).toBe(true);
            }
        });
    });
}
