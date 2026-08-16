/**
 * Test stub for `expo-keep-awake`.
 *
 * The real module bridges to an OS keep-awake service that has no jsdom runtime. The stub records
 * every call with its tag so the native adapter's acquire/release contract stays falsifiable under
 * component tests — a stub that silently succeeded would let a broken adapter pass. Whether the screen
 * genuinely stays awake is a device / Maestro concern.
 */

/** One recorded call against the stub. */
export interface KeepAwakeCall {
    readonly kind: 'activate' | 'deactivate';
    readonly tag: string | undefined;
}

const calls: KeepAwakeCall[] = [];

/** Returns every call recorded so far, in order. */
export function getKeepAwakeCalls(): readonly KeepAwakeCall[] {
    return calls;
}

/** Clears the recorded calls. Call in `beforeEach`. */
export function resetKeepAwakeCalls(): void {
    calls.length = 0;
}

/** Stubbed counterpart of the real `activateKeepAwakeAsync`. */
export async function activateKeepAwakeAsync(tag?: string): Promise<void> {
    calls.push({ kind: 'activate', tag });
}

/** Stubbed counterpart of the real `deactivateKeepAwake`. */
export function deactivateKeepAwake(tag?: string): void {
    calls.push({ kind: 'deactivate', tag });
}

/** Stubbed counterpart of the real `isAvailableAsync`. */
export async function isAvailableAsync(): Promise<boolean> {
    return true;
}
