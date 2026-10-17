/**
 * @module LoadMoreControl.card — the design-system card of the LoadMoreControl: ready, loading and failed.
 */
import type { ReactNode } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;
const labels = {
    loadMore: 'Load more',
    loadingMore: 'Loading more',
    retry: 'Try again',
    failed: 'We couldn’t load more recipes.',
};
const box = { background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 12, padding: 12 } as const;

function boxed(control: ReactNode): ReactNode {
    return <div style={box}>{control}</div>;
}

export default defineCard({
    group: 'Actions',
    height: 340,
    platforms: 'both',
    uses: ['LoadMoreControl'],
    render: ({ LoadMoreControl }) => (
        <div className="col">
            {boxed(<LoadMoreControl hasMore onLoadMore={noop} labels={labels} loading={false} failed={false} />)}
            {boxed(<LoadMoreControl hasMore onLoadMore={noop} labels={labels} loading failed={false} />)}
            {boxed(<LoadMoreControl hasMore onLoadMore={noop} labels={labels} loading={false} failed />)}
        </div>
    ),
});
