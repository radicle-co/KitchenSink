/**
 * @module SnackbarHost.card — the design-system card of SnackbarHost: one host, a screen that asks it for a
 * snackbar with an Undo action when its button is pressed (the card presses it after mount), on both platforms. The native column sits
 * in a clipped, phone-height box so the host's bottom-anchored snackbar stays inside it.
 *
 * ⚠️ `useSnackbar` is a hook, not a component, so the card registry cannot hand it to `render`; each column's own
 * copy is read off that column's namespace (the native one has its own snackbar context) behind a type guard.
 */
import type { CardUi } from '../../../../src/cards/cardComponents.js';
import { defineCard } from '../../../../src/cards/defineCard.js';
import { waitFor } from '../../../../src/cards/waitFor.js';
import type { SnackbarApi } from '@commise/ui/snackbar';

type UseSnackbar = () => SnackbarApi;

const noop = (): void => undefined;

function isUseSnackbar(candidate: unknown): candidate is UseSnackbar {
    return typeof candidate === 'function';
}

/** The `useSnackbar` of one column: `window.Commise` for the web column, `window.Commise.Native` for the native. */
function columnUseSnackbar(platform: 'web' | 'native'): UseSnackbar {
    const namespace: unknown = Reflect.get(window, 'Commise');
    const column: unknown = platform === 'native' ? Reflect.get(Object(namespace), 'Native') : namespace;
    const hook: unknown = Reflect.get(Object(column), 'useSnackbar');

    if (!isUseSnackbar(hook)) {
        throw new TypeError(`The ${platform} namespace exports no useSnackbar.`);
    }

    return hook;
}

interface AskerProps {
    readonly useSnackbar: UseSnackbar;
    readonly Button: CardUi<'Button'>['Button'];
}

function Asker({ useSnackbar, Button }: AskerProps) {
    const { show } = useSnackbar();

    return (
        <Button
            variant="secondary"
            icon="trash"
            onPress={() =>
                show({ message: 'Recipe deleted', action: { label: 'Undo', onAction: noop }, durationMs: 600000 })
            }
        >
            Delete recipe
        </Button>
    );
}

export default defineCard({
    group: 'Feedback',
    height: 320,
    platforms: 'both',
    uses: ['SnackbarHost', 'Button'],
    render: ({ SnackbarHost, Button }, { platform }) => (
        <div
            style={
                platform === 'native'
                    ? {
                          position: 'relative',
                          display: 'flex',
                          flexDirection: 'column',
                          height: 250,
                          transform: 'translateZ(0)',
                          overflow: 'hidden',
                          border: '1px solid var(--line-divider)',
                          borderRadius: 12,
                          padding: 12,
                          boxSizing: 'border-box',
                      }
                    : {}
            }
        >
            <SnackbarHost>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
                    <p style={{ margin: 0 }}>Any screen asks the one host for a snackbar:</p>
                    <Asker useSnackbar={columnUseSnackbar(platform)} Button={Button} />
                </div>
            </SnackbarHost>
        </div>
    ),
    afterRender: async ({ web, native }) => {
        // Each screen asks its host for a snackbar by pressing the button; ready means both are on screen.
        for (const column of [web, native]) {
            const button = await waitFor(() => column?.querySelector('button'), {
                description: 'the Delete recipe button',
            });

            button.click();
            await waitFor(() => column?.textContent?.includes('Recipe deleted') === true, {
                description: 'the snackbar',
            });
        }
    },
});
