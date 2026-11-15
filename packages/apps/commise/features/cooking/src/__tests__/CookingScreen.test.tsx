import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecipeStatus } from '@kitchensink/recipe-core';

import { htmlElementOf } from '../__fixtures__/htmlElementOf.js';
import { makeCookingRecipe } from '../__fixtures__/makeCookingRecipe.js';
import { CookingScreen } from '../CookingScreen.js';
import type { CookingScreenProps, CookingScreenRead } from '../cookingViewProps.js';

/**
 * The web cooking screen: the orchestration over the real cooking-core reducers (through `useCookingSession`), the real
 * copy (`cookingMessages` through `navOf`) and the real loading clock. Only the keep-awake hooks are doubled: `useKeepAwake`
 * spies on the real hold so it can be observed, and `useKeepAwakeAvailable` is replaced, so a test sets whether the device can hold the screen.
 *
 * Every state is asserted here with its copy: loading, error, no steps, gone, the redirect, a step, ticked, next
 * coming, the last step, Done, the live region, the keys, the swipe, and the read-over-session precedence at the join.
 */
const keepAwake = vi.hoisted((): { available: boolean; calls: boolean[] } => ({ available: false, calls: [] }));

// The live region is wrapped over the real one only to record the props the screen gives it.
const liveRegions = vi.hoisted((): { announceOnMount: (boolean | undefined)[] } => ({ announceOnMount: [] }));

vi.mock('@commise/ui/live-region', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@commise/ui/live-region')>();

    return {
        ...actual,
        LiveRegion: (props: ComponentProps<typeof actual.LiveRegion>) => {
            liveRegions.announceOnMount.push(props.announceOnMount);

            return <actual.LiveRegion {...props} />;
        },
    };
});

vi.mock('@commise/ui/keep-awake', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@commise/ui/keep-awake')>();

    return {
        ...actual,
        useKeepAwake: (on: boolean) => {
            keepAwake.calls.push(on);
            actual.useKeepAwake(on);
        },
        useKeepAwakeAvailable: () => keepAwake.available,
    };
});

const TITLE = 'Weeknight roast';

/** Six steps with text and one blank one: the blank step is not a step for the cook. */
const STEPS = [
    { stepNumber: 1, instruction: 'Heat 1.5 tbsp. oil. Add the onion and cook 5 min.' },
    { stepNumber: 2, instruction: 'Add 2 tbsp. butter. Stir well. Season.' },
    { stepNumber: 3, instruction: '   ' },
    { stepNumber: 4, instruction: 'Roast for 40 min.' },
    { stepNumber: 5, instruction: 'Rest the meat.' },
    { stepNumber: 6, instruction: 'Carve.' },
    { stepNumber: 7, instruction: 'Serve.' },
];

const ready = (over: Partial<Extract<CookingScreenRead, { kind: 'ready' }>> = {}): CookingScreenRead => ({
    kind: 'ready',
    recipe: makeCookingRecipe({ id: 'r1', title: TITLE, status: RecipeStatus.PUBLISHED, steps: STEPS }),
    viewerIsOwner: true,
    ...over,
});

function setup(read: CookingScreenRead = ready()) {
    const props: CookingScreenProps = { read, onLeave: vi.fn(), onEdit: vi.fn(), onHome: vi.fn() };
    const view = render(<CookingScreen {...props} />);

    return { ...props, ...view };
}

const nav = () => within(screen.getByRole('navigation'));
// Controls are found by name, never by position: the names are what a cook hears.
const forward = () => nav().getByRole('button', { name: /^(Next step, step|Start step|Finish)/u });
const back = () => nav().getByRole('button', { name: /^Back to /u });
const isFilled = (button: HTMLElement) => button.className.includes('bg-action');
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const tick = (text: string) => fireEvent.click(screen.getByRole('checkbox', { name: text }));

beforeEach(() => {
    keepAwake.available = false;
    keepAwake.calls = [];
});

afterEach(() => {
    vi.useRealTimers();
});

describe('CookingScreen: loading', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('shows no skeleton before 300 ms, then the skeleton, then the label after 1 s', () => {
        const { container } = setup({ kind: 'pending', retry: vi.fn() });

        expect(container.querySelectorAll('[data-skeleton-line]')).toHaveLength(0);

        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(container.querySelectorAll('[data-skeleton-line]')).toHaveLength(3);
        expect(screen.queryByText('Opening the recipe…')).toBeNull();

        act(() => {
            vi.advanceTimersByTime(700);
        });
        expect(screen.getByText('Opening the recipe…')).toBeTruthy();
    });

    it('is busy, with the place muted, Back and Next drawn disabled, and Exit live', () => {
        const { onLeave } = setup({ kind: 'pending', retry: vi.fn() });

        expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
        expect(screen.getByText('Step –')).toBeTruthy();

        for (const button of [
            nav().getByRole('button', { name: 'Back' }),
            nav().getByRole('button', { name: 'Next step' }),
        ]) {
            expect(button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true').toBe(true);
        }

        press('Exit cooking mode');
        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('offers Try again after 10 s, and it reads again', () => {
        const retry = vi.fn();
        setup({ kind: 'pending', retry });

        act(() => {
            vi.advanceTimersByTime(10_000);
        });
        press('Try again');

        expect(screen.getByRole('alert').textContent).toContain('We couldn’t open this recipe');
        expect(retry).toHaveBeenCalledTimes(1);
    });
});

describe('CookingScreen: load error', () => {
    it('alerts with the online body, Try again and a way back', () => {
        const retry = vi.fn();
        const { onLeave } = setup({ kind: 'failed', offline: false, retry });

        const alert = screen.getByRole('alert');
        expect(within(alert).getByRole('heading', { level: 1 }).textContent).toBe('We couldn’t open this recipe');
        expect(alert.textContent).toContain('Check your connection, then try again.');

        press('Try again');
        expect(retry).toHaveBeenCalledTimes(1);
        press('Back to the recipe');
        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('says the offline body when the device is offline', () => {
        setup({ kind: 'failed', offline: true, retry: vi.fn() });

        expect(screen.getByRole('alert').textContent).toContain(
            'You’re offline, and this recipe isn’t saved on this device yet.',
        );
    });
});

describe('CookingScreen: no steps', () => {
    const blank = makeCookingRecipe({
        id: 'r1',
        title: TITLE,
        status: RecipeStatus.PUBLISHED,
        steps: [{ stepNumber: 1, instruction: '  ' }],
    });

    it('offers its owner Edit recipe', () => {
        const { onEdit } = setup(ready({ recipe: blank, viewerIsOwner: true }));

        expect(screen.getByRole('alert').textContent).toContain('Add some to cook from it here.');
        press('Edit recipe');
        expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it('tells another cook its cook has added none, with no Edit recipe', () => {
        setup(ready({ recipe: blank, viewerIsOwner: false }));

        expect(screen.getByRole('alert').textContent).toContain('Its cook hasn’t added any steps.');
        expect(screen.queryByRole('button', { name: 'Edit recipe' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Back to the recipe' })).toBeTruthy();
    });
});

describe('CookingScreen: recipe gone', () => {
    it('says the title and Go to Home, and never why', () => {
        const { onHome } = setup({ kind: 'gone' });

        const alert = screen.getByRole('alert');
        expect(alert.textContent).toBe('This recipe isn’t available any moreGo to Home');
        press('Go to Home');
        expect(onHome).toHaveBeenCalledTimes(1);
    });
});

describe('CookingScreen: where a cook link goes', () => {
    const draft = makeCookingRecipe({ id: 'r1', title: TITLE, status: RecipeStatus.DRAFT, steps: STEPS });

    it('sends the owner of a draft to the editor, painting only the loading frame, never the recipe', () => {
        const { onEdit, container } = setup(ready({ recipe: draft, viewerIsOwner: true }));

        expect(onEdit).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
        expect(screen.queryByText(/Heat 1\.5 tbsp/u)).toBeNull();
        expect(container.textContent).not.toContain(TITLE);
        expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    });

    it('tells another cook a draft is not available, and never why', () => {
        const { onEdit } = setup(ready({ recipe: draft, viewerIsOwner: false }));

        expect(screen.getByRole('alert').textContent).toContain('This recipe isn’t available any more');
        expect(screen.queryByText(/draft/iu)).toBeNull();
        expect(onEdit).not.toHaveBeenCalled();
    });

    it('cooks another cook’s published recipe', () => {
        setup(ready({ viewerIsOwner: false }));

        expect(screen.getByText('Step 1 of 6')).toBeTruthy();
    });
});

describe('CookingScreen: a step', () => {
    it('opens on step 1, counting only the steps with text', () => {
        setup();

        expect(screen.getByText('Step 1 of 6')).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Step\u00a01 of 6' })).toBeTruthy();
    });

    it('shows the focus line with its line count, and the rest as Then lines', () => {
        setup();

        expect(screen.getByText('Line 1 of 2')).toBeTruthy();
        expect(screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'))).toEqual([
            'Heat 1.5 tbsp. oil.',
            'Add the onion and cook 5 min.',
        ]);
    });

    it('previews the next step with its first line, pinned above Back and Next, outside the scrolling step', () => {
        setup();

        const overline = screen.getByText('Next · step 2');
        const region = screen.getByRole('region', { name: 'Step\u00a01 of 6' });

        expect(screen.getByText('Add 2 tbsp. butter.')).toBeTruthy();
        expect(screen.queryByText('Stir well.')).toBeNull();
        expect(region.contains(overline)).toBe(false);
        expect(overline.closest('[data-cooking-scroll]')).toBeNull();
        expect(overline.compareDocumentPosition(back()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('names Back for the recipe on step 1, and leaves with it', () => {
        const { onLeave } = setup();

        expect(back().getAttribute('aria-label')).toBe('Back to the recipe');
        expect(back().textContent).toContain('Back');
        fireEvent.click(back());
        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('names Next by the step it opens, quiet and last', () => {
        setup();

        expect(forward().getAttribute('aria-label')).toBe('Next step, step 2');
        expect(isFilled(forward())).toBe(false);
    });

    it('moves the focus to the next unticked line when the focus line is ticked', () => {
        setup();

        tick('Heat 1.5 tbsp. oil.');

        expect(screen.getByText('Line 2 of 2')).toBeTruthy();
        expect(screen.getByText('You ticked 1 line')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Show' }).getAttribute('aria-expanded')).toBe('false');
        expect(screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'))).toEqual([
            'Add the onion and cook 5 min.',
        ]);
    });

    it('keeps Next quiet and working with lines unticked (ticking is never required)', () => {
        setup();

        tick('Heat 1.5 tbsp. oil.');
        expect(isFilled(forward())).toBe(false);
        fireEvent.click(forward());

        expect(screen.getByText('Step 2 of 6')).toBeTruthy();
    });

    it('opens the ticked lines with Show, and an unticked line above the focus becomes the focus again', () => {
        setup();

        tick('Heat 1.5 tbsp. oil.');
        press('Show');
        expect(screen.getByRole('checkbox', { name: 'Heat 1.5 tbsp. oil.' }).getAttribute('aria-checked')).toBe('true');

        tick('Heat 1.5 tbsp. oil.');

        expect(screen.getByText('Line 1 of 2')).toBeTruthy();
        expect(screen.queryByText(/You ticked/u)).toBeNull();
    });

    it('says the plural once two lines are ticked', () => {
        setup();
        fireEvent.click(forward());

        tick('Add 2 tbsp. butter.');
        tick('Stir well.');

        expect(screen.getByText('You ticked 2 lines')).toBeTruthy();
    });

    it('shows Up next and a filled Start step n once every line is ticked, which opens that step', () => {
        setup();

        tick('Heat 1.5 tbsp. oil.');
        tick('Add the onion and cook 5 min.');

        const region = screen.getByRole('region', { name: 'Step\u00a01 of 6' });
        // Up next is the step body's, and replaces the foot's preview.
        expect(within(region).getByText('Up next · step 2')).toBeTruthy();
        expect(within(region).getByText('Add 2 tbsp. butter.').className).toContain('text-reading-large');
        expect(within(region).getByText('Stir well.')).toBeTruthy();
        expect(screen.queryByText(/Next · step/u)).toBeNull();
        expect(screen.queryByText(/^Line \d/u)).toBeNull();
        expect(forward().textContent).toBe('Start step\u00a02');
        expect(isFilled(forward())).toBe(true);
        expect(isFilled(back())).toBe(false);

        fireEvent.click(forward());
        expect(screen.getByText('Step 2 of 6')).toBeTruthy();
    });

    it('keeps a step’s ticks when the cook goes on and comes back', () => {
        setup();

        tick('Heat 1.5 tbsp. oil.');
        fireEvent.click(forward());
        expect(back().getAttribute('aria-label')).toBe('Back to step 1');
        fireEvent.click(back());

        expect(screen.getByText('Step 1 of 6')).toBeTruthy();
        expect(screen.getByText('You ticked 1 line')).toBeTruthy();
        expect(screen.getByText('Line 2 of 2')).toBeTruthy();
    });

    it('hides the line count for a one-line step', () => {
        setup();
        fireEvent.click(forward());
        fireEvent.click(forward());

        expect(screen.getByText('Step 3 of 6')).toBeTruthy();
        expect(screen.queryByText(/^Line \d/u)).toBeNull();
        expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    });

    it('makes the last step’s forward Finish, quiet until its line is ticked, then filled', () => {
        setup();

        for (let step = 1; step < 6; step++) {
            fireEvent.click(forward());
        }

        expect(screen.getByText('Step 6 of 6')).toBeTruthy();
        expect(forward().textContent).toContain('Finish');
        expect(isFilled(forward())).toBe(false);
        expect(screen.queryByText(/Next · step/u)).toBeNull();

        tick('Serve.');
        expect(isFilled(forward())).toBe(true);
    });

    it('announces a step change politely with the place and the focus line', () => {
        setup();

        fireEvent.click(forward());

        expect(
            screen.getAllByRole('status').some((region) => region.textContent === 'Step 2 of 6. Add 2 tbsp. butter.'),
        ).toBe(true);
    });

    it('says nothing in the live region on opening, only after a move', () => {
        setup();

        expect(screen.getAllByRole('status').every((region) => region.textContent === '')).toBe(true);
    });

    it('starts Show closed again on every step', () => {
        setup();
        tick('Heat 1.5 tbsp. oil.');
        press('Show');
        fireEvent.click(forward());
        tick('Add 2 tbsp. butter.');

        expect(screen.getByRole('button', { name: 'Show' }).getAttribute('aria-expanded')).toBe('false');
    });

    it('reads the recipe once: a refetch with edited text changes nothing under the cook', () => {
        const { rerender, onLeave, onEdit, onHome } = setup();

        rerender(
            <CookingScreen
                read={ready({
                    recipe: makeCookingRecipe({
                        id: 'r1',
                        title: TITLE,
                        status: RecipeStatus.PUBLISHED,
                        steps: [{ stepNumber: 1, instruction: 'Something else.' }],
                    }),
                })}
                onLeave={onLeave}
                onEdit={onEdit}
                onHome={onHome}
            />,
        );

        expect(screen.getByText('Step 1 of 6')).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: 'Heat 1.5 tbsp. oil.' })).toBeTruthy();
    });

    it('opens a fresh session when the screen is given another recipe', () => {
        const { rerender, onLeave, onEdit, onHome } = setup();
        fireEvent.click(forward());

        rerender(
            <CookingScreen
                read={ready({
                    recipe: makeCookingRecipe({
                        id: 'r2',
                        title: 'Soup',
                        status: RecipeStatus.PUBLISHED,
                        steps: [{ stepNumber: 1, instruction: 'Simmer the soup.' }],
                    }),
                })}
                onLeave={onLeave}
                onEdit={onEdit}
                onHome={onHome}
            />,
        );

        expect(screen.getByText('Step 1 of 1')).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: 'Simmer the soup.' })).toBeTruthy();
    });

    it('exits to the recipe with Exit', () => {
        const { onLeave } = setup();

        press('Exit cooking mode');

        expect(onLeave).toHaveBeenCalledTimes(1);
    });
});

describe('CookingScreen: readingLarge and largeTitle never share a screen', () => {
    const largeTitles = (container: HTMLElement) => container.querySelectorAll('.text-large-title');

    it('draws no largeTitle on a step of several lines, with its preview', () => {
        const { container } = setup();

        expect(screen.getByText('Next · step 2')).toBeTruthy();
        expect(largeTitles(container)).toHaveLength(0);
    });

    it('draws no largeTitle on a step with its ticked record open', () => {
        const { container } = setup();
        tick('Heat 1.5 tbsp. oil.');
        press('Show');

        expect(largeTitles(container)).toHaveLength(0);
    });

    it('draws no largeTitle on a one-line step', () => {
        const { container } = setup();
        fireEvent.click(forward());
        fireEvent.click(forward());

        expect(screen.getByText('Step 3 of 6')).toBeTruthy();
        expect(largeTitles(container)).toHaveLength(0);
    });

    it('draws no readingLarge on Done, whose title may be a largeTitle', () => {
        const { container } = setup();

        for (let step = 1; step <= 6; step++) {
            fireEvent.click(forward());
        }

        expect(screen.getByRole('heading', { level: 1, name: 'All 6 steps done' })).toBeTruthy();
        expect(container.querySelectorAll('.text-reading-large')).toHaveLength(0);
    });
});

/**
 * The step swipe on a touch screen: an extra route between steps, over the shared swipe rule. Only a touch pointer swipes, a gesture is judged when it ends, and the buttons stay. The viewport is 390 wide here.
 */
describe('CookingScreen: swipe (web touch)', () => {
    const body = () =>
        htmlElementOf(screen.getByRole('region', { name: /^Step\u00a0\d of 6$/u }).closest('[data-cooking-swipe]'));

    const swipe = (
        from: number,
        to: number,
        {
            pointerType = 'touch',
            end = 'pointerUp',
        }: { pointerType?: string; end?: 'pointerUp' | 'pointerCancel' } = {},
    ) => {
        const target = body();
        fireEvent.pointerDown(target, { pointerType, clientX: from, clientY: 300, isPrimary: true });
        fireEvent[end](target, { pointerType, clientX: to, clientY: 310, isPrimary: true });
    };

    beforeEach(() => {
        vi.stubGlobal('innerWidth', 390);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('lets the browser keep vertical scrolling on the step body', () => {
        setup();

        expect(body().className).toContain('touch-pan-y');
    });

    it('goes to the next step on a swipe left, and back on a swipe right, keeping the buttons', () => {
        setup();

        swipe(300, 150);
        expect(screen.getByText('Step 2 of 6')).toBeTruthy();
        expect(nav().getAllByRole('button')).toHaveLength(2);

        swipe(100, 260);
        expect(screen.getByText('Step 1 of 6')).toBeTruthy();
    });

    it('never leaves from step 1 on a swipe right', () => {
        const { onLeave } = setup();

        swipe(100, 260);

        expect(onLeave).not.toHaveBeenCalled();
        expect(screen.getByText('Step 1 of 6')).toBeTruthy();
    });

    it('never finishes from the last step on a swipe left', () => {
        setup();

        for (let step = 1; step < 6; step++) {
            fireEvent.click(forward());
        }

        swipe(300, 150);

        expect(screen.getByText('Step 6 of 6')).toBeTruthy();
        expect(screen.queryByRole('heading', { level: 1, name: 'All 6 steps done' })).toBeNull();
    });

    it('ignores a mouse drag, a short drag, a start at a screen edge, and a cancelled gesture', () => {
        setup();

        swipe(300, 150, { pointerType: 'mouse' });
        swipe(300, 250);
        swipe(10, 200);
        swipe(380, 200);
        swipe(300, 150, { end: 'pointerCancel' });

        expect(screen.getByText('Step 1 of 6')).toBeTruthy();
    });

    it('forgets a cancelled gesture, so a later touch release is no swipe', () => {
        setup();
        const target = body();

        fireEvent.pointerDown(target, { pointerType: 'touch', clientX: 300, clientY: 300, isPrimary: true });
        fireEvent.pointerCancel(target, { pointerType: 'touch' });
        fireEvent.pointerUp(target, { pointerType: 'touch', clientX: 150, clientY: 310, isPrimary: true });

        expect(screen.getByText('Step 1 of 6')).toBeTruthy();
    });

    it('announces a swiped step like a pressed one', () => {
        setup();

        swipe(300, 150);

        expect(
            screen.getAllByRole('status').some((region) => region.textContent === 'Step 2 of 6. Add 2 tbsp. butter.'),
        ).toBe(true);
    });
});

describe('CookingScreen: keys (web)', () => {
    it('goes forward with → and back with ←', () => {
        setup();

        fireEvent.keyDown(document, { key: 'ArrowRight' });
        expect(screen.getByText('Step 2 of 6')).toBeTruthy();

        fireEvent.keyDown(document, { key: 'ArrowLeft' });
        expect(screen.getByText('Step 1 of 6')).toBeTruthy();
    });

    it('ignores the keys with a modifier held, or with focus in a field', () => {
        setup();
        const field = document.createElement('input');
        document.body.append(field);

        fireEvent.keyDown(document, { key: 'ArrowRight', altKey: true });
        fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true });
        fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true });
        fireEvent.keyDown(document, { key: 'ArrowRight', ctrlKey: true });
        fireEvent.keyDown(field, { key: 'ArrowRight' });

        expect(screen.getByText('Step 1 of 6')).toBeTruthy();
        field.remove();
    });

    it('keeps the buttons when the keys work', () => {
        setup();

        fireEvent.keyDown(document, { key: 'ArrowRight' });

        expect(nav().getAllByRole('button')).toHaveLength(2);
    });

    it('listens once while on the steps, not again on every move', () => {
        const add = vi.spyOn(document, 'addEventListener');
        const remove = vi.spyOn(document, 'removeEventListener');
        const keydowns = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === 'keydown').length;
        setup();

        for (let step = 1; step <= 3; step++) {
            fireEvent.keyDown(document, { key: 'ArrowRight' });
        }

        fireEvent.keyDown(document, { key: 'ArrowLeft' });

        expect(screen.getByText('Step 3 of 6')).toBeTruthy();
        expect(keydowns(add)).toBe(1);
        expect(keydowns(remove)).toBe(0);
        add.mockRestore();
        remove.mockRestore();
    });

    // The keys only move between steps: leaving and finishing are the buttons' alone.
    it('does nothing with ← on step 1: the cook stays, and nothing leaves', () => {
        const { onLeave } = setup();

        fireEvent.keyDown(document, { key: 'ArrowLeft' });

        expect(onLeave).not.toHaveBeenCalled();
        expect(screen.getByText('Step 1 of 6')).toBeTruthy();
    });

    it('does nothing with → on the last step: no Done until the cook presses Finish', () => {
        setup();

        for (let step = 1; step < 6; step++) {
            fireEvent.keyDown(document, { key: 'ArrowRight' });
        }

        fireEvent.keyDown(document, { key: 'ArrowRight' });

        expect(screen.getByText('Step 6 of 6')).toBeTruthy();
        expect(screen.queryByRole('heading', { level: 1, name: 'All 6 steps done' })).toBeNull();
    });

    it('opens the next step with → while Up next shows, as Start step 2 does', () => {
        setup();
        tick('Heat 1.5 tbsp. oil.');
        tick('Add the onion and cook 5 min.');
        expect(forward().textContent).toBe('Start step\u00a02');

        fireEvent.keyDown(document, { key: 'ArrowRight' });

        expect(screen.getByText('Step 2 of 6')).toBeTruthy();
    });
});

describe('CookingScreen: Done', () => {
    const finish = () => {
        for (let step = 1; step < 6; step++) {
            fireEvent.click(forward());
        }

        fireEvent.click(forward());
    };

    it('says all the steps are done and moves focus to the title', () => {
        setup();
        finish();

        const title = screen.getByRole('heading', { level: 1, name: 'All 6 steps done' });
        expect(document.activeElement).toBe(title);
        expect(screen.getByText(`${TITLE}. Enjoy it.`)).toBeTruthy();
        expect(screen.queryByRole('navigation')).toBeNull();
    });

    it('holds the screen on while cooking and lets it go on Done', () => {
        keepAwake.available = true;
        setup();

        expect(keepAwake.calls.at(-1)).toBe(true);
        finish();

        expect(keepAwake.calls.at(-1)).toBe(false);
        expect(screen.getByText('The screen can turn off again.')).toBeTruthy();
    });

    it('promises nothing about the screen where it could not be held', () => {
        keepAwake.available = false;
        setup();
        finish();

        expect(screen.queryByText('The screen can turn off again.')).toBeNull();
    });

    it('goes back to the recipe', () => {
        const { onLeave } = setup();
        finish();

        press('Back to the recipe');

        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('keeps the labelled Exit in the top bar, with no place, and it leaves to the recipe', () => {
        const { onLeave } = setup();
        finish();

        expect(screen.queryByText(/^Step \d/u)).toBeNull();
        press('Exit cooking mode');

        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('pins its two actions in the foot, after the body, outside the scrolling body', () => {
        setup();
        finish();

        const title = screen.getByRole('heading', { level: 1, name: 'All 6 steps done' });
        const backToRecipe = screen.getByRole('button', { name: 'Back to the recipe' });

        expect(backToRecipe.closest('[data-cooking-scroll]')).toBeNull();
        expect(backToRecipe.closest('[data-cooking-foot]')).not.toBeNull();
        expect(title.compareDocumentPosition(backToRecipe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    // Android does not reliably speak text a live region mounts with, and Cook it again mounts the step's region again.
    it('mounts the step announcement empty and fills it, so Cook it again is spoken on Android', () => {
        setup();
        finish();
        liveRegions.announceOnMount = [];

        press('Cook it again');

        expect(liveRegions.announceOnMount.length).toBeGreaterThan(0);
        expect(liveRegions.announceOnMount.every((asked) => asked === true)).toBe(true);
    });

    it('cooks it again from step 1, line 1, with every tick cleared', () => {
        setup();
        tick('Heat 1.5 tbsp. oil.');
        finish();

        press('Cook it again');

        expect(screen.getByText('Step 1 of 6')).toBeTruthy();
        expect(screen.getByText('Line 1 of 2')).toBeTruthy();
        expect(screen.queryByText(/You ticked/u)).toBeNull();
        expect(keepAwake.calls.at(-1)).toBe(true);
    });
});

describe('CookingScreen: the names a cook hears on the way to Done', () => {
    const toLastStep = () => {
        for (let step = 1; step < 6; step++) {
            fireEvent.click(forward());
        }
    };

    it('names the forward control Start step 6 once the step 5 line is ticked, and Finish on step 6', () => {
        setup();

        for (let step = 1; step < 5; step++) {
            fireEvent.click(forward());
        }

        tick('Carve.');
        expect(screen.getByRole('button', { name: 'Start step 6' })).toBeTruthy();

        fireEvent.click(forward());
        expect(screen.getByRole('button', { name: 'Finish' })).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Step 6 of 6' })).toBeTruthy();
    });

    it('names Next by the step it opens, with the visible words just Next step', () => {
        setup();

        expect(screen.getByRole('button', { name: 'Next step, step 2' }).textContent).toBe('Next step');
    });

    it('names Back for the step it returns to, with the visible word just Back', () => {
        setup();
        expect(screen.getByRole('button', { name: 'Back to the recipe' }).textContent).toBe('Back');

        fireEvent.click(forward());

        expect(screen.getByRole('button', { name: 'Back to step 1' }).textContent).toBe('Back');
        expect(screen.getByRole('region', { name: 'Step 2 of 6' })).toBeTruthy();
    });

    it('titles Done "All 6 steps done" for six steps and "All done" for one', () => {
        const { unmount } = setup();
        toLastStep();
        fireEvent.click(forward());
        expect(screen.getByRole('heading', { level: 1, name: 'All 6 steps done' })).toBeTruthy();
        unmount();

        setup(
            ready({
                recipe: makeCookingRecipe({
                    id: 'r1',
                    title: TITLE,
                    status: RecipeStatus.PUBLISHED,
                    steps: [{ stepNumber: 1, instruction: 'Simmer the soup.' }],
                }),
            }),
        );
        fireEvent.click(forward());

        expect(screen.getByRole('heading', { level: 1, name: 'All done' })).toBeTruthy();
    });

    it('sets the focus line in its own reading face, so the frame cannot change it', () => {
        setup();

        expect(screen.getByText('Heat 1.5 tbsp. oil.').className).toContain('font-body');
    });
});

describe('CookingScreen: the read wins over the session at the join', () => {
    const rerenderWith = (view: ReturnType<typeof setup>, read: CookingScreenRead) =>
        view.rerender(<CookingScreen read={read} onLeave={view.onLeave} onEdit={view.onEdit} onHome={view.onHome} />);

    const finish = () => {
        for (let step = 1; step <= 6; step++) {
            fireEvent.click(forward());
        }
    };

    it('shows only the busy loading frame, never Done, when the read goes back to pending after Done', () => {
        const view = setup();
        finish();
        expect(screen.getByRole('heading', { level: 1, name: 'All 6 steps done' })).toBeTruthy();

        rerenderWith(view, { kind: 'pending', retry: vi.fn() });

        expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
        expect(screen.queryByRole('heading', { level: 1, name: 'All 6 steps done' })).toBeNull();
    });

    it('shows no steps, never Done, when the same recipe arrives with every step blank after Done', () => {
        const view = setup();
        finish();

        rerenderWith(
            view,
            ready({
                recipe: makeCookingRecipe({
                    id: 'r1',
                    title: TITLE,
                    status: RecipeStatus.PUBLISHED,
                    steps: [{ stepNumber: 1, instruction: '  ' }],
                }),
            }),
        );

        expect(screen.getByRole('alert').textContent).toContain('Add some to cook from it here.');
        expect(screen.queryByRole('heading', { level: 1, name: 'All 6 steps done' })).toBeNull();
    });
});

describe('CookingScreen: the keys do nothing on Done', () => {
    it('keeps Done on → and ←, and never leaves', () => {
        const { onLeave } = setup();

        for (let step = 1; step <= 6; step++) {
            fireEvent.click(forward());
        }

        fireEvent.keyDown(document, { key: 'ArrowLeft' });
        fireEvent.keyDown(document, { key: 'ArrowRight' });

        expect(screen.getByRole('heading', { level: 1, name: 'All 6 steps done' })).toBeTruthy();
        expect(onLeave).not.toHaveBeenCalled();
    });
});

describe('CookingScreen: keyboard focus when the focused control goes away', () => {
    const focusAndPress = (name: string) => {
        const row = screen.getByRole('checkbox', { name });
        row.focus();
        fireEvent.click(row);
    };

    it('moves focus to the forward control when the last line is ticked from the keyboard', () => {
        setup();
        tick('Heat 1.5 tbsp. oil.');

        focusAndPress('Add the onion and cook 5 min.');

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Start step 2' }));
    });

    it('moves focus to the new focus line when a Then line is ticked', () => {
        setup();

        focusAndPress('Add the onion and cook 5 min.');

        expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Heat 1.5 tbsp. oil.' }));
    });

    it('leaves focus where it is when something still holds it, as on Exit after a key moves a step', () => {
        setup();
        const exit = screen.getByRole('button', { name: 'Exit cooking mode' });
        exit.focus();

        fireEvent.keyDown(document, { key: 'ArrowRight' });

        expect(screen.getByText('Step 2 of 6')).toBeTruthy();
        expect(document.activeElement).toBe(exit);
    });

    it('focuses step 1’s forward control and announces step 1 after Cook again', () => {
        setup();

        for (let step = 1; step <= 6; step++) {
            fireEvent.click(forward());
        }

        screen.getByRole('button', { name: 'Cook it again' }).focus();
        press('Cook it again');

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next step, step 2' }));
        expect(
            screen.getAllByRole('status').some((region) => region.textContent === 'Step 1 of 6. Heat 1.5 tbsp. oil.'),
        ).toBe(true);
    });

    it('does not take focus on opening', () => {
        setup();

        expect(document.activeElement).toBe(document.body);
    });
});

describe('CookingScreen: the keys ignore a held key and a handled key', () => {
    it('does not run on through steps while → is held down', () => {
        setup();

        fireEvent.keyDown(document, { key: 'ArrowRight' });
        fireEvent.keyDown(document, { key: 'ArrowRight', repeat: true });
        fireEvent.keyDown(document, { key: 'ArrowRight', repeat: true });

        expect(screen.getByText('Step 2 of 6')).toBeTruthy();
    });

    it('does nothing for a key another handler already took', () => {
        setup();
        const event = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true, bubbles: true });
        event.preventDefault();

        act(() => {
            document.dispatchEvent(event);
        });

        expect(screen.getByText('Step 1 of 6')).toBeTruthy();
    });
});

describe('CookingScreen: what the live region says after a tick', () => {
    it('keeps the words of the move when a line is ticked afterwards', () => {
        setup();
        fireEvent.click(forward());
        const said = () => screen.getAllByRole('status').map((region) => region.textContent);
        expect(said()).toContain('Step 2 of 6. Add 2 tbsp. butter.');

        tick('Add 2 tbsp. butter.');

        expect(said()).toContain('Step 2 of 6. Add 2 tbsp. butter.');
        expect(said()).not.toContain('Step 2 of 6. Stir well.');
    });

    it('says only the place on arriving at a step whose lines are all ticked', () => {
        setup();
        fireEvent.click(forward());
        tick('Add 2 tbsp. butter.');
        tick('Stir well.');
        tick('Season.');
        fireEvent.click(forward());
        fireEvent.click(back());

        expect(screen.getAllByRole('status').map((region) => region.textContent)).toContain('Step 2 of 6.');
    });
});

describe('CookingScreen: focus recovery inside a page that has its own landmarks', () => {
    const inPage = () => {
        const props: CookingScreenProps = { read: ready(), onLeave: vi.fn(), onEdit: vi.fn(), onHome: vi.fn() };

        return render(
            <main>
                <div role="checkbox" aria-checked="false" aria-label="Outside checkbox" tabIndex={0} />
                <CookingScreen {...props} />
                <nav>
                    <button type="button">Outside button</button>
                </nav>
            </main>,
        );
    };

    it('focuses the cooking forward control, never a nav button outside the screen', () => {
        inPage();
        tick('Heat 1.5 tbsp. oil.');
        const last = screen.getByRole('checkbox', { name: 'Add the onion and cook 5 min.' });
        last.focus();
        fireEvent.click(last);

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Start step 2' }));
    });

    it('focuses the cooking focus line, never an unticked checkbox outside the screen', () => {
        inPage();
        const then = screen.getByRole('checkbox', { name: 'Add the onion and cook 5 min.' });
        then.focus();
        fireEvent.click(then);

        expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Heat 1.5 tbsp. oil.' }));
    });
});
