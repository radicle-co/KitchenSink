/**
 * A secret read once for the life of the process: in a Lambda function, once per container. Callers that arrive
 * while the read is in flight share it, and a read that fails is forgotten, so the next request reads again.
 *
 * A container therefore keeps the value it read until Lambda retires it, which is how food-service's tasks hold the
 * same key (ECS injects it at task start).
 *
 * @pattern Proxy — a caching proxy over a {@link SecretReader}
 * @module
 */
import type { SecretReader } from './secretPorts.js';

/**
 * Wrap a reader in a per-process cache.
 *
 * @param reader - The reader that reaches the store.
 * @returns A reader that asks `reader` once per secret id until a read fails.
 */
export function cachingSecretReader(reader: SecretReader): SecretReader {
    const reads = new Map<string, Promise<string>>();

    return (secretId) => {
        const cached = reads.get(secretId);

        if (cached !== undefined) {
            return cached;
        }

        const read = reader(secretId);

        reads.set(secretId, read);
        read.catch(() => {
            // The caller receives this failure from `read` itself; here it only stops the failure being reused.
            if (reads.get(secretId) === read) {
                reads.delete(secretId);
            }
        });

        return read;
    };
}
