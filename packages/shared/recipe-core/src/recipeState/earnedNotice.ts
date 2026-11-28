/**
 * The earned sentence of VIEW_ADAPTED_BY_COOK (4.8). It is not a toast of its own: it is a second sentence added after
 * whichever outcome sentence applies, the save outcome or the publish outcome (AE16), so the outcome is said once.
 * `finishedNoticeOf` is on main (`editor/finishedOutcome.ts`). P4a wires {@link noticeWithEarned} into it, with the earned fact and its `adaptedEarned` key, which are not on main yet.
 * The words live in the messages file, because strings never go in recipe-core.
 */

/**
 * The notice after a finish: the outcome sentence, then the earned sentence when this save or publish earned the fact.
 *
 * @param outcomeSentence - "Changes saved." or "Recipe published.", from the editor's own copy.
 * @param earnedSentence - The earned sentence, or `undefined` when this finish earned nothing.
 * @returns The notice. Pure.
 */
export function noticeWithEarned(outcomeSentence: string, earnedSentence: string | undefined): string {
    return earnedSentence === undefined ? outcomeSentence : `${outcomeSentence} ${earnedSentence}`;
}
