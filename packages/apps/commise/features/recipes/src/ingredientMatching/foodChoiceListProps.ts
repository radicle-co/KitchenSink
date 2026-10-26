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
    /** Search for a food was pressed. Never called while a send is in flight. */
    readonly onSearch: () => void;
    /**
     * An option was pressed: its pick, a food or the line kept as written. Never called while a send is in flight. The
     * host raises its pending send for the line inside this call, in the same event (`PendingSend`).
     */
    readonly onPick: (pick: LinePick) => void;
    /**
     * A request that the list take focus (after the pick on the line before, staff-ux 2026-10-25). It lands on the
     * list's first control — Search, else the first option, else Keep as written (`FoodChoiceListView.focusTarget`) —
     * so it is always taken and acknowledged, offline too.
     */
    readonly focus: ControlFocus;
}
