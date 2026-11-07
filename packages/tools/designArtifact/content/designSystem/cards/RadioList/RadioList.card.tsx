/**
 * @module RadioList.card — the design-system card of the RadioList: the bulk import mode choice with nothing chosen yet,
 * and the same list with a choice made, each row a whole-row radio with a hint under its label.
 */
import { useState } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';
import type { CardUi } from '../../../../src/cards/cardComponents.js';

const options = [
    { id: 'review', label: 'Check each line myself', hint: 'You choose a food for every line that needs one.' },
    { id: 'best', label: 'Use the best match', hint: 'We pick the closest food and flag the lines to check.' },
    { id: 'asWritten', label: 'Keep lines as written', hint: 'Nothing is matched, so there is no nutrition.' },
] as const;

function Mode({ RadioList, initial }: CardUi<'RadioList'> & { readonly initial: string | undefined }) {
    const [value, setValue] = useState<string | undefined>(initial);

    return <RadioList label="How to match ingredients" options={options} value={value} onChange={setValue} />;
}

export default defineCard({
    group: 'Selection',
    height: 640,
    platforms: 'both',
    uses: ['RadioList'],
    render: ({ RadioList }, { stack }) => (
        <div className={stack} style={{ gap: 32 }}>
            <Mode RadioList={RadioList} initial={undefined} />
            <Mode RadioList={RadioList} initial="best" />
        </div>
    ),
});
