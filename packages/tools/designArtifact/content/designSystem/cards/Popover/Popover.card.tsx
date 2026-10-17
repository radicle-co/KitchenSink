/**
 * @module Popover.card — the design-system card of Popover: a triggered popover, opened after mount so the open
 * layer is visible, on both platforms. Each layer lands in its own column's stage.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';
import { waitFor } from '../../../../src/cards/waitFor.js';

export default defineCard({
    group: 'Overlays',
    height: 540,
    platforms: 'both',
    staging: { portalIntoColumn: { frameHeight: 360 } },
    uses: ['Popover'],
    render: ({ Popover }) => (
        <div style={{ paddingTop: 8 }}>
            <Popover
                triggerLabel="Choose a match for 2 cups flour"
                triggerIcon="triangleAlert"
                triggerText="Choose a match"
                title="Which flour?"
                closeLabel="Close flour matches"
            >
                <div>
                    <p style={{ margin: '0 0 8px' }}>We found three matches for “flour”.</p>
                    <div>All-purpose flour · Bread flour · Whole wheat flour</div>
                </div>
            </Popover>
        </div>
    ),
    afterRender: async ({ web, native, nativeStage }) => {
        // The native sheet takes focus; keep Radix from reading that as an outside focus and closing the web popover.
        window.addEventListener(
            'focusin',
            (event) => {
                if (event.target instanceof Node && nativeStage?.contains(event.target) === true) {
                    event.stopImmediatePropagation();
                }
            },
            true,
        );

        const open = async (column: HTMLElement | undefined): Promise<void> => {
            const trigger = await waitFor(() => column?.querySelector('button'), { description: 'the trigger' });

            trigger.click();
            await waitFor(() => trigger.getAttribute('aria-expanded') === 'true', {
                description: 'the popover to report itself open',
            });
        };

        await open(web);
        await open(native);
        await waitFor(() => nativeStage?.querySelector('[role="dialog"]'), {
            description: 'the native sheet to land in its column stage',
        });
    },
});
