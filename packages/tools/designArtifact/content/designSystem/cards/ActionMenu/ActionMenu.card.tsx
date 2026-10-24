/**
 * @module ActionMenu.card — the design-system card of the ActionMenu: the disc over a hero photo, the unavailable
 * trigger and a menu with a destructive item. The last menu is opened after mount so the open state is on show.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';
import { waitFor } from '../../../../src/cards/waitFor.js';

const noop = (): void => undefined;
const line = { display: 'flex', gap: 8, alignItems: 'center', fontSize: 16 } as const;

export default defineCard({
    group: 'Overlays',
    height: 580,
    platforms: 'both',
    uses: ['ActionMenu'],
    staging: { portalIntoColumn: { frameHeight: 300 } },
    render: ({ ActionMenu }) => (
        <div className="col">
            <div style={line}>
                <span>On a hero photo</span>
                <ActionMenu
                    appearance="disc"
                    triggerLabel="Recipe actions"
                    title="Recipe"
                    closeLabel="Close"
                    items={[{ id: 'a', label: 'Share', onSelect: noop }]}
                />
            </div>
            <div style={line}>
                <span>While saving</span>
                <ActionMenu
                    triggerLabel="Actions for Olive oil"
                    title="Olive oil"
                    closeLabel="Close"
                    items={[]}
                    unavailable
                />
            </div>
            <div style={line}>
                <span>Smoked paprika</span>
                <ActionMenu
                    triggerLabel="Actions for Smoked paprika"
                    title="Smoked paprika"
                    closeLabel="Close"
                    items={[
                        { id: 'sw', label: 'Change food', icon: 'pencilLine', onSelect: noop },
                        { id: 'q', label: 'Edit quantity', onSelect: noop },
                    ]}
                    destructiveItem={{ id: 'rm', label: 'Remove ingredient', icon: 'trash', onSelect: noop }}
                />
            </div>
        </div>
    ),
    afterRender: async (columns) => {
        // The last trigger of each column is the full menu. Keep the stage's focus from leaving the stage.
        window.addEventListener(
            'focusin',
            (event) => {
                if (
                    event.target instanceof Node &&
                    columns.native?.parentElement?.querySelector('.frame')?.contains(event.target)
                ) {
                    event.stopImmediatePropagation();
                }
            },
            true,
        );
        const lastTrigger = (column: HTMLElement | undefined): HTMLElement | undefined =>
            Array.from(column?.querySelectorAll<HTMLElement>('button') ?? []).at(-1);

        const open = async (trigger: HTMLElement): Promise<void> => {
            await waitFor(() => trigger.getAttribute('aria-expanded') === 'true', {
                description: 'the menu to report itself open',
            });
        };

        const webTrigger = await waitFor(() => lastTrigger(columns.web), { description: 'the web trigger' });

        webTrigger.focus();
        webTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await open(webTrigger);

        const nativeTrigger = await waitFor(() => lastTrigger(columns.native), { description: 'the native trigger' });

        nativeTrigger.click();
        await open(nativeTrigger);
        await waitFor(() => columns.nativeStage?.querySelector('[role="dialog"]'), {
            description: 'the native sheet to land in its column stage',
        });
    },
});
