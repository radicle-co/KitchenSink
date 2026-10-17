/**
 * @module KeepAwakeToggle.card — the design-system card of the KeepAwakeToggle: on and off, labelled and icon-only.
 * The page has no Screen Wake Lock, so the card gives it a stub that refuses, as a browser without permission would.
 */
import { useState } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';
import type { CardUi } from '../../../../src/cards/cardComponents.js';

/** Installs the refusing wake lock before the toggle mounts and asks for one. */
function refuseWakeLock(): void {
    try {
        Object.defineProperty(window, 'isSecureContext', { value: true });
        Object.defineProperty(navigator, 'wakeLock', {
            value: { request: () => Promise.reject(new Error('preview')) },
            configurable: true,
        });
    } catch {
        // A page that already defined them keeps its own.
    }
}

function Toggles({ KeepAwakeToggle, className }: CardUi<'KeepAwakeToggle'> & { readonly className: string }) {
    const [a, setA] = useState(true);
    const [b, setB] = useState(false);

    return (
        <div className={className}>
            <KeepAwakeToggle on={a} onChange={setA} label="Screen on" display="labelled" />
            <KeepAwakeToggle on={b} onChange={setB} label="Screen on" display="labelled" />
            <KeepAwakeToggle on={a} onChange={setA} label="Screen on" display="icon" />
            <KeepAwakeToggle on={b} onChange={setB} label="Screen on" display="icon" />
        </div>
    );
}

export default defineCard({
    group: 'Selection',
    height: 140,
    platforms: 'both',
    uses: ['KeepAwakeToggle'],
    render: ({ KeepAwakeToggle }) => {
        refuseWakeLock();

        return <Toggles KeepAwakeToggle={KeepAwakeToggle} className="row" />;
    },
});
