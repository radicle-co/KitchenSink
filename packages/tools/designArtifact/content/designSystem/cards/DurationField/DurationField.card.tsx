/**
 * @module DurationField.card — the design-system card of the DurationField: a filled cook time, a prep time and an
 * empty resting time, on both platforms.
 */
import { useState } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';

export default defineCard({
    group: 'Forms',
    height: 330,
    platforms: 'both',
    uses: ['DurationField'],
    render: ({ DurationField }, { stack }) => {
        function Field({ label, initial }: { readonly label: string; readonly initial: number | undefined }) {
            const [seconds, setSeconds] = useState(initial);

            return (
                <div style={{ width: 176 }}>
                    <DurationField
                        label={label}
                        hoursLabel="Hours"
                        minutesLabel="Minutes"
                        hoursUnit="h"
                        minutesUnit="min"
                        value={seconds}
                        onChange={setSeconds}
                    />
                </div>
            );
        }

        return (
            <div className={stack} style={{ alignItems: 'flex-start', gap: 24 }}>
                <Field label="Cook time" initial={5400} />
                <Field label="Prep time" initial={900} />
                <Field label="Resting time" initial={undefined} />
            </div>
        );
    },
});
