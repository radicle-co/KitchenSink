/**
 * @module @commise/features-recipes/hooks — what the add-recipes picker announces (`docs/architecture/uiOverhaulBlueprint.md`
 * A15). Its own file because a file declares one hook; the toggles it reads are `useMemberToggle`'s.
 *
 * @pattern Observer — derives the announcement from the mutation cache, so it needs no state of its own
 */
import { useMutationState } from '@tanstack/react-query';

import { memberKey, type MemberToggle } from './useMemberToggle.js';

/** What the picker announces. */
export interface PickerAnnouncement {
    readonly title: string;
    /** `true` for "Added {title}", `false` for "Removed {title}". */
    readonly member: boolean;
    /** When the toggle was made. Said again for the same recipe, it is a new occurrence, so it is announced again. */
    readonly at: number;
}

/**
 * The picker's latest toggle that did not fail, for its polite live region. Derived from the mutation cache, so it
 * needs no state of its own.
 *
 * @param collectionId - The collection being edited.
 * @returns The latest toggle, or `undefined` before any.
 */
export function usePickerAnnouncement(collectionId: string): PickerAnnouncement | undefined {
    const [latest] = useMutationState({
        filters: { mutationKey: memberKey(collectionId) },
        select: (entry) => ({
            status: entry.state.status,
            toggle: entry.state.variables as MemberToggle | undefined,
            submittedAt: entry.state.submittedAt,
        }),
    })
        .filter((entry) => entry.status !== 'error' && entry.toggle !== undefined)
        .sort((left, right) => right.submittedAt - left.submittedAt);

    return latest?.toggle === undefined
        ? undefined
        : { title: latest.toggle.title, member: latest.toggle.member, at: latest.submittedAt };
}
