/**
 * @module @commise/features-account/profile — package export for the Profile page's building blocks, once for both apps
 * (`docs/design/uiOverhaul/buildSpec.md` §9.1): the pure rules, the copy, and the render leaves. Each leaf specifier
 * resolves to its web (`.tsx`) or native (`.native.tsx`) file at bundle time; the apps compose them into their Profile
 * page and own the profile read, the display-name write and the sign-out.
 */
export { DisplayNameSheet } from './DisplayNameSheet.js';
export { ProfileGroup } from './ProfileGroup.js';
export { ProfileHeader } from './ProfileHeader.js';
export { ProfileRow } from './ProfileRow.js';
export { ProfileValueRow } from './ProfileValueRow.js';

export {
    DISPLAY_NAME_MAX_LENGTH,
    canSaveDisplayName,
    displayNameDraftOf,
    givenNameOf,
    profileReadOf,
} from './model.js';
export type { GivenNameSource, ProfileQueryState, ProfileRead } from './model.js';
export { profileMessages } from './messages.js';
export type { ProfileMessages } from './messages.js';
export type {
    DisplayNameSheetProps,
    ProfileGroupProps,
    ProfileHeaderProps,
    ProfileRowProps,
    ProfileValueRowProps,
} from './props.js';
