/**
 * @module SyncNoticeStack.card — the design-system card of SyncNoticeStack: an offline notice and an unreadable-work
 * notice stacked, on both platforms. On web the stack draws nothing of its own; on native it takes the top inset.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

export default defineCard({
    group: 'Feedback',
    height: 420,
    platforms: 'both',
    notes: {
        web: 'On web the stack draws nothing: the notices flow at the top of main.',
        native: 'With a notice showing, the native column takes the 47 pt top inset itself.',
    },
    uses: ['SyncNotice', 'SyncNoticeStack', 'UnreadableWorkNotice'],
    render: ({ SyncNotice, SyncNoticeStack, UnreadableWorkNotice }, { platform }) => (
        <div
            style={
                platform === 'web'
                    ? { maxWidth: 420 }
                    : {
                          border: '1px solid var(--line-divider)',
                          borderRadius: 24,
                          background: 'var(--canvas)',
                          overflow: 'hidden',
                          paddingBottom: 16,
                      }
            }
        >
            <SyncNoticeStack active>
                <SyncNotice
                    regionLabel="Connection status"
                    state={{
                        kind: 'offline',
                        title: 'You are offline',
                        body: 'Your pancake recipe is saved on this device and will send itself when you are back online.',
                    }}
                />
                <UnreadableWorkNotice
                    shown
                    title="One saved edit could not be read"
                    body="It was dropped so the rest of your changes could send."
                    dismissLabel="Dismiss"
                    onDismiss={noop}
                />
            </SyncNoticeStack>
        </div>
    ),
});
