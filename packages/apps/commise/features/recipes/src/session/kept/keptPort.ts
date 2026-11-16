/**
 * @module The kept store's two seams: the key/value port each app implements, and the exclusion each platform
 * provides (plan 0003 KTD2, KTD5). Types only.
 */

export type WriteOutcome = { readonly ok: true } | { readonly ok: false; readonly error: unknown };

/**
 * One device's key/value storage. Values are strings. `write` never throws: it answers `{ ok: false }`. `read`, `remove`
 * and `keys` MAY throw or reject (blocked web storage throws synchronously): the store reports that once, treats the
 * record as unreadable, keeps the session in memory and writes nothing over what it could not read.
 */
export interface KeptPort {
    read(key: string): Promise<string | null>;
    write(key: string, value: string): Promise<WriteOutcome>;
    remove(key: string): Promise<void>;
    /** Every key starting with `prefix` (R7b removes other users' records). */
    keys(prefix: string): Promise<readonly string[]>;
    /** Web only: storage, pageshow (persisted) and visibilitychange (visible). Returns the unsubscribe. */
    subscribeExternal?(onChange: () => void): () => void;
}

/** Runs `work` exclusively for `name`. */
export type ExclusiveRunner = <T>(name: string, work: () => Promise<T>) => Promise<T>;
