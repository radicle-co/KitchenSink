/**
 * @module Icon.card — the design-system card of the Icon: every glyph the product uses, named, at 24 px in the ink
 * tone, on both platforms.
 */
import type { IconName } from '@commise/ui/icon-names';

import { defineCard } from '../../../../src/cards/defineCard.js';

// A copy of `ICON_NAMES`, because a card may import product code only as a type (`compileCard.ts`). The
// `satisfies` refuses a name the Registry does not have, and `complete` refuses a Registry name left off the card.
const names = [
    'house',
    'bookOpen',
    'compass',
    'plus',
    'clipboardPaste',
    'ellipsis',
    'chevronLeft',
    'x',
    'search',
    'copyPlus',
    'trash',
    'clock',
    'users',
    'flame',
    'star',
    'lock',
    'globe',
    'pencilLine',
    'timer',
    'sun',
    'check',
    'arrowUp',
    'imagePlus',
    'listPlus',
    'chevronsLeft',
    'slidersHorizontal',
    'rotateCcw',
    'chevronDown',
    'eye',
    'user',
    'minus',
    'chevronRight',
    'chevronUp',
    'refreshCw',
    'logIn',
    'logOut',
    'userPlus',
    'userX',
    'save',
    'settings',
    'camera',
    'image',
    'triangleAlert',
    'info',
    'calendar',
    'shoppingCart',
    'chartColumn',
    'bell',
    'menu',
    'list',
    'layoutGrid',
    'cookingPot',
    'listChecks',
] as const satisfies readonly IconName[];

type MissingFromCard = Exclude<IconName, (typeof names)[number]>;
const complete: [MissingFromCard] extends [never] ? true : MissingFromCard = true;
void complete;

export default defineCard({
    group: 'Media',
    height: 830,
    platforms: 'both',
    uses: ['Icon'],
    render: ({ Icon }) => (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(72px,1fr))', gap: 12 }}>
            {names.map((name) => (
                <div
                    key={name}
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 11,
                        color: 'var(--ink-muted)',
                        textAlign: 'center',
                        overflowWrap: 'anywhere',
                    }}
                >
                    <Icon name={name} size={24} tone="ink" />
                    {name}
                </div>
            ))}
        </div>
    ),
});
