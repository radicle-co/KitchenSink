/**
 * @module RevealSpacer.card — the design-system card of RevealSpacer: two fields and a dashed outline around the
 * 96 dp spacer, with the height its `onLayout` reported. Native only.
 */
import { useState } from 'react';

import type { CardUi } from '../../../../src/cards/cardComponents.js';
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

function Demo({ Input, RevealSpacer }: CardUi<'Input' | 'RevealSpacer'>) {
    const [reported, setReported] = useState<number | null>(null);

    return (
        <div className="col">
            <Input id="rs1" value="Chicken thighs" onChangeText={noop} label="Main ingredient" />
            <Input id="rs2" value="1 kg" onChangeText={noop} label="Quantity" />
            <div style={{ outline: '1px dashed var(--ink-muted)', outlineOffset: 0, borderRadius: 4 }}>
                <RevealSpacer
                    height={96}
                    onLayout={(event) => {
                        setReported(Math.round(event.nativeEvent.layout.height));
                    }}
                />
            </div>
            <p className="muted">
                {`Dashed box: the spacer, 96 dp of blank room at the end of the scroller. It draws nothing. onLayout reported a height of ${reported === null ? '…' : String(reported)} dp.`}
            </p>
        </div>
    );
}

export default defineCard({
    group: 'Layout',
    height: 400,
    platforms: 'native',
    reason: 'it reserves the scroll room a field reveal needs, and its host (useFieldRevealHost) is native-only.',
    uses: ['Input', 'RevealSpacer'],
    render: ({ Input, RevealSpacer }) => <Demo Input={Input} RevealSpacer={RevealSpacer} />,
});
