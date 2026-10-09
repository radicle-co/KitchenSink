/**
 * @module home/chrome/chromeGlyphs — the meaning each mobile top-bar affordance draws (US-000 / FR-046 / FR-044).
 *
 * A meaning from `@commise/ui/icon` per affordance; the `Icon` primitive owns the glyph and the drawing. The
 * destinations' glyphs are the shared nav model's own (`NAV_ITEM_GLYPH`, `@commise/features-core`), read by both apps.
 * Slice 3 of the overhaul removes these affordances (no dead search or bell buttons).
 *
 * @pattern Registry — a table keyed by the affordance ids
 */
import type { IconName } from '@commise/ui/icon';

/** The top-bar control affordances of the mockup — the ids that are NOT navigation destinations. */
export const CONTROL_ICONS = {
    search: 'search',
    notifications: 'bell',
} as const satisfies Readonly<Record<string, IconName>>;
