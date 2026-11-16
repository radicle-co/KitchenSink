import { createSerialQueue, type SerialQueue } from '@kitchensink/sync';

import type { ExclusiveRunner, KeptPort, WriteOutcome } from '../keptPort.js';

/** A `Map`-backed port that counts its calls. `failWrites` makes every write fail. */
export function makeFakePort(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    const calls = { write: 0, remove: 0 };
    const state = { failWrites: false };
    const listeners = new Set<() => void>();
    const port: KeptPort = {
        read: (key) => Promise.resolve(data.get(key) ?? null),
        write: (key, value): Promise<WriteOutcome> => {
            calls.write += 1;

            if (state.failWrites) {
                return Promise.resolve({ ok: false, error: new Error('QuotaExceededError') });
            }

            data.set(key, value);

            return Promise.resolve({ ok: true });
        },
        remove: (key) => {
            calls.remove += 1;
            data.delete(key);

            return Promise.resolve();
        },
        keys: (prefix) => Promise.resolve([...data.keys()].filter((k) => k.startsWith(prefix))),
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
