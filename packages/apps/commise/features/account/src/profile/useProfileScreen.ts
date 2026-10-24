/**
 * @module @commise/features-account/profile/useProfileScreen — the Profile page's read-and-edit assembly, once for both
 * apps: the three-state read (`profileReadOf`) and the display-name editor seeded from what the server holds.
 *
 * Both pages derived `saved` the same way (the saved name once the read is ready, and nothing before then, so a Google
 * given name only ever PREFILLS) and fed it to the editor. Each app still owns the profile query, Clerk's user and the
 * profile mutation, because those are platform-bound; the page's other concerns (the photo, preferences, sign-out) stay
 * with the page.
 *
 * @pattern Facade — one headless hook over `profileReadOf` and `useDisplayNameEditor`
 */
import { profileReadOf, type ProfileQueryState, type ProfileRead } from './model.js';
import { useDisplayNameEditor, type DisplayNameEditor, type DisplayNameEditorInput } from './useDisplayNameEditor.js';

/** What the page is given. */
export interface ProfileScreenInput {
    /** The profile query's state. */
    readonly query: ProfileQueryState;
    /** Clerk's user, or nothing while it loads. */
    readonly user: DisplayNameEditorInput['user'];
    /** The profile mutation (`profileMutations(client).update()`). */
    readonly update: DisplayNameEditorInput['update'];
}

/** What the page renders from. */
export interface ProfileScreen {
    /** Loading, failed or ready. */
    readonly read: ProfileRead;
    /** The display-name sheet's state and actions. */
    readonly editor: DisplayNameEditor;
}

/**
 * @param input - The profile query, Clerk's user and the profile mutation.
 * @returns The read and the editor.
 * @sideEffect The editor's `save` writes through the injected mutation.
 */
export function useProfileScreen({ query, user, update }: ProfileScreenInput): ProfileScreen {
    const read = profileReadOf(query);
    const editor = useDisplayNameEditor({ saved: read.status === 'ready' ? read.displayName : '', user, update });

    return { read, editor };
}
