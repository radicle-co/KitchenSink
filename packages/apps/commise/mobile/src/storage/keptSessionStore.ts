/**
 * @module mobile/storage — the phone's kept cooking-session store (ADR-0094 sections 3 and 6): AsyncStorage behind the
 * store's port, and one serial queue per lock name as its exclusion, so two writes in the same tick both land.
 *
 * @pattern Adapter — AsyncStorage behind the store's `KeptPort`.
 */
import { createKeptSessionStore, type ExclusiveRunner, type KeptPort } from '@commise/features-recipes/session';
import { createSerialQueue, type SerialQueue } from '@kitchensink/sync';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { reportErrorToSentry } from '../observability/sentryErrorReporter.js';

/** The port over AsyncStorage. There is no external-change subscription: a phone has one process. */
export const nativeKeptPort: KeptPort = {
    read: (key) => AsyncStorage.getItem(key),
    write: async (key, value) => {
        try {
            await AsyncStorage.setItem(key, value);

            return { ok: true };
        } catch (error) {
            return { ok: false, error };
        }
    },
    remove: (key) => AsyncStorage.removeItem(key),
    keys: async (prefix) => (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix)),
};

const queues = new Map<string, SerialQueue>();

/** One serial queue per lock name. */
const runner: ExclusiveRunner = (name, work) => {
    const queue = queues.get(name) ?? createSerialQueue();

    queues.set(name, queue);

    return queue(work);
};

/** The phone's one kept store. A runner always exists here, so `warn` is never called. */
export const nativeKeptSessionStore = createKeptSessionStore({
    port: nativeKeptPort,
    exclusiveOf: () => runner,
    now: () => new Date().toISOString(),
    report: reportErrorToSentry,
    warn: () => undefined,
});
