/**
 * Test stub for `expo-keep-awake`.
 *
 * The real module bridges to an OS keep-awake service that has no jsdom runtime, and the cooking feature's
 * native wake-lock adapter (`@commise/features-cooking`'s `wakeLock.native.ts`) reaches for it as soon as a
 * session opens — so every screen test that mounts Cooking Mode pulls it into the graph. Same approach as
 * the `expo-image` / `expo-blur` stubs beside it.
 *
 * Calls are RECORDED rather than silently succeeding, so a test can assert that mounting the screen actually
 * acquires the lock (FR-035) and that leaving it releases the same tag. A stub that only returned would let
 * a broken adapter pass. Whether the device screen genuinely stays lit is a device / Maestro concern.
 *
 * Mirrors `packages/apps/commise/features/cooking/src/__tests__/expoKeepAwakeStub.ts` — the feature package
 * owns the adapter's own contract tests; this copy exists because Vitest aliases are per-config and the two
 * packages' suites do not share one. The recorded shape is deliberately identical so a reader of either
 * suite sees the same thing.
 */

/** One recorded call against the stub. */
export interface KeepAwakeCall {
    /** Which side of the lock was exercised. */
    readonly kind: 'activate' | 'deactivate';
    /** The tag the caller scoped the lock to, when it supplied one. */
    readonly tag: string | undefined;
}

const calls: KeepAwakeCall[] = [];

/**
 * Every call recorded so far, in order.
 *
 * @returns The recorded calls.
 */
export function getKeepAwakeCalls(): readonly KeepAwakeCall[] {
    return calls;
}

/**
 * Clear the recorded calls. Call in `beforeEach`.
 *
 * @sideEffect Empties the module-level recording.
 */
export function resetKeepAwakeCalls(): void {
    calls.length = 0;
}

/**
 * Stubbed counterpart of the real `activateKeepAwakeAsync`.
 *
 * @param tag - Tag scoping the lock.
 * @sideEffect Records the call.
 */
export async function activateKeepAwakeAsync(tag?: string): Promise<void> {
    calls.push({ kind: 'activate', tag });
}

/**
 * Stubbed counterpart of the real `deactivateKeepAwake`.
 *
 * @param tag - Tag scoping the lock.
 * @sideEffect Records the call.
 */
export function deactivateKeepAwake(tag?: string): void {
    calls.push({ kind: 'deactivate', tag });
}

/**
 * Stubbed counterpart of the real `isAvailableAsync`.
 *
 * @returns Always `true` — availability is a device concern.
 */
export async function isAvailableAsync(): Promise<boolean> {
    return true;
}
