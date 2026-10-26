// @vitest-environment jsdom
/**
 * Component tests for the WEB Ingredients section's PASTE LIST (blueprint A2; ADR-0071; owner rulings 2026-10-25): the
 * overlay-owned draft lines are drawn through `MatchLineList` (and `PasteChoicePane` at the wide class), every other line
 * as an ordinary row, and NO LINE TWICE; the summary and the notice stand around them. Seen red first.
 *
 * The host's view (`usePasteMatchView`) is the REAL one, over a doubled Mediator, so the tests run the same props the
 * editor does: they can press a control and read the handler the Mediator received, or change the Mediator's state and
 * read what focus does. Each state of a matched line is drawn here through the Ingredients section, which is the only
 * place the paste list and the ordinary rows meet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';

import type { ContainerClass } from '@commise/ui/container-class';

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
import { RecipeIngredientsFields } from '../RecipeIngredientsFields.js';
import type { IngredientsPasteView } from '../props.js';
import { defaultRecipeFormValues } from '../values.js';

const layout = vi.hoisted(() => ({ container: 'narrow' as ContainerClass }));

vi.mock('../../layout/useMainContainerClass.js', () => ({ useMainContainerClass: () => layout.container }));
vi.mock('../../hooks/ingredientSuggestionSource.js', () => ({
    useIngredientSuggestionSource: () => ({
        read: { kind: 'asking', resumed: false, answer: { database: undefined, sources: [], complete: false } },
        refetch: () => undefined,
    }),
}));

beforeEach(() => {
    layout.container = 'narrow';
});
afterEach(cleanup);

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
        keep: 'tabSession',
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

const MILK_OPEN = makeDefaultLine();
const EGGS_BOUND = makeConfidentLine();

describe('the Ingredients section draws the paste list (web)', () => {
    it('⛔ draws an overlay-owned line once, through the matched list, and every other line as an ordinary row', () => {
        render(<Harness matching={matchingOf([MILK_OPEN, EGGS_BOUND])} />);

        // The ordinary rows: the lines the paste list does not own.
        expect(screen.getByText('Plain flour')).toBeTruthy();
        expect(screen.getByText('Salted butter')).toBeTruthy();
        // The owned lines are NOT ordinary rows: the draft's own names ("milk", "eggs") do not appear as rows, and each
        // line's text is drawn by the matched list once.
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

    it('a section whose every line the paste list owns has no empty ordinary list', () => {
        const owned = {
            ...VALUES,
            ingredients: VALUES.ingredients.slice(1, 3),
        };

        const Whole: FC = () => {
            const presentation = usePasteMatchView({
                matching: matchingOf([MILK_OPEN, EGGS_BOUND], {
                    ownedKeys: new Set(owned.ingredients.map((line) => line.key)),
                }),
                lineCount: owned.ingredients.length,
                keep: 'tabSession',
                quota: undefined,
                offline: false,
            });

            return (
                <RecipeIngredientsFields
                    values={owned}
                    onChange={vi.fn()}
                    nutrition={makeIngredientNutrition()}
                    lookupRetry={makeLookupRetry()}
                    rowEditor={makeIngredientRowEditor()}
                    paste={{ ...BASE_PASTE, matching: presentation.view }}
                />
            );
        };

        render(<Whole />);

        expect(screen.queryByRole('list', { name: 'Ingredients' })).toBeNull();
        expect(screen.getAllByText('eggs')).toHaveLength(1);
    });
});

describe('the paste still matching (web)', () => {
    it('⛔ draws the lines already matched, then the lines still being read, each line once', () => {
        const Reading: FC = () => {
            const presentation = usePasteMatchView({
                matching: matchingOf([EGGS_BOUND]),
                lineCount: VALUES.ingredients.length,
                keep: 'tabSession',
                quota: undefined,
                offline: false,
            });

            return (
                <RecipeIngredientsFields
                    values={VALUES}
                    onChange={vi.fn()}
                    nutrition={makeIngredientNutrition()}
                    lookupRetry={makeLookupRetry()}
                    rowEditor={makeIngredientRowEditor()}
                    paste={{
                        ...BASE_PASTE,
                        matching: presentation.view,
                        reading: [{ key: 'j:1', lineIndex: 1, sourceLine: '1 tsp salt', state: 'reading' }],
                        progress: {
                            done: 1,
                            count: 2,
                            status: { kind: 'step', step: 'reading', position: 2 },
                            retryCount: 0,
                            restCount: 0,
                        },
                    }}
                />
            );
        };

        render(<Reading />);

        expect(screen.getByText('Egg, whole, raw')).toBeTruthy();
        expect(screen.getAllByText('1 tsp salt')).toHaveLength(1);
        expect(screen.getByText('Added 1 line')).toBeTruthy();
    });
});

describe('every state of a matched line, through the section (web)', () => {
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

    it('optionsFailed: says the options did not load, and offers Try again, Search and Keep as written', () => {
        render(<Harness matching={matchingOf([makeOptionsFailedLine()])} />);

        expect(screen.getByText('We couldn’t load the options for this line.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Try again to load the options for 2 cups milk' })).toBeTruthy();
    });

    it('⛔ a late review note sits beside the cook’s pick, with See why; the pick stays', async () => {
        const user = userEvent.setup();
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

        await user.click(screen.getByRole('button', { name: /^See why our check suggested Butter, salted/ }));

        // The reason is said in the list's one polite region.
        expect(await screen.findByText(note.reason)).toBeTruthy();
    });
});

describe('the summary and the notices (web)', () => {
    it('counts what was added and what is matched, to choose and being checked', () => {
        render(<Harness matching={matchingOf([EGGS_BOUND, MILK_OPEN, makeCheckingLine()])} />);

        expect(screen.getByText('Added 3 lines')).toBeTruthy();
        expect(screen.getByText(/1 matched\s·\s1 to choose\s·\s1 being checked\./u)).toBeTruthy();
    });

    it('offline: says the check waits and where the choices are kept', () => {
        render(<Harness matching={matchingOf([MILK_OPEN])} offline />);

        expect(screen.getByText(/You’re offline\. Your choices are kept in this tab/u)).toBeTruthy();
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

describe('what the cook presses reaches the Mediator, with the line’s key (web)', () => {
    it('a food in the open list is picked; Keep as written is picked as written', async () => {
        const user = userEvent.setup();
        const pick = vi.fn();

        render(<Harness matching={matchingOf([MILK_OPEN], { pick })} />);

        await user.click(screen.getByRole('button', { name: 'Skim milk' }));
        expect(pick).toHaveBeenLastCalledWith('milk', { kind: 'food', foodId: 'skim', name: 'Skim milk' }, 'narrow');

        await user.click(screen.getByRole('button', { name: /^Keep .*as written/ }));
        expect(pick).toHaveBeenLastCalledWith('milk', { kind: 'asWritten' }, 'narrow');
    });

    it('Search for a food, Use this and Try again reach their handlers', async () => {
        const user = userEvent.setup();
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

        await user.click(screen.getByRole('button', { name: 'Search for a food for 1/2 cup heavy cream' }));
        await user.click(screen.getByRole('button', { name: /^Use this: Heavy whipping cream/ }));
        await user.click(screen.getByRole('button', { name: 'Try again to load the options for 2 cups milk' }));

        expect(search).toHaveBeenCalledWith('cream');
        expect(useProposal).toHaveBeenCalledWith('cream', 'narrow');
        expect(retryOptions).toHaveBeenCalledWith('milk');
    });

    it('opening a collapsed line below the wide class expands it', async () => {
        const user = userEvent.setup();
        const expandTo = vi.fn();

        render(<Harness matching={matchingOf([makeNeedsChoiceLine(), MILK_OPEN], { expandTo })} />);

        await user.click(screen.getByRole('button', { name: /Choose the milk you use/ }));

        expect(expandTo).toHaveBeenCalledWith('milk');
    });
});

describe('sends in flight and failed (web)', () => {
    const SKIM: PendingSend = { kind: 'pick', pick: { kind: 'food', foodId: 'skim', name: 'Skim milk' } };

    it('a pick in flight reads busy on its option, and the line refuses a second press', async () => {
        const user = userEvent.setup();
        const pick = vi.fn();

        render(<Harness matching={matchingOf([MILK_OPEN], { pending: new Map([['milk', SKIM]]), pick })} />);
        const skim = screen.getByRole('button', { name: 'Skim milk' });

        expect(skim.getAttribute('aria-busy')).toBe('true');

        await user.click(screen.getByRole('button', { name: 'Oat milk, unsweetened' }));

        expect(pick).not.toHaveBeenCalled();
    });

    it('a pick that did not save says so with Try again, which repeats it', async () => {
        const user = userEvent.setup();
        const retryPick = vi.fn();

        render(<Harness matching={matchingOf([MILK_OPEN], { failed: new Set(['milk']), retryPick })} />);

        expect(screen.getByText('We couldn’t save that choice.')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Try again to save the choice for 2 cups milk' }));

        expect(retryPick).toHaveBeenCalledWith('milk', 'narrow');
    });
});

describe('Try again keeps its promise to the cook who pressed it (web, host gap rule 1)', () => {
    const SKIM: PendingSend = { kind: 'pick', pick: { kind: 'food', foodId: 'skim', name: 'Skim milk' } };
    const FAILED = new Set(['milk']);
    const RETRY = 'Try again to save the choice for 2 cups milk';
    const lines = [makeCheckingLine(), MILK_OPEN];

    /** The Mediator with the milk line in a given send state. */
    const withMilk = (state: Partial<PasteMatching>) => matchingOf(lines, { ...state, retryPick: vi.fn() });

    it('⛔ pressing Try again lands focus on the option being retried; a retry that fails again returns to Try again', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<Harness matching={withMilk({ failed: FAILED })} />);

        await user.click(screen.getByRole('button', { name: RETRY }));
        rerender(<Harness matching={withMilk({ failed: FAILED, pending: new Map([['milk', SKIM]]) })} />);

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Skim milk' }));

        rerender(<Harness matching={withMilk({ failed: FAILED })} />);

        expect(document.activeElement).toBe(screen.getByRole('button', { name: RETRY }));
    });

    it('⛔ a retry that fails again after the cook acted on ANOTHER line does not pull focus back', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<Harness matching={withMilk({ failed: FAILED })} />);

        await user.click(screen.getByRole('button', { name: RETRY }));
        rerender(<Harness matching={withMilk({ failed: FAILED, pending: new Map([['milk', SKIM]]) })} />);
        // The cook goes to the cream line and acts there.
        await user.click(screen.getByRole('button', { name: 'Search for a food for 1/2 cup heavy cream' }));
        rerender(<Harness matching={withMilk({ failed: FAILED })} />);

        expect(document.activeElement).not.toBe(screen.getByRole('button', { name: RETRY }));
    });
});

describe('the side pane at the wide class (web)', () => {
    it('⛔ stands beside the list, shows the first open line out of all of them, and steps with Next', async () => {
        layout.container = 'wide';
        const user = userEvent.setup();
        const moveTo = vi.fn();

        render(<Harness matching={matchingOf([EGGS_BOUND, MILK_OPEN, makeNeedsChoiceLine()], { moveTo })} />);
        const pane = screen.getByRole('complementary', { name: 'Choose a food' });

        expect(within(pane).getByText('Line 2 of 3')).toBeTruthy();
        expect(within(pane).getByRole('heading', { name: '2 cups milk' })).toBeTruthy();

        await user.click(within(pane).getByRole('button', { name: 'Next open line' }));

        expect(moveTo).toHaveBeenCalledWith('bread');
    });

    it('below the wide class there is no pane', () => {
        render(<Harness matching={matchingOf([EGGS_BOUND, MILK_OPEN])} />);

        expect(screen.queryByRole('complementary', { name: 'Choose a food' })).toBeNull();
    });

    it('a pick in the pane reaches the Mediator for the line the pane shows', async () => {
        layout.container = 'wide';
        const user = userEvent.setup();
        const pick = vi.fn();

        render(<Harness matching={matchingOf([MILK_OPEN], { pick })} />);
        await user.click(
            within(screen.getByRole('complementary', { name: 'Choose a food' })).getByRole('button', {
                name: 'Skim milk',
            }),
        );

        expect(pick).toHaveBeenCalledWith('milk', { kind: 'food', foodId: 'skim', name: 'Skim milk' }, 'wide');
    });
});

describe('where focus goes once a pick saves (web, host gap rule 3)', () => {
    const SKIM_PICKED = makeDefaultLine({ binding: cookPicked({ id: 'skim', name: 'Skim milk', isDefault: false }) });

    /**
     * A Mediator that saves a pick the way `usePasteMatching` does: the line re-draws bound and the save is marked, in one
     * event. `saved` moves at each save; `tag` is what the press gave the pick.
     */
    const Saving: FC<{
        readonly others?: readonly MatchLine[];
        readonly expandTo?: (key: string | undefined) => void;
        readonly onPick?: (tag: string | undefined) => void;
    }> = ({ others = [], expandTo = vi.fn(), onPick }) => {
        const [save, setSave] = useState<{ readonly tag: string | undefined; readonly seq: number } | undefined>(
            undefined,
        );

        return (
            <Harness
                matching={matchingOf([save === undefined ? MILK_OPEN : SKIM_PICKED, ...others], {
                    expandTo,
                    saved: save === undefined ? undefined : { key: 'milk', tag: save.tag, seq: save.seq },
                    pick: (_key, _pick, tag) => {
                        onPick?.(tag);
                        setSave({ tag, seq: (save?.seq ?? 0) + 1 });
                    },
                })}
            />
        );
    };

    it('⛔ below the wide class the next open line opens and its first control is asked for focus', async () => {
        const user = userEvent.setup();
        const expandTo = vi.fn();

        render(<Saving others={[makeNeedsChoiceLine()]} expandTo={expandTo} />);
        await user.click(screen.getByRole('button', { name: 'Skim milk' }));

        expect(expandTo).toHaveBeenLastCalledWith('bread');
    });

    it('with no open line left the summary takes focus, once the chosen line has re-drawn bound', async () => {
        const user = userEvent.setup();

        render(<Saving />);
        await user.click(screen.getByRole('button', { name: 'Skim milk' }));

        expect(document.activeElement).toBe(screen.getByText('Added 1 line').closest('[tabindex="-1"]'));
    });

    it('⛔ at the wide class the pane stays on the line: nothing moves on by itself', async () => {
        layout.container = 'wide';
        const user = userEvent.setup();
        const expandTo = vi.fn();
        const tags: (string | undefined)[] = [];

        render(<Saving others={[makeNeedsChoiceLine()]} expandTo={expandTo} onPick={(tag) => tags.push(tag)} />);
        await user.click(
            within(screen.getByRole('complementary', { name: 'Choose a food' })).getByRole('button', {
                name: 'Skim milk',
            }),
        );

        expect(tags).toEqual(['wide']);
        expect(expandTo).not.toHaveBeenCalled();
    });

    it('⛔ not when the cook has gone to another line meanwhile', async () => {
        const user = userEvent.setup();
        const expandTo = vi.fn();

        // The pick does not save until the test presses Finish.
        const Late: FC = () => {
            const [save, setSave] = useState<number | undefined>(undefined);

            return (
                <>
                    <button type="button" onClick={() => setSave(1)}>
                        Finish
                    </button>
                    <Harness
                        matching={matchingOf([save === undefined ? MILK_OPEN : SKIM_PICKED, makeNeedsChoiceLine()], {
                            expandTo,
                            saved: save === undefined ? undefined : { key: 'milk', tag: 'narrow', seq: save },
                            pick: vi.fn(),
                        })}
                    />
                </>
            );
        };

        render(<Late />);
        await user.click(screen.getByRole('button', { name: 'Skim milk' }));
        await user.click(screen.getByRole('button', { name: /Choose a food/ }));
        expandTo.mockClear();

        await user.click(screen.getByRole('button', { name: 'Finish' }));

        expect(expandTo).not.toHaveBeenCalled();
    });
});
