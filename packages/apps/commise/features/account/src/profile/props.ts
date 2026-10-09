/**
 * @module @commise/features-account/profile/props — the platform-neutral contract of the Profile page's render
 * leaves (`docs/design/uiOverhaul/buildSpec.md` §9.1). The web (`.tsx`) and native (`.native.tsx`) leaves implement
 * exactly these props; the page that composes them (an app's orchestration) fetches and writes, they only draw.
 */
import type { ReactNode } from 'react';

import type { ProfileRead } from './model.js';

/** A grouped list: an optional H2 and the rows under it. */
export interface ProfileGroupProps {
    /** The group's heading ("Preferences", "Danger zone"). Absent for the unlabelled middle group. */
    readonly heading?: string;
    /** The accessible name of a group with no visible heading. */
    readonly label?: string;
    /** The rows. */
    readonly children: ReactNode;
}

/** A read-only row: a label and its value. */
export interface ProfileValueRowProps {
    readonly label: string;
    readonly value: string;
}

/** A pressable row (56 px): a label, a value, an optional hint, and a chevron when it opens something. */
export interface ProfileRowProps {
    readonly label: string;
    /** The current value, one line, truncated. */
    readonly value?: string;
    /** A caption under the label (the danger rows' consequence). */
    readonly hint?: string;
    /** `ink` for ordinary rows. `danger` for the danger zone's text. */
    readonly tone: 'ink' | 'danger';
    /** Whether a chevron says the row opens something. */
    readonly chevron: boolean;
    /** The row is mid-action: it cannot be pressed again and says so to assistive tech. */
    readonly busy?: boolean;
    readonly onPress: () => void;
    /** Web only: where a link row goes, so a modified click still works. Native ignores it. */
    readonly href?: string;
    /**
     * Native only: a count the host advances when the sheet this row opened closes. A change takes the screen-reader
     * cursor back to the row (WCAG 2.4.3; `buildSpec.md` §10 "Dialogs and sheets"), because React Native cannot say
     * where the cursor was. The first value moves nothing. Web ignores it: Radix returns focus to the opener itself.
     */
    readonly focusSignal?: number;
}

/** The header: the avatar disc, the name and the email — or its loading skeleton, or its failure. */
export interface ProfileHeaderProps {
    readonly read: ProfileRead;
    /** The cook's initials, empty when there is no name. */
    readonly initials: string;
    /** Retry the read (the failed state). */
    readonly onRetry: () => void;
}

/** The display-name sheet. */
export interface DisplayNameSheetProps {
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    /** The field's text. */
    readonly draft: string;
    readonly onDraftChange: (text: string) => void;
    /** Whether Save may fire (`canSaveDisplayName`). */
    readonly canSave: boolean;
    readonly saving: boolean;
    /** The save failed. */
    readonly failed: boolean;
    readonly onSave: () => void;
}
