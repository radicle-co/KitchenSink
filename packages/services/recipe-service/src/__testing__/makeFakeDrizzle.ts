/**
 * T2 (CP-9) — shared fake-Drizzle test builder.
 *
 * Every DAL unit-test suite in this service previously hand-rolled its own chainable, awaitable stand-in
 * for a Drizzle ORM client (one per file, ~8 near-identical copies). {@link makeFakeDrizzle} models that
 * shape ONCE: a single `Proxy` where EVERY property access — `select`, `insert`, `.from`, `.where`,
 * `.orderBy`, `.onConflictDoNothing`, `.innerJoin`, `.for`, or any other builder method a DAL happens to
 * call — returns a function that records `{ method, args }` and hands back the same fake, so an arbitrary
 * chain composes without a per-consumer method allow-list. `await`ing any chain link shifts the next
 * queued result off a FIFO queue ({@link FakeDrizzle.enqueue}), mirroring how a real Drizzle query builder
 * is itself thenable.
 *
 * `execute(...)` and `transaction(callback)` are the two calls DAL code treats specially (a raw
 * advisory-lock / isolation-level statement, and unit-of-work enlistment), so they get fixed,
 * queue-independent defaults instead of falling through the generic chain path:
 *   - `execute` always resolves `{ rows: [] }` — DALs only use it for its side effect, never its return
 *     value, so a constant keeps it from perturbing the ordered `enqueue` reads a chain's `.then()` shifts.
 *   - `transaction` invokes its callback with the fake itself, so writes issued inside a transaction land
 *     in the SAME recorded `calls` as writes outside one — proving pass-through the way the real
 *     `db.transaction((tx) => ...)` does.
 */

/** A single recorded builder-chain invocation. */
export interface RecordedCall {
    readonly method: string;
    readonly args: readonly unknown[];
}

export interface FakeDrizzle<TDb> {
    /**
     * The fake client, pre-cast to the caller's Drizzle db type (e.g. `RecipeDrizzle`).
     *
     * The fake has no structural relationship to Drizzle's generated types — it is a `Proxy` over a bare
     * function — so the cast is genuinely unsafe at the type level. Centralizing it here (one `unknown`
     * bridge, in this file only) means individual test suites no longer each carry their own
     * `as unknown as RecipeDrizzle`.
     */
    readonly db: TDb;
    /** Every builder call made against the fake, in invocation order. */
    readonly calls: readonly RecordedCall[];
    /** Queue one or more results; each awaited chain link shifts the next one off the FIFO queue. */
    enqueue: (...results: unknown[]) => void;
}

/** Build a chainable, awaitable fake Drizzle client for DAL unit tests. */
export function makeFakeDrizzle<TDb>(): FakeDrizzle<TDb> {
    const calls: RecordedCall[] = [];
    const results: unknown[] = [];

    const handler: ProxyHandler<() => void> = {
        get(_target, prop) {
            if (prop === 'then') {
                return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown): unknown =>
                    Promise.resolve(results.shift()).then(resolve, reject);
            }

            if (prop === 'execute') {
                return (...args: unknown[]): Promise<{ rows: unknown[] }> => {
                    calls.push({ method: 'execute', args });

                    return Promise.resolve({ rows: [] });
                };
            }

            if (prop === 'transaction') {
                return (callback: (tx: TDb) => unknown): unknown => callback(proxy as unknown as TDb);
            }

            return (...args: unknown[]): unknown => {
                calls.push({ method: String(prop), args });

                return proxy;
            };
        },
    };

    const proxy = new Proxy((() => undefined) as () => void, handler);

    return {
        db: proxy as unknown as TDb,
        calls,
        enqueue: (...toQueue: unknown[]): void => {
            results.push(...toQueue);
        },
    };
}

/** Names of the builder methods invoked against a fake, in call order — for asserting a chain's shape. */
export function methodsOf(fake: Pick<FakeDrizzle<unknown>, 'calls'>): string[] {
    return fake.calls.map((call) => call.method);
}
