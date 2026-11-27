/**
 * @module CookingTimerRow.card — the design-system card of the cooking timer row: a running, a paused and a finished
 * timer, each with a summary in the body, on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

export default defineCard({
    group: 'Feedback',
    height: 330,
    platforms: 'both',
    uses: ['CookingTimerRow', 'CookingTimerSummary'],
    render: ({ CookingTimerRow, CookingTimerSummary }, { stack }) => (
        <div className={stack}>
            <CookingTimerRow
                state={{
                    kind: 'running',
                    pause: { label: 'Pause Roast timer', onPress: noop },
                    cancel: { label: 'Cancel Roast timer', onPress: noop },
                }}
                body={
                    <CookingTimerSummary
                        figure="4:30"
                        meta="Roast, step 4"
                        accessibilityLabel="Roast, 4 minutes 30 seconds left"
                    />
                }
            />
            <CookingTimerRow
                state={{
                    kind: 'paused',
                    resume: { label: 'Resume Roast timer', onPress: noop },
                    cancel: { label: 'Cancel Roast timer', onPress: noop },
                }}
                body={
                    <CookingTimerSummary
                        figure="1:09:50"
                        status="Paused"
                        meta="Stock, step 2"
                        accessibilityLabel="Stock, paused, 1 hour 9 minutes 50 seconds left"
                    />
                }
            />
            <CookingTimerRow
                state={{ kind: 'done', stop: { label: 'Stop Rice timer', onPress: noop } }}
                body={
                    <CookingTimerSummary
                        figure="0:00"
                        status="Done"
                        meta="Rice, step 3"
                        accessibilityLabel="Rice timer is done"
                    />
                }
            />
        </div>
    ),
});
