/**
 * @module @commise/features-recipes/ingredientMatching — the contract `FoodChoiceList`'s web and native leaves share:
 * the ONE list a line's food is chosen from, in both flows — inline on the open line (phone and 834), the side pane
 * (1194 and web), and a flagged line's sheet and pane.
 */
import type { ControlFocus } from '../common/controlFocus.js';
import type { LinePick } from './matchLine.js';
import type { FoodChoiceListView } from './matchLineView.js';

/** Props for `FoodChoiceList`. */
export interface FoodChoiceListProps {
    /** What the list shows (`choiceListViewOf`): search, the options, Keep as written. Its prompt is the host's. */
    readonly view: FoodChoiceListView;
    /** Search for a food was pressed. */
    readonly onSearch: () => void;
    /** An option was pressed: its pick, a food or the line kept as written. Never called while a pick is in flight. */
    readonly onPick: (pick: LinePick) => void;
    /** A request that Search for a food take focus (after the pick on the line before, staff-ux 2026-10-25). */
    readonly searchFocus: ControlFocus;
}
