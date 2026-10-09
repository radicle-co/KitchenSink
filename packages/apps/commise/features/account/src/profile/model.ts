/**
 * @module @commise/features-account/profile/model — the Profile page's pure rules, once for both apps
 * (`docs/design/uiOverhaul/buildSpec.md` §9.1; `docs/architecture/uiOverhaulBlueprint.md` A17).
 *
 * The page writes one thing, the display name, and it can show publicly as an author handle. So the cook decides what
 * it says: a Google given name only PREFILLS an empty field, never replaces a saved name, and nothing is written until
 * the cook presses Save.
 */
import { patchUserMeRequestSchema } from '@kitchensink/schema-identity';

/**
 * The identity service's limit on a display name, read from its contract (`patchUserMeRequestSchema.displayName`), so
 * the field, the Save gate and the service cannot disagree.
 *
 * @throws {Error} At load, if the contract stops bounding the name — a field with no limit would let the cook type a
 *     name the gate can never save.
 */
export const DISPLAY_NAME_MAX_LENGTH: number = (() => {
    const limit = patchUserMeRequestSchema.shape.displayName.unwrap().maxLength;

    if (limit === null) {
        throw new Error(
            'patchUserMeRequestSchema.displayName has no maximum length; the display-name field needs one.',
        );
    }

    return limit;
})();

/** The slice of a Clerk `UserResource` the prefill reads; both Clerk SDKs (`@clerk/nextjs`, `@clerk/expo`) fit it. */
export interface GivenNameSource {
    readonly firstName?: string | null | undefined;
    readonly externalAccounts?: readonly {
        /** Clerk spells Google `google`, and `oauth_google` in older SDKs. */
        readonly provider: string;
        readonly firstName?: string | null | undefined;
    }[];
}

/** Clerk's two spellings of the Google provider. */
const GOOGLE_PROVIDERS: ReadonlySet<string> = new Set(['google', 'oauth_google']);

/** @returns The trimmed text, or `undefined` when it is blank. */
function nonBlank(text: string | null | undefined): string | undefined {
    const trimmed = text?.trim();

    return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/**
 * The cook's given name as Clerk holds it: the Google account's, else the user's own.
 *
 * ⚠️ Clerk only populates these when the dashboard's name fields are on or the sign-in came through Google; with
 * both off there is no name and the field starts empty. That is a correct outcome, not an error.
 *
 * @param user - Clerk's user, or nothing while it loads.
 * @returns The given name, or `undefined` when there is none. Pure.
 */
export function givenNameOf(user: GivenNameSource | null | undefined): string | undefined {
    const google = user?.externalAccounts?.find((account) => GOOGLE_PROVIDERS.has(account.provider));

    return nonBlank(google?.firstName) ?? nonBlank(user?.firstName);
}

/**
 * What the display-name field holds when the sheet opens.
 *
 * @param input - The saved name and Clerk's given name.
 * @returns The saved name when there is one, else the given name, else empty. Pure.
 */
export function displayNameDraftOf(input: { readonly saved: string; readonly givenName: string | undefined }): string {
    return nonBlank(input.saved) ?? input.givenName ?? '';
}

/**
 * Whether Save may fire.
 *
 * @param input - The field's text and the saved name.
 * @returns True for a non-blank name within the limit that differs from the saved one. Pure.
 */
export function canSaveDisplayName(input: { readonly draft: string; readonly saved: string }): boolean {
    const draft = input.draft.trim();

    return draft !== '' && draft.length <= DISPLAY_NAME_MAX_LENGTH && draft !== input.saved.trim();
}

/** What the page shows for the profile read. */
export type ProfileRead =
    | { readonly status: 'loading' }
    | { readonly status: 'failed' }
    | { readonly status: 'ready'; readonly displayName: string; readonly email: string };

/** The slice of a profile query this reads. */
export interface ProfileQueryState {
    readonly isError: boolean;
    readonly data?: { readonly user: { readonly displayName: string; readonly email: string } } | undefined;
}

/**
 * @param query - The profile query's state.
 * @returns Loading, failed, or ready. A cached profile stays ready when a background refetch fails: the page keeps
 *     what it shows rather than swapping a working page for an error. Pure.
 */
export function profileReadOf(query: ProfileQueryState): ProfileRead {
    if (query.data !== undefined) {
        return { status: 'ready', displayName: query.data.user.displayName.trim(), email: query.data.user.email };
    }

    return { status: query.isError ? 'failed' : 'loading' };
}
