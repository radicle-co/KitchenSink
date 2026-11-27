/**
 * @module testing/axeTags — the axe rule tags our accessibility bar names: WCAG 2.1 levels A and AA. The jsdom helper
 * (`testing/axe`) and the browser spec both read this list, so the two tiers cannot check different rule sets.
 */

/** The tags axe runs, as axe-core spells them. */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;
