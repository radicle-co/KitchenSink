/**
 * @module @commise/ui/testing/expo-keep-awake — a stand-in for `expo-keep-awake` in the jsdom native suites, where the
 * native module has no runtime. It records each activation and deactivation by tag, so a suite can assert that a
 * screen holds the screen awake and lets go of the same hold.
 */

/** The tags currently held, in activation order. */
export const heldKeepAwakeTags = new Set<string>();

/**
 * @param tag - The holder's tag.
 * @sideEffect Records the tag as held.
 */
export function activateKeepAwakeAsync(tag = 'ExpoKeepAwakeDefaultTag'): Promise<void> {
    heldKeepAwakeTags.add(tag);

    return Promise.resolve();
}

/**
 * @param tag - The holder's tag.
 * @sideEffect Forgets the tag.
 */
export function deactivateKeepAwake(tag = 'ExpoKeepAwakeDefaultTag'): Promise<void> {
    heldKeepAwakeTags.delete(tag);

    return Promise.resolve();
}
