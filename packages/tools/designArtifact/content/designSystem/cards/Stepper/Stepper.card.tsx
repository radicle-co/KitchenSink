/**
 * @module Stepper.card — the design-system card of the Stepper: a mid-range value, the minimum, a capped maximum and a
 * hidden label.
 */
import { useState } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';
import type { CardUi } from '../../../../src/cards/cardComponents.js';

interface Case {
    readonly id: string;
    readonly label: string;
    readonly initial: number;
    readonly max?: number;
    readonly hideLabel?: boolean;
}

const cases: readonly Case[] = [
    { id: 's1', label: 'Servings', initial: 4 },
    { id: 's2', label: 'Servings (at minimum)', initial: 1 },
    { id: 's3', label: 'Servings (max 6)', initial: 6, max: 6 },
    { id: 's4', label: 'Servings', initial: 2, hideLabel: true },
];

function Serving({ Stepper, spec }: CardUi<'Stepper'> & { readonly spec: Case }) {
    const [value, setValue] = useState(spec.initial);

    return (
        <Stepper
            id={spec.id}
            label={spec.label}
            value={value}
            onChange={setValue}
            announce={(count) => `Serves ${String(count)}`}
            decreaseLabel="Fewer servings"
            increaseLabel="More servings"
            {...(spec.max === undefined ? {} : { max: spec.max })}
            {...(spec.hideLabel === true ? { labelVisibility: 'hidden' as const } : {})}
        />
    );
}

export default defineCard({
    group: 'Selection',
    height: 370,
    platforms: 'both',
    uses: ['Stepper'],
    render: ({ Stepper }, { stack }) => (
        <div className={stack} style={{ alignItems: 'flex-start', gap: 20 }}>
            {cases.map((spec) => (
                <Serving key={spec.id} Stepper={Stepper} spec={spec} />
            ))}
        </div>
    ),
});
