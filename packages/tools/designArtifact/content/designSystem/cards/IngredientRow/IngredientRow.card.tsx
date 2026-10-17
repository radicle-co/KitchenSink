/**
 * @module IngredientRow.card — the design-system card of IngredientRow: six rows covering a plain row, a prep note,
 * variant parts, a working line, two attention lines (one opening the panel, one opening entry) and a failure, on
 * both platforms. The web column lists them in a `ul`, the native column in a `role="list"` view.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;
const focus = { requested: false, onHandled: noop };

function makeRow(number: number, overrides: Record<string, unknown>): Record<string, unknown> {
    return {
        line: { key: `k${String(number)}` },
        index: number - 1,
        number,
        presentation: { tone: 'neutral' },
        body: { kind: 'none' },
        standIn: false,
        displayName: 'Food',
        triggerFood: 'Food',
        variantParts: undefined,
        amountText: '',
        prepText: undefined,
        openLabel: 'Edit',
        secondLine: { kind: 'none' },
        amountInvalidNote: undefined,
        inEntry: false,
        busy: false,
        busyText: undefined,
        pendingText: undefined,
        failure: undefined,
        noFoodNote: undefined,
        labels: { panelClose: 'Close', actionsTrigger: 'Actions', actionsClose: 'Close' },
        actions: [],
        destructiveAction: undefined,
        openFocus: focus,
        actionsFocus: focus,
        onOpen: noop,
        onBeginEntry: noop,
        onFocusLeft: noop,
        onLeaveEntry: noop,
        onRemove: noop,
        ...overrides,
    };
}

function actionsFor(name: string): Record<string, unknown> {
    return {
        labels: { panelClose: 'Close', actionsTrigger: `Actions for ${name}`, actionsClose: 'Close actions' },
        actions: [
            { id: 'e', label: 'Edit amount', icon: 'pencilLine', onSelect: noop },
            { id: 'c', label: 'Change food', icon: 'search', onSelect: noop },
        ],
        destructiveAction: { id: 'rm', label: 'Remove ingredient', icon: 'trash', onSelect: noop },
    };
}

const rows = [
    makeRow(1, {
        displayName: 'all-purpose flour',
        amountText: '2 cups',
        prepText: 'sifted',
        openLabel: 'Edit 2 cups all-purpose flour',
        ...actionsFor('all-purpose flour'),
    }),
    makeRow(2, {
        displayName: 'smoked paprika',
        amountText: '1 tsp',
        openLabel: 'Edit 1 tsp smoked paprika',
        variantParts: ['Hungarian', 'sweet'],
        ...actionsFor('smoked paprika'),
    }),
    makeRow(3, {
        displayName: 'olive oil',
        amountText: '2–3 tbsp',
        openLabel: 'Edit 2–3 tbsp olive oil',
        secondLine: { kind: 'working', text: 'Looking up nutrition' },
        ...actionsFor('olive oil'),
    }),
    makeRow(4, {
        displayName: 'tomatoes',
        amountText: '400 g',
        openLabel: 'Edit 400 g tomatoes',
        presentation: { tone: 'caution' },
        secondLine: {
            kind: 'attention',
            text: 'Choose the right tomatoes',
            label: 'Choose the right tomatoes for tomatoes',
            opens: 'panel',
        },
        ...actionsFor('tomatoes'),
    }),
    makeRow(5, {
        displayName: 'a pinch of saffron',
        amountText: '',
        openLabel: 'Edit a pinch of saffron',
        presentation: { tone: 'caution' },
        secondLine: {
            kind: 'attention',
            text: 'Find a food',
            label: 'Find a food for a pinch of saffron',
            opens: 'entry',
        },
        ...actionsFor('saffron'),
    }),
    makeRow(6, {
        displayName: 'garlic',
        amountText: '3 cloves',
        openLabel: 'Edit 3 cloves garlic',
        failure: 'Could not save this food. Try again.',
        ...actionsFor('garlic'),
    }),
];

const entryCopy = { form: {} };
const panel = (): React.ReactNode => (
    <div style={{ padding: 12, fontSize: 14 }}>Pick one: plum tomatoes, cherry tomatoes</div>
);
const listStyle = { listStyle: 'none', margin: 0, padding: 0, maxWidth: 358 } as const;

export default defineCard({
    group: 'Editor',
    height: 520,
    platforms: 'both',
    uses: ['IngredientRow'],
    render: ({ IngredientRow }) => (
        <ul style={listStyle}>
            {rows.map((row, index) => (
                <IngredientRow
                    key={index}
                    row={row}
                    entryCopy={entryCopy}
                    panel={panel}
                    inlineEditor={null}
                    expanded={undefined}
                    arrived={index === 1}
                />
            ))}
        </ul>
    ),
    // The native row also takes its message set (`m`), a screen-reader announcer (`speak`) and the width of the amount
    // column the list measured (`amountColumn`); the web row takes none of them.
    renderNative: ({ IngredientRow }) => (
        <div role="list" style={listStyle}>
            {rows.map((row, index) => (
                <IngredientRow
                    key={index}
                    row={row}
                    m={{}}
                    entryCopy={entryCopy}
                    speak={(text: string) => text}
                    panel={panel}
                    inlineEditor={null}
                    expanded={undefined}
                    amountColumn={72}
                    arrived={index === 1}
                />
            ))}
        </div>
    ),
});
