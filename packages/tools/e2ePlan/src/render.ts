import type { Plan, TierSelection } from './selection.js';

/**
 * The ids a selection runs.
 *
 * @param selection - A tier's selection.
 * @param all - Every test of the tier, in the order the tier lists them.
 * @returns The ids to run, in the tier's order.
 * @throws When a pick names a test the tier does not list: dropping it would shrink the run without a word.
 */
export function idsOf(selection: TierSelection, all: readonly string[]): readonly string[] {
    if (selection.kind === 'all') {
        return all;
    }

    const known = new Set(all);
    const ghost = selection.picks.find((pick) => !known.has(pick.id));

    if (ghost !== undefined) {
        throw new Error(`error: the plan picked ${ghost.id}, which the tier does not list`);
    }

    const picked = new Set(selection.picks.map((pick) => pick.id));

    return all.filter((id) => picked.has(id));
}

/** How many reasons a tier prints; the JSON form carries them all. */
const REASONS_SHOWN = 10;

const TIER_LABEL = { web: 'web (Playwright)', mobile: 'mobile (Maestro)' } as const;

function renderTier(tier: 'web' | 'mobile', selection: TierSelection, all: readonly string[]): readonly string[] {
    if (selection.kind === 'all') {
        const more = selection.reasons.length - REASONS_SHOWN;

        return [
            `${TIER_LABEL[tier]}: all ${all.length}`,
            ...selection.reasons.slice(0, REASONS_SHOWN).map((reason) => `    ${reason}`),
            ...(more > 0 ? [`    ... and ${more} more`] : []),
        ];
    }

    const lines = [`${TIER_LABEL[tier]}: ${selection.picks.length} of ${all.length}`];

    for (const pick of selection.picks) {
        lines.push(`    ${pick.id}  <-  ${pick.because}`);
    }

    return lines;
}

/**
 * The plan as text for a person.
 *
 * @param plan - The plan.
 * @param inventory - Every test of each tier.
 * @param context - What the plan was measured against.
 * @returns Lines of text.
 */
export function renderPlan(
    plan: Plan,
    inventory: { readonly web: readonly string[]; readonly mobile: readonly string[] },
    context: { readonly base: string; readonly changed: number },
): string {
    const lines = [`e2e plan against ${context.base}: ${context.changed} changed files`];

    for (const warning of plan.warnings) {
        lines.push(`warning: ${warning}`);
    }

    lines.push(...renderTier('web', plan.web, inventory.web), ...renderTier('mobile', plan.mobile, inventory.mobile));

    if (
        plan.web.kind === 'some' &&
        plan.web.picks.length === 0 &&
        plan.mobile.kind === 'some' &&
        plan.mobile.picks.length === 0
    ) {
        lines.push('nothing to run: no change touches a screen or a test');
    }

    return `${lines.join('\n')}\n`;
}
