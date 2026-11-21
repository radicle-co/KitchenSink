import { createKeptSessionStore, type KeptPort, type KeptSessionStore } from '@commise/features-recipes/session';

/**
 * The real kept store over an in-memory port, for a test that mounts the timer provider.
 *
 * @returns The store and the map its port writes to.
 */
export function makeKeptStore(): { readonly kept: KeptSessionStore; readonly data: Map<string, string> } {
    const data = new Map<string, string>();
    const port: KeptPort = {
        read: (key) => Promise.resolve(data.get(key) ?? null),
        write: (key, value) => {
            data.set(key, value);

            return Promise.resolve({ ok: true });
        },
        remove: (key) => {
            data.delete(key);

            return Promise.resolve();
        },
        keys: (prefix) => Promise.resolve([...data.keys()].filter((k) => k.startsWith(prefix))),
    };
    const kept = createKeptSessionStore({
        port,
        exclusiveOf: () => (_name, work) => work(),
        now: () => new Date(Date.now()).toISOString(),
        report: () => undefined,
        warn: () => undefined,
    });

    return { kept, data };
}
