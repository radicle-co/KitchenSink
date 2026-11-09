/**
 * @module @commise/features-recipes/form — `AmountRun` (web): the ONE text run an ingredient line reads as, wherever the
 * line is drawn (#144): the amount in the strong weight, an ordinary space, then the words. The editor row and the private
 * food refusal sheet both draw it, so a refused line looks exactly like its row.
 *
 * No amount: no strong span and no space, never an invented "1" (F5). Wraps only between words; the no-break space inside
 * the amount keeps "2 tablespoons" whole.
 *
 * Presentational: `props → JSX`.
 */
import type { FC, ReactNode } from 'react';

/** Props for {@link AmountRun}. */
export interface AmountRunProps {
    /** The amount as the row shows it (`formatQuantity`), or `''` for none. */
    readonly amount: string;
    /** The words after it: the food, and whatever the row adds. */
    readonly children: ReactNode;
}

/** An ingredient line's text run. */
export const AmountRun: FC<AmountRunProps> = ({ amount, children }) => (
    <span className="break-words text-body-md text-ink">
        {amount !== '' && (
            <>
                <span className="text-figure-inline font-semibold">{amount}</span>{' '}
            </>
        )}
        {children}
    </span>
);
