'use client';

/**
 * @module @commise/features-recipes/foodPage — `YourFoodsRow` (web): the Profile entry to the cook's own foods, in its own
 * group after the others. A 56 px row like every Profile row, with an 8 px steel dot when a staff decision is waiting,
 * and a name that says so: "Your foods, 1 new decision". The dot is not announced on its own; the name carries it.
 *
 * Presentational: `props → JSX`.
 */
import { useMessages } from '@commise/i18n/react';
import { useLocale } from '@commise/i18n/react';
import { Icon } from '@commise/ui/icon';
import { FOCUS_RING_CLASS } from '@commise/ui/focus-ring';
import { isModifiedClick } from '@commise/ui/route-link';
import { PRESS_FILL_CLASS } from '@commise/ui/surface-tone';
import type { FC, MouseEvent } from 'react';

import { pluralOf } from '@commise/i18n';
import { foodPageMessages } from './messages.js';
import type { YourFoodsRowProps } from './yourFoodsViewProps.js';

const BOX = `flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start text-ink ${PRESS_FILL_CLASS.pointer} ${FOCUS_RING_CLASS.inset}`;

/** The Profile row. */
export const YourFoodsRow: FC<YourFoodsRowProps> = ({ unseenDecisions, onPress, href }) => {
    const { yourFoods: m } = useMessages(foodPageMessages);
    const locale = useLocale();
    const name = unseenDecisions > 0 ? pluralOf(m.profileRowUnseen, unseenDecisions, locale) : m.profileRow;
    const body = (
        <>
            <span aria-hidden className="text-body flex-1">
                {m.profileRow}
            </span>
            {unseenDecisions > 0 ? <span aria-hidden className="size-2 shrink-0 rounded-full bg-action" /> : null}
            <Icon name="chevronRight" size={20} />
        </>
    );

    if (href !== undefined) {
        return (
            <a
                href={href}
                aria-label={name}
                className={BOX}
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                    if (!isModifiedClick(event)) {
                        event.preventDefault();
                        onPress();
                    }
                }}
            >
                {body}
            </a>
        );
    }

    return (
        <button type="button" aria-label={name} className={BOX} onClick={onPress}>
            {body}
        </button>
    );
};
