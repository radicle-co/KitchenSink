/**
 * @module test-utils/regionSpeech — what a screen reader can hear from a live region: a region speaks at a change of
 * its text and at no other time, and an emptied region is silent (`docs/design/rowEditorOpenDecisions.md` R3).
 *
 * It counts every change rather than sampling the text after a step, so a region emptied and refilled within one step
 * shows as two changes. It watches one node, so a region replaced by a remount fails loudly instead of reading as
 * silence.
 */

/** A region's changes since it was last asked, and the text it holds now. */
export interface RegionStep {
    readonly changes: number;
    readonly text: string;
}

/**
 * Starts watching a live region.
 *
 * @sideEffect Observes the region's DOM mutations for the rest of the test.
 * @param region - The live region's node.
 * @returns A function that reports the region's changes since its previous call, and throws if the region was replaced.
 */
export function watchRegion(region: Element): () => RegionStep {
    let changes = 0;
    const observer = new MutationObserver((records) => {
        changes += records.length;
    });
    observer.observe(region, { childList: true, characterData: true, subtree: true });

    return () => {
        if (!region.isConnected) {
            throw new Error('The live region was replaced: a remount speaks where this watcher cannot hear it.');
        }

        const step = { changes: changes + observer.takeRecords().length, text: region.textContent };
        changes = 0;

        return step;
    };
}
