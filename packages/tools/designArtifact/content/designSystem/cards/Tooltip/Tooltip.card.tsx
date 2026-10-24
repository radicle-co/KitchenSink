/**
 * @module Tooltip.card — the design-system card of the Tooltip: two icon-sized triggers, the first opened by focus and
 * hover after mount so its bubble shows. Web only.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';
import { waitFor } from '../../../../src/cards/waitFor.js';

const trigger = {
    width: 44,
    height: 44,
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--line-control)',
    background: 'var(--paper)',
    color: 'var(--ink)',
    fontSize: 18,
} as const;

export default defineCard({
    group: 'Overlays',
    height: 160,
    platforms: 'web',
    reason: 'a tooltip needs a hovering pointer or keyboard focus, and the one surface that uses it, the collapsed sidebar rail, does not exist on mobile.',
    uses: ['Tooltip'],
    render: ({ Tooltip }) => (
        <div
            style={{
                display: 'flex',
                gap: 96,
                padding: 16,
                background: 'var(--paper)',
                borderRadius: 'var(--radius-md)',
            }}
        >
            <Tooltip label="Recipes" side="end">
                <button type="button" id="t1" aria-label="Recipes" style={trigger}>
                    R
                </button>
            </Tooltip>
            <Tooltip label="Meal plan" side="bottom">
                <button type="button" aria-label="Meal plan" style={trigger}>
                    M
                </button>
            </Tooltip>
        </div>
    ),
    afterRender: async ({ web }) => {
        const trigger = await waitFor(() => web?.querySelector<HTMLElement>('#t1'), { description: 'the trigger' });

        trigger.focus();
        trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
        trigger.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
        await waitFor(() => document.querySelector('[data-tooltip]'), { description: 'the tooltip bubble' });
    },
});
