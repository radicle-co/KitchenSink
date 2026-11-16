import { createSerialQueue, type SerialQueue } from '@kitchensink/sync';

import type { ExclusiveRunner, KeptPort, WriteOutcome } from '../keptPort.js';

/**
 * A `Map`-backed port that counts its calls. `failWrites` makes every write report failure. `failReads` makes read,
 * remove and keys THROW SYNCHRONOUSLY, as `localStorage` does when storage is blocked.
 */
export function makeFakePort(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    const calls = { write: 0, remove: 0 };
    const state = { failWrites: false, failReads: false };

    const blocked = (): void => {
        if (state.failReads) {
            throw new Error('SecurityError: storage is blocked');
        }
    };

    const listeners = new Set<() => void>();
    const port: KeptPort = {
        read: (key) => {
            blocked();

            return Promise.resolve(data.get(key) ?? null);
        },
        write: (key, value): Promise<WriteOutcome> => {
            calls.write += 1;

            if (state.failWrites) {
                return Promise.resolve({ ok: false, error: new Error('QuotaExceededError') });
            }

            data.set(key, value);

            return Promise.resolve({ ok: true });
        },
        remove: (key) => {
            blocked();
            calls.remove += 1;
            data.delete(key);

            return Promise.resolve();
        },
        keys: (prefix) => {
            blocked();

            return Promise.resolve([...data.keys()].filter((k) => k.startsWith(prefix)));
        },
        subscribeExternal: (onChange) => {
            listeners.add(onChange);

            return () => listeners.delete(onChange);
        },
    };

    return { port, data, calls, state, fire: () => listeners.forEach((l) => l()) };
}

/** Real exclusion semantics: one serial queue per lock name, shared by every store given this runner. */
export function makeFakeLocks(): ExclusiveRunner {
    const queues = new Map<string, SerialQueue>();

    return (name, work) => {
        const queue = queues.get(name) ?? createSerialQueue();

        queues.set(name, queue);

        return queue(work);
    };
}
