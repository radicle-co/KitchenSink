/**
 * @module @commise/features-account/profile — package export for the Profile page's building blocks, once for both apps
 * (`docs/design/uiOverhaul/buildSpec.md` §9.1): the pure rules, the copy, and the render leaves. Each leaf specifier
 * resolves to its web (`.tsx`) or native (`.native.tsx`) file at bundle time; the apps compose them into their Profile
 * page and own the profile read, the display-name write and the sign-out.
 */
export { DisplayNameSheet } from './DisplayNameSheet.js';
export { useDisplayNameEditor } from './useDisplayNameEditor.js';
export { useProfileScreen } from './useProfileScreen.js';
export type { ProfileScreen, ProfileScreenInput } from './useProfileScreen.js';
export type { DisplayNameEditor, DisplayNameEditorInput, DisplayNameSave } from './useDisplayNameEditor.js';
export { ProfileAccountGroup } from './ProfileAccountGroup.js';
export type { ProfileAccountGroupProps } from './ProfileAccountGroup.js';
export { ProfileGroup } from './ProfileGroup.js';
export { ProfileHeader } from './ProfileHeader.js';
export { ProfileRow } from './ProfileRow.js';
export { ProfileValueRow } from './ProfileValueRow.js';
export { SignOutRow } from './SignOutRow.js';
export { useSignOutControl } from './useSignOutControl.js';
export type { SignOutControl } from './useSignOutControl.js';

export {
    DISPLAY_NAME_MAX_LENGTH,
    canSaveDisplayName,
    displayNameDraftOf,
    formatUsername,
    givenNameOf,
    profileReadOf,
} from './model.js';
export type { GivenNameSource, ProfileQueryState, ProfileRead } from './model.js';
export { AVATAR_ALLOWED_TYPES, AVATAR_MAX_BYTES, AVATAR_MAX_MB, isAllowedAvatarType } from './avatarConstraints.js';
export { avatarCopyOf } from './avatarCopy.js';
export type { AvatarCopy } from './avatarCopy.js';
export { profileMessages } from './messages.js';
export type { ProfileMessages } from './messages.js';
export type {
    DisplayNameSheetProps,
    ProfileGroupProps,
    ProfileHeaderProps,
    ProfileRowProps,
    ProfileValueRowProps,
    SignOutRowProps,
} from './props.js';
