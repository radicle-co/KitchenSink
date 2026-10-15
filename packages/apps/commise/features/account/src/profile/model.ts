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

/** How much of the limit the cook has used before the counter appears: 80 %, the build spec's rule for a bounded field. */
const NAME_COUNTER_FROM_SHARE = 0.8;

/** The counter the display-name field shows once the cook is close to its limit. */
export interface NameCounter {
    /** The characters typed, as the field's own `maxLength` counts them. */
    readonly count: number;
    /** The limit ({@link DISPLAY_NAME_MAX_LENGTH}). */
    readonly max: number;
    /** The cook has used all of it: typing and pasting stop here. */
    readonly atLimit: boolean;
}

/**
 * The counter for the display-name field. The field stops at its limit (a hard `maxLength`, because the name is a
 * public handle), so without this a paste past it is cut and nothing says so.
 *
 * @param draft - The field's text.
 * @returns The counter from 80 % of the limit upward, or `undefined` while the cook is well within it. Pure.
 */
export function nameCounterOf(draft: string): NameCounter | undefined {
    const count = draft.length;

    if (count < DISPLAY_NAME_MAX_LENGTH * NAME_COUNTER_FROM_SHARE) {
        return undefined;
    }

    return { count, max: DISPLAY_NAME_MAX_LENGTH, atLimit: count >= DISPLAY_NAME_MAX_LENGTH };
}

/**
 * @param template - The localized counter, with `{count}` and `{max}` (`profileMessages.nameCounter`).
 * @param counter - The counter to write out.
 * @returns The text the field shows, such as `85/100`. Pure.
 */
export function formatNameCounter(template: string, counter: NameCounter): string {
    return template.replace('{count}', String(counter.count)).replace('{max}', String(counter.max));
}

/**
 * @param template - The localized username line, with `{username}` (`profileMessages.usernameValue`).
 * @param username - The Clerk username.
 * @returns The line the header shows, such as `@braise`. Pure.
 */
export function formatUsername(template: string, username: string): string {
    return template.replace('{username}', () => username);
}

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
    | {
          readonly status: 'ready';
          readonly displayName: string;
          readonly email: string;
          /** The Clerk username, shown read-only — Clerk owns it (plan 2026-10-15-010 D12) — or `null`. */
          readonly username: string | null;
      };

/** The slice of a profile query this reads. */
export interface ProfileQueryState {
    readonly isError: boolean;
    readonly data?:
        | { readonly user: { readonly displayName: string; readonly email: string; readonly username: string | null } }
        | undefined;
}

/**
 * @param query - The profile query's state.
 * @returns Loading, failed, or ready. A cached profile stays ready when a background refetch fails: the page keeps
 *     what it shows rather than swapping a working page for an error. Pure.
 */
export function profileReadOf(query: ProfileQueryState): ProfileRead {
    if (query.data !== undefined) {
        return {
            status: 'ready',
            displayName: query.data.user.displayName.trim(),
            email: query.data.user.email,
            username: query.data.user.username,
        };
    }

    return { status: query.isError ? 'failed' : 'loading' };
}
