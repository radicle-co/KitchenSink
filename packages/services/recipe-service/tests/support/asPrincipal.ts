/**
 * Run `fn` authenticated as `userId` against an ALREADY-BOOTED app, then restore whatever dev-bypass
 * identity was active before.
 *
 * The dev bypass reads `RECIPE_DEV_AUTH_USER_ID` fresh on every request, so flipping it between SEQUENTIAL
 * requests is the established way to exercise two identities against one booted app (the pattern
 * `throttle.e2e.test.ts` introduced for its per-user rate-limit proof). ⚠️ It is process-global: never flip
 * it around CONCURRENT requests, and never around a request whose response is still in flight.
 *
 * Lives here — one definition — because a second and third copy had already appeared in the specs that
 * needed two principals, and a divergent restore (or a missing `finally`) leaks the flipped identity into
 * every later test in the file.
 *
 * @param userId - The app-user ULID to authenticate as for the duration of `fn`.
 * @param fn - The work to run under that identity.
 * @returns Whatever `fn` resolves to.
 * @sideEffect Temporarily mutates `process.env['RECIPE_DEV_AUTH_USER_ID']`.
 */
export async function asPrincipal<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const previous = process.env['RECIPE_DEV_AUTH_USER_ID'];
    process.env['RECIPE_DEV_AUTH_USER_ID'] = userId;

    try {
        return await fn();
    } finally {
        if (previous === undefined) {
            delete process.env['RECIPE_DEV_AUTH_USER_ID'];
        } else {
            process.env['RECIPE_DEV_AUTH_USER_ID'] = previous;
        }
    }
}
