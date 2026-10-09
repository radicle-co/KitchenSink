/**
 * @module @commise/features-recipes/filters — the native Filters button, the twin of the web leaf
 * (`docs/design/uiOverhaul/buildSpec.md` §4.4): "Filters", or "Filters · 2" while filters are applied (named "Filters,
 * 2 active"), with the sliders glyph. It opens the sheet.
 *
 * Presentational: the Filters button; it reports the press.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import type { FilterTriggerProps } from './filtersModel.js';
import { filterMessages } from './messages.js';

export const FilterTrigger: FC<FilterTriggerProps> = ({ view, onPress }) => {
    const m = useMessages(filterMessages);

    return (
        <Button
            variant="secondary"
            size="sm"
            icon="slidersHorizontal"
            accessibilityLabel={view.triggerLabel}
            onPress={onPress}
        >
            {view.triggerBadge ?? m.filtersButton}
        </Button>
    );
};
