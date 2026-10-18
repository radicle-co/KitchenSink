/**
 * @module IngredientRow.card — the design-system card of IngredientRow: six rows covering a plain row, a prep note,
 * variant parts, a working line, two attention lines (one opening the panel, one opening entry) and a failure, on
 * both platforms. The web column lists them in a `ul`, the native column in a `role="list"` view.
 */
import type { CardUi } from '../../../../src/cards/cardComponents.js';
import { defineCard } from '../../../../src/cards/defineCard.js';

import { rowViews } from './rowViews.js';

/** The copy the row's entry field reads: the product's own sets, so the card holds no sentence of its own. */
const entryCopyOf = ({
    offlineNoticeMessages,
    recipeFormMessages,
    recipeMessages,
}: CardUi<'offlineNoticeMessages' | 'recipeFormMessages' | 'recipeMessages'>) => ({
    form: recipeFormMessages.en,
    search: recipeMessages.en.ingredientSearch,
    pickerSearch: recipeMessages.en.ingredientPickerSearch,
    remote: recipeMessages.en.ingredientRemoteSearch,
    details: recipeMessages.en.ingredientDetails,
    readOffline: offlineNoticeMessages.en.readOffline,
});

const panel = (): React.ReactNode => (
    <div style={{ padding: 12, fontSize: 14 }}>Pick one: plum tomatoes, cherry tomatoes</div>
);
const listStyle = { listStyle: 'none', margin: 0, padding: 0, maxWidth: 358 } as const;

export default defineCard({
    group: 'Editor',
    height: 560,
    platforms: 'both',
    // The product's own copy and line-key factory come from the surface: a card may not import product values, and
    // the copy is hundreds of sentences it must not duplicate (`surface/productSurface.ts` `SURFACE_VALUES`).
    uses: ['IngredientRow', 'offlineNoticeMessages', 'recipeFormMessages', 'recipeMessages', 'seedLineKey'],
    render: ({ IngredientRow, offlineNoticeMessages, recipeFormMessages, recipeMessages, seedLineKey }) => {
        const entryCopy = entryCopyOf({ offlineNoticeMessages, recipeFormMessages, recipeMessages });

        return (
            <ul style={listStyle}>
                {rowViews(seedLineKey).map((row, index) => (
                    <IngredientRow
                        key={row.line.key}
                        row={row}
                        entryCopy={entryCopy}
                        panel={panel}
                        inlineEditor={null}
                        expanded={undefined}
                        arrived={index === 1}
                    />
                ))}
            </ul>
        );
    },
    // The native row also takes its message set (`m`), a screen-reader announcer (`speak`) and the width of the amount
    // column the list measured (`amountColumn`); the web row takes none of them.
    renderNative: ({ IngredientRow, offlineNoticeMessages, recipeFormMessages, recipeMessages, seedLineKey }) => {
        const entryCopy = entryCopyOf({ offlineNoticeMessages, recipeFormMessages, recipeMessages });

        return (
            <div role="list" style={listStyle}>
                {rowViews(seedLineKey).map((row, index) => (
                    <IngredientRow
                        key={row.line.key}
                        row={row}
                        m={recipeFormMessages.en}
                        entryCopy={entryCopy}
                        panel={panel}
                        inlineEditor={null}
                        expanded={undefined}
                        amountColumn={72}
                        arrived={index === 1}
                    />
                ))}
            </div>
        );
    },
});
