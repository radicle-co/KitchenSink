/**
 * Component tests for the NATIVE Ingredients section's PASTE LIST (blueprint A2; ADR-0071; owner rulings 2026-10-25),
 * rendered via react-native-web under jsdom: the one-for-one mirror of `RecipeIngredientsFields.paste.test.tsx` (§14 asks
 * the same assertions of both leaves). The overlay-owned draft lines are drawn through `MatchLineList` (and
 * `PasteChoicePane` at the wide class), every other line as an ordinary row, and NO LINE TWICE. Native's own cases: the
 * screen-reader cursor (`sendAccessibilityEvent`) stands where web's DOM focus does, and the pane carries no name of its
 * own (`docs/design/nativeContainerNames.md` N1). Seen red first.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { useState, type FC } from 'react';
import { AccessibilityInfo } from 'react-native';

import type { ContainerClass } from '@commise/ui/container-class';

const layout = vi.hoisted(() => ({ container: 'narrow' as ContainerClass }));

vi.mock('../../layout/useMainContainerClass.native.js', () => ({ useMainContainerClass: () => layout.container }));
vi.mock('../../hooks/ingredientSuggestionSource.js', () => ({
    useIngredientSuggestionSource: () => ({
        read: { kind: 'asking', resumed: false, answer: { database: undefined, sources: [], complete: false } },
        refetch: () => undefined,
    }),
}));
// react-native-web does not implement `sendAccessibilityEvent`; the cursor move is asserted as the call it makes.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

import { makePasteMatching } from '../../__fixtures__/pasteMatching.js';
import {
    makeIngredientNutrition,
    makeIngredientRowEditor,
    makeLookupRetry,
    withLineKeys,
} from '../../__fixtures__/index.js';
import type { PasteQuota } from '../../editor/usePasteIntoIngredients.js';
import type { PasteMatching } from '../../editor/usePasteMatching.js';
import { usePasteMatchView } from '../../editor/usePasteMatchView.js';
import {
    cookPicked,
    makeCheckingLine,
    makeConfidentLine,
    makeDefaultLine,
    makeNeedsChoiceLine,
    makeNoMatchLine,
    makeOptionsFailedLine,
} from '../../ingredientMatching/__fixtures__/matchLines.js';
import type { MatchLine, PendingSend } from '../../ingredientMatching/matchLine.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeIngredientsFields } from '../RecipeIngredientsFields.native.js';
import type { IngredientsPasteView } from '../props.js';
import { defaultRecipeFormValues } from '../values.js';

beforeEach(() => {
    layout.container = 'narrow';
});
afterEach(() => {
    cleanup();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

/** The draft: an ordinary line, then the two lines the paste list owns, then another ordinary line. */
const VALUES = {
    ...defaultRecipeFormValues(),
    ingredients: withLineKeys([
        { ingredientId: 'ing_flour', name: 'Plain flour', quantity: 200, unit: 'g', isUserEntered: false },
        { ingredientId: 'ing_milk', name: 'milk', quantity: 2, unit: 'cups', isUserEntered: false },
        { ingredientId: 'ing_eggs', name: 'eggs', quantity: 2, isUserEntered: false },
        { ingredientId: 'ing_butter', name: 'Salted butter', quantity: 50, unit: 'g', isUserEntered: false },
    ]),
};
const MILK_DRAFT = 'v1.1';
const EGGS_DRAFT = 'v1.2';

const BASE_PASTE: IngredientsPasteView = {
    reading: [],
    progress: undefined,
    onRetryLookup: vi.fn(),
    onRetryParse: vi.fn(),
    onAddAsWritten: vi.fn(),
    onAddRestAsWritten: vi.fn(),
    focusSignal: 0,
    retryFailed: false,
    focusRow: undefined,
    onRowFocusHandled: vi.fn(),
    announcement: undefined,
    added: undefined,
    onOpen: undefined,
};

interface HarnessProps {
    readonly matching: PasteMatching;
    readonly offline?: boolean;
    readonly quota?: PasteQuota;
}

const Harness: FC<HarnessProps> = ({ matching, offline = false, quota }) => {
    const presentation = usePasteMatchView({
        matching,
        lineCount: VALUES.ingredients.length,
        keep: 'disk',
        quota,
        offline,
    });

    return (
        <RecipeIngredientsFields
            values={VALUES}
            onChange={vi.fn()}
            nutrition={makeIngredientNutrition()}
            lookupRetry={makeLookupRetry()}
            rowEditor={makeIngredientRowEditor()}
            paste={{ ...BASE_PASTE, matching: presentation.view }}
        />
    );
};

/** A Mediator holding `lines`, with milk and eggs as the draft lines the paste list owns. */
const matchingOf = (lines: readonly MatchLine[], over: Partial<PasteMatching> = {}): PasteMatching =>
    makePasteMatching({
        lines,
        drawn: lines,
        ownedKeys: new Set(lines.map((_line, index) => (index === 0 ? MILK_DRAFT : EGGS_DRAFT))),
        pick: vi.fn(),
        useProposal: vi.fn(),
        retryPick: vi.fn(),
        retryOptions: vi.fn(),
        search: vi.fn(),
        expandTo: vi.fn(),
        moveTo: vi.fn(),
        ...over,
    });

const press = (name: string | RegExp): void => {
    fireEvent.click(screen.getByRole('button', { name }));
};

const cursor = () => vi.mocked(AccessibilityInfo.sendAccessibilityEvent);

const MILK_OPEN = makeDefaultLine();
const EGGS_BOUND = makeConfidentLine();

describe('the Ingredients section draws the paste list (native)', () => {
    it('⛔ draws an overlay-owned line once, through the matched list, and every other line as an ordinary row', () => {
        render(<Harness matching={matchingOf([MILK_OPEN, EGGS_BOUND])} />);

        expect(screen.getByText('Plain flour')).toBeTruthy();
        expect(screen.getByText('Salted butter')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^Edit .*milk/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Edit .*eggs/ })).toBeNull();
        expect(screen.getAllByText('eggs')).toHaveLength(1);
        expect(screen.getAllByText('milk')).toHaveLength(1);
    });

    it('draws no matched list, summary or notice when the paste owns nothing', () => {
        render(<Harness matching={matchingOf([], { ownedKeys: new Set() })} />);

        expect(screen.getByText('Plain flour')).toBeTruthy();
        expect(screen.queryByText(/Added \d+ lines?/u)).toBeNull();
        expect(screen.queryByText(/offline|added a lot today/u)).toBeNull();
    });
});

describe('every state of a matched line, through the section (native)', () => {
    it('matched: arrives bound, with Change', () => {
        render(<Harness matching={matchingOf([EGGS_BOUND])} />);

        expect(screen.getByText('Egg, whole, raw')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Change the food for eggs' })).toBeTruthy();
    });

    it('⛔ a default shows its Default tag and NOTHING is chosen', () => {
        render(<Harness matching={matchingOf([MILK_OPEN])} />);

        expect(screen.getByText('Choose the milk you use')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Whole milk, Default' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /, chosen$/ })).toBeNull();
        expect(screen.queryByText(/your choice/u)).toBeNull();
    });

    it('needsChoice: says nothing is chosen for the cook, and offers Search and Keep as written', () => {
        render(<Harness matching={matchingOf([makeNeedsChoiceLine()])} />);

        expect(screen.getByText('More than one food fits. Nothing is chosen for you.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Search for a food for 6 slices day-old bread' })).toBeTruthy();
        expect(screen.getByRole('button', { name: /^Keep .*as written/ })).toBeTruthy();
    });

    it('noMatch: says no food was found, and still offers Search', () => {
        render(<Harness matching={matchingOf([makeNoMatchLine()])} />);

        expect(screen.getByText('No food found for this')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Search for a food for 1 tsp spice mix' })).toBeTruthy();
    });

    it('checking: names the proposal with Use this, and reaches Search in one tap', () => {
        render(<Harness matching={matchingOf([makeCheckingLine()])} />);

        expect(screen.getByText('Checking')).toBeTruthy();
        expect(screen.getByRole('button', { name: /^Use this: Heavy whipping cream/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Search for a food for 1/2 cup heavy cream' })).toBeTruthy();
    });

    it('optionsFailed: says the options did not load, and offers Try again', () => {
        render(<Harness matching={matchingOf([makeOptionsFailedLine()])} />);

        expect(screen.getByText('We couldn’t load the options for this line.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Try again to load the options for 2 cups milk' })).toBeTruthy();
    });

    it('⛔ a late review note sits beside the cook’s pick, with See why; the pick stays', () => {
        const note = {
            suggestedFood: 'Butter, salted',
            reason: 'Our check read the line and agreed that this is the food.',
        };
        const line = makeDefaultLine({
            binding: cookPicked({ id: 'skim', name: 'Skim milk', isDefault: false }, note),
        });

        render(<Harness matching={matchingOf([line])} />);

        expect(screen.getByText(/Skim milk\s+· your choice/u)).toBeTruthy();
        expect(screen.getByText('Our check suggested Butter, salted. Your choice stays.')).toBeTruthy();

        press(/^See why our check suggested Butter, salted/);

        expect(screen.getByText(note.reason)).toBeTruthy();
    });
});

describe('the summary and the notices (native)', () => {
    it('counts what was added and what is matched, to choose and being checked', () => {
        render(<Harness matching={matchingOf([EGGS_BOUND, MILK_OPEN, makeCheckingLine()])} />);

        expect(screen.getByText('Added 3 lines')).toBeTruthy();
        expect(screen.getByText(/1 matched\s·\s1 to choose\s·\s1 being checked\./u)).toBeTruthy();
    });

    it('offline: says the check waits and where the choices are kept (on this device)', () => {
        render(<Harness matching={matchingOf([MILK_OPEN])} offline />);

        expect(screen.getByText(/You’re offline\. Your choices are saved on this device/u)).toBeTruthy();
        expect(screen.getByText('Search needs the network')).toBeTruthy();
    });

    it('⛔ the daily limit says when matching starts again, and keeps drawing the lines already added', () => {
        render(
            <Harness
                matching={matchingOf([], { ownedKeys: new Set() })}
                quota={{ resetsAt: '2026-10-27T08:00:00.000Z' }}
            />,
        );

        expect(screen.getByText(/You’ve added a lot today\. Matching starts again at/u)).toBeTruthy();
        expect(screen.getByText('Plain flour')).toBeTruthy();
    });
});

describe('what the cook presses reaches the Mediator, with the line’s key (native)', () => {
    it('a food in the open list is picked; Keep as written is picked as written', () => {
        const pick = vi.fn();

        render(<Harness matching={matchingOf([MILK_OPEN], { pick })} />);

        press('Skim milk');
        expect(pick).toHaveBeenLastCalledWith('milk', { kind: 'food', foodId: 'skim', name: 'Skim milk' }, 'narrow');

        press(/^Keep .*as written/);
        expect(pick).toHaveBeenLastCalledWith('milk', { kind: 'asWritten' }, 'narrow');
    });

    it('Search for a food, Use this and Try again reach their handlers', () => {
        const search = vi.fn();
        const useProposal = vi.fn();
        const retryOptions = vi.fn();

        render(
            <Harness
                matching={matchingOf([makeCheckingLine(), makeOptionsFailedLine()], {
                    search,
                    useProposal,
                    retryOptions,
                })}
            />,
        );

        press('Search for a food for 1/2 cup heavy cream');
        press(/^Use this: Heavy whipping cream/);
        press('Try again to load the options for 2 cups milk');

        expect(search).toHaveBeenCalledWith('cream');
        expect(useProposal).toHaveBeenCalledWith('cream', 'narrow');
        expect(retryOptions).toHaveBeenCalledWith('milk');
    });

    it('opening a collapsed line below the wide class expands it', () => {
        const expandTo = vi.fn();

        render(<Harness matching={matchingOf([makeNeedsChoiceLine(), MILK_OPEN], { expandTo })} />);

        press(/Choose the milk you use/);

        expect(expandTo).toHaveBeenCalledWith('milk');
    });
});

describe('sends in flight and failed (native)', () => {
    const SKIM: PendingSend = { kind: 'pick', pick: { kind: 'food', foodId: 'skim', name: 'Skim milk' } };

    it('a pick in flight reads busy on its option, and the line refuses a second press', () => {
        const pick = vi.fn();

        render(<Harness matching={matchingOf([MILK_OPEN], { pending: new Map([['milk', SKIM]]), pick })} />);

        expect(screen.getByRole('button', { name: 'Skim milk' }).getAttribute('aria-busy')).toBe('true');

        press('Oat milk, unsweetened');

        expect(pick).not.toHaveBeenCalled();
    });

    it('a pick that did not save says so with Try again, which repeats it', () => {
        const retryPick = vi.fn();

        render(<Harness matching={matchingOf([MILK_OPEN], { failed: new Set(['milk']), retryPick })} />);

        expect(screen.getByText('We couldn’t save that choice.')).toBeTruthy();

        press('Try again to save the choice for 2 cups milk');

        expect(retryPick).toHaveBeenCalledWith('milk', 'narrow');
    });
});

describe('Try again keeps its promise to the cook who pressed it (native, host gap rule 1)', () => {
    const SKIM: PendingSend = { kind: 'pick', pick: { kind: 'food', foodId: 'skim', name: 'Skim milk' } };
    const FAILED = new Set(['milk']);
    const RETRY = 'Try again to save the choice for 2 cups milk';
    const lines = [makeCheckingLine(), MILK_OPEN];
    const withMilk = (state: Partial<PasteMatching>) => matchingOf(lines, { ...state, retryPick: vi.fn() });

    it('⛔ pressing Try again moves the cursor to the option being retried; a retry that fails again returns to Try again', () => {
        const { rerender } = render(<Harness matching={withMilk({ failed: FAILED })} />);

        press(RETRY);
        cursor().mockClear();
        rerender(<Harness matching={withMilk({ failed: FAILED, pending: new Map([['milk', SKIM]]) })} />);

        expect(cursor()).toHaveBeenCalledWith(screen.getByRole('button', { name: 'Skim milk' }), 'focus');

        cursor().mockClear();
        rerender(<Harness matching={withMilk({ failed: FAILED })} />);

        expect(cursor()).toHaveBeenCalledWith(screen.getByRole('button', { name: RETRY }), 'focus');
    });

    it('⛔ a retry that fails again after the cook acted on ANOTHER line does not move the cursor back', () => {
        const { rerender } = render(<Harness matching={withMilk({ failed: FAILED })} />);

        press(RETRY);
        rerender(<Harness matching={withMilk({ failed: FAILED, pending: new Map([['milk', SKIM]]) })} />);
        press('Search for a food for 1/2 cup heavy cream');
        cursor().mockClear();
        rerender(<Harness matching={withMilk({ failed: FAILED })} />);

        expect(cursor()).not.toHaveBeenCalledWith(screen.getByRole('button', { name: RETRY }), 'focus');
    });
});

describe('the side pane at the wide class (native)', () => {
    it('⛔ stands beside the list, shows the first open line out of all of them, and steps with Next', () => {
        layout.container = 'wide';
        const moveTo = vi.fn();

        render(<Harness matching={matchingOf([EGGS_BOUND, MILK_OPEN, makeNeedsChoiceLine()], { moveTo })} />);

        expect(screen.getByText('Line 2 of 3')).toBeTruthy();

        press('Next open line');

        expect(moveTo).toHaveBeenCalledWith('bread');
    });

    it('below the wide class there is no pane', () => {
        render(<Harness matching={matchingOf([EGGS_BOUND, MILK_OPEN])} />);

        expect(screen.queryByText('Line 2 of 2')).toBeNull();
    });
});

describe('where the cursor goes once a pick saves (native, host gap rule 3)', () => {
    const SKIM_PICKED = makeDefaultLine({ binding: cookPicked({ id: 'skim', name: 'Skim milk', isDefault: false }) });

    /** A Mediator that saves a pick the way `usePasteMatching` does: the line re-draws bound and the save is marked. */
    const Saving: FC<{
        readonly others?: readonly MatchLine[];
        readonly expandTo?: (key: string | undefined) => void;
    }> = ({ others = [], expandTo = vi.fn() }) => {
        const [save, setSave] = useState<{ readonly tag: string | undefined; readonly seq: number } | undefined>(
            undefined,
        );

        return (
            <Harness
                matching={matchingOf([save === undefined ? MILK_OPEN : SKIM_PICKED, ...others], {
                    expandTo,
                    saved: save === undefined ? undefined : { key: 'milk', tag: save.tag, seq: save.seq },
                    pick: (_key, _pick, tag) => setSave({ tag, seq: (save?.seq ?? 0) + 1 }),
                })}
            />
        );
    };

    it('⛔ below the wide class the next open line opens', () => {
        const expandTo = vi.fn();

        render(<Saving others={[makeNeedsChoiceLine()]} expandTo={expandTo} />);
        press('Skim milk');

        expect(expandTo).toHaveBeenLastCalledWith('bread');
    });

    it('with no open line left the cursor goes to the summary', () => {
        render(<Saving />);
        cursor().mockClear();
        press('Skim milk');

        const [node] = cursor().mock.calls.at(-1) ?? [];

        expect(cursor().mock.calls.at(-1)?.[1]).toBe('focus');
        expect((node as unknown as HTMLElement).textContent).toContain('Added 1 line');
    });
});
