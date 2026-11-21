import type { ExclusiveRunner, KeptPort, WriteOutcome } from '@commise/features-recipes/session';

/** A port a test can break: `failReads` makes read, remove and keys reject; `failWrites` makes write answer `{ ok: false }`. */
export interface MemoryKeptPort {
    readonly port: KeptPort;
    /** The stored strings, by key, for a test to seed and to inspect. */
    readonly data: Map<string, string>;
    readonly state: { failReads: boolean; failWrites: boolean };
    readonly calls: { write: number; remove: number };
}

/**
 * A `Map`-backed device storage port.
 *
 * @param initial - Keys and raw values already stored.
 * @returns The port and the handles a test uses to seed, break and inspect it. Pure but for the map it owns.
 */
export function makeMemoryKeptPort(initial: Record<string, string> = {}): MemoryKeptPort {
    const data = new Map(Object.entries(initial));
    const state = { failReads: false, failWrites: false };
    const calls = { write: 0, remove: 0 };
    const blocked = (): Promise<never> => Promise.reject(new Error('SecurityError: storage is blocked'));

    const port: KeptPort = {
        read: (key) => (state.failReads ? blocked() : Promise.resolve(data.get(key) ?? null)),
        write: (key, value): Promise<WriteOutcome> => {
            calls.write += 1;

            if (state.failWrites) {
                return Promise.resolve({ ok: false, error: new Error('QuotaExceededError') });
            }

            data.set(key, value);

            return Promise.resolve({ ok: true });
        },
        remove: (key) => {
            if (state.failReads) {
                return blocked();
            }

            calls.remove += 1;
            data.delete(key);

            return Promise.resolve();
        },
        keys: (prefix) =>
            state.failReads ? blocked() : Promise.resolve([...data.keys()].filter((key) => key.startsWith(prefix))),
    };

    return { port, data, state, calls };
}

/**
 * Real exclusion: one promise chain per lock name, as the phone's serial queue gives. Two writes begun in the same tick
 * run one after the other.
 *
 * @returns A runner. Not pure: it holds the chains.
 */
export function makeSerialRunner(): ExclusiveRunner {
    const tails = new Map<string, Promise<unknown>>();

    return <T>(name: string, work: () => Promise<T>): Promise<T> => {
        const run = (tails.get(name) ?? Promise.resolve()).then(work, work);

        tails.set(
            name,
            run.catch(() => undefined),
        );

        return run;
    };
}
