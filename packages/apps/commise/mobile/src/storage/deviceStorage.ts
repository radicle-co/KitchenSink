/**
 * @module mobile/storage — the phone's one device storage: AsyncStorage behind the `KeptPort`, and one serial queue
 * per lock name as the exclusion, so two writes in the same tick both land. It holds no record of its own.
 *
 * @pattern Adapter — AsyncStorage behind the `KeptPort`.
 */
import type { ExclusiveRunner, KeptPort } from '@commise/features-recipes/session';
import { createSerialQueue, type SerialQueue } from '@kitchensink/sync';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

/** One serial queue per lock name. Shared by every record that writes this device's storage with a read first. */
export const nativeExclusiveRunner: ExclusiveRunner = (name, work) => {
    const queue = queues.get(name) ?? createSerialQueue();

    queues.set(name, queue);

    return queue(work);
};
