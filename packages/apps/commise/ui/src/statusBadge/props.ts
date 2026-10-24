/**
 * @module @commise/ui/status-badge — the shared contract of the design-system `StatusBadge`: a short word about a state,
 * as a filled badge that is not pressable (spec §1.4, §1.6, §1.11).
 *
 * A badge names a STATUS from a closed list, and the badge owns its colours and glyph; there is no free tone
 * (`docs/architecture/uiOverhaulBlueprint.md` Part B). The list holds the blueprint's recipe statuses and the two
 * ingredient-line statuses the badge already carried, which the blueprint's list did not account for:
 *
 * - `draft`, `private`, `public` — a recipe's publication status: neutral, each with its own glyph (§1.4 "Status").
 * - `pro` — the premium badge; `soon` — a placeholder's "coming soon".
 * - `note` — a quiet fact about an ingredient line ("Custom"); `attention` — something the cook can act on ("Needs
 *   review").
 *
 * The words stay the caller's (`children`), because they are localised copy and `@commise/ui` holds no catalogue.
 */
import type { IconName } from '../icon/props.js';
import { statusTone } from '../tokens/tones.js';

/** Every status a badge can state. */
export const BADGE_STATUSES = ['draft', 'private', 'public', 'pro', 'soon', 'note', 'attention'] as const;

/** A status a badge can state. */
export type BadgeStatus = (typeof BADGE_STATUSES)[number];

/** The glyph each status draws before its words, or `null` for a status that is only words. */
export const BADGE_GLYPH: Readonly<Record<BadgeStatus, IconName | null>> = {
    draft: statusTone.draft.icon,
    private: statusTone.private.icon,
    public: statusTone.public.icon,
    pro: null,
    soon: null,
    note: null,
    attention: null,
};

/** The cross-platform `StatusBadge` contract. */
export interface StatusBadgeProps {
    /** The status the badge states. */
    readonly status: BadgeStatus;
    /** The badge's words. Announced with the text the badge sits in; never hidden. */
    readonly children: string;
}
