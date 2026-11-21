/**
 * Whether a change of the signed-in cook ends the session the device kept for the one before (ADR-0057, owner D7 and
 * D18). Clerk reports `undefined` while it loads and `null` only when it holds no user, so a caller drops `undefined`
 * before it asks, and only a change from a cook to `null` or to another cook ends a session.
 *
 * @param held - The cook the data was kept for, or `null` when there was none.
 * @param next - The cook now: an id, or `null` when signed out.
 * @returns `true` when `held` is a cook and `next` is not that same cook. Pure.
 */
export function endsCookSession(held: string | null, next: string | null): boolean {
    return held !== null && held !== next;
}
