// @vitest-environment jsdom
/**
 * Component tests for the web Steps leaf, `RecipeInstructionsFields` (`docs/design/uiOverhaul/buildSpec.md` §7.6,
 * §7.10): the numbered list, each step's labelled multi-line field, the timer disclosure, the per-step menu (move up,
 * move down, remove — reordering without drag, SC 2.5.7), Add step and Ctrl/Cmd+Enter, the empty state, the
 * publish-refused message and the blur checkpoint.
 *
 * Moved here from `recipeFieldGroups.test.tsx`, whose instructions blocks pinned the wizard-era row (a one-line input, a
 * visible timer on every row, an inline Remove button).
 *
 * ⚠️ NOT pinned: "the new step's field takes focus" (§7.6). The design-system `TextArea` takes no focus request, so the
 * leaf cannot move focus to it without a ref the register does not admit; see the slice report.
 */
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';

import { editorMessages } from '../../editor/messages.js';
import { RecipeInstructionsFields } from '../RecipeInstructionsFields.js';
import type { RecipeFormErrors } from '../validate.js';
import { defaultRecipeFormValues, type RecipeFormStep, type RecipeFormValues } from '../values.js';

const e = editorMessages.en;

if (typeof Element !== 'undefined') {
    // jsdom implements neither pointer capture nor scrollIntoView, which Radix's menu calls on open.
    Element.prototype.hasPointerCapture ??= (): boolean => false;
    Element.prototype.releasePointerCapture ??= (): void => undefined;
    Element.prototype.scrollIntoView ??= (): void => undefined;
}

afterEach(cleanup);

const withSteps = (steps: readonly RecipeFormStep[]): RecipeFormValues => ({ ...defaultRecipeFormValues(), steps });

const THREE: readonly RecipeFormStep[] = [
    { instruction: 'Toast the rice.' },
    { instruction: 'Add the stock.', timerSeconds: 1200 },
    { instruction: 'Stir in the cheese.' },
];

interface HarnessProps {
    readonly initial: RecipeFormValues;
    readonly errors?: RecipeFormErrors;
    readonly onChange?: (next: RecipeFormValues) => void;
    readonly onFieldBlur?: () => void;
}

const Harness: FC<HarnessProps> = ({ initial, errors, onChange, onFieldBlur }) => {
    const [values, setValues] = useState(initial);

    return (
        <RecipeInstructionsFields
            values={values}
            {...(errors === undefined ? {} : { errors })}
            {...(onFieldBlur === undefined ? {} : { onFieldBlur })}
            onChange={(next) => {
                setValues(next);
                onChange?.(next);
            }}
        />
    );
};

const renderLive = (props: Partial<Omit<HarnessProps, 'onChange'>> = {}) => {
    const onChange = vi.fn<(next: RecipeFormValues) => void>();
    render(<Harness initial={props.initial ?? withSteps(THREE)} {...props} onChange={onChange} />);

    return { onChange };
};

const lastValues = (onChange: Mock<(next: RecipeFormValues) => void>): RecipeFormValues => {
    const call = onChange.mock.calls.at(-1);

    if (call === undefined) {
        throw new Error('onChange was never called');
    }

    return call[0];
};

const stepLabel = (n: number): string => e.steps.label.replace('{n}', String(n));
const stepBox = (n: number): HTMLTextAreaElement =>
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: stepLabel(n) });
const instructions = (): string[] =>
    screen.getAllByRole<HTMLTextAreaElement>('textbox', { name: /^Step \d+$/u }).map((box) => box.value);

const openMenu = async (user: ReturnType<typeof userEvent.setup>, n: number): Promise<HTMLElement> => {
    await user.click(screen.getByRole('button', { name: e.steps.actions.replace('{n}', String(n)) }));

    return screen.getByRole('menu');
};

describe('RecipeInstructionsFields (web) — the list', () => {
    it('is a numbered list with no section heading of its own', () => {
        renderLive();

        const list = screen.getByRole('list');

        expect(list.tagName).toBe('OL');
        expect(within(list).getAllByRole('listitem')).toHaveLength(3);
        expect(screen.queryByRole('heading')).toBeNull();
    });

    it('gives each step a visible "Step {n}" label naming its field, and a numeral in the selected fill', () => {
        renderLive();

        expect(screen.getByText(stepLabel(2), { selector: 'label' })).toBeTruthy();
        expect(stepBox(2).value).toBe('Add the stock.');

        const numeral = within(screen.getAllByRole('listitem')[0] ?? document.body).getByText('1');
        expect(numeral.className).toContain('bg-selected-fill');
        expect(numeral.className).toContain('text-ink');
        expect(numeral.className).toContain('size-8');
    });

    it('each field is multi-line, two rows at least, the full column width', () => {
        renderLive();

        expect(stepBox(1).tagName).toBe('TEXTAREA');
        expect(stepBox(1).rows).toBe(2);
        expect(stepBox(1).className).toContain('w-full');
    });

    it('Enter inserts a line break', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive({ initial: withSteps([{ instruction: '' }]) });

        await user.type(stepBox(1), 'Boil{Enter}Salt');

        expect(lastValues(onChange).steps).toEqual([{ instruction: 'Boil\nSalt' }]);
    });

    it('reports an edit to the right step', () => {
        const { onChange } = renderLive();

        fireEvent.change(stepBox(3), { target: { value: 'Rest it.' } });

        expect(lastValues(onChange).steps.map((step) => step.instruction)).toEqual([
            'Toast the rice.',
            'Add the stock.',
            'Rest it.',
        ]);
    });
});

describe('RecipeInstructionsFields (web) — the timer', () => {
    it('a step with no timer offers "Add a timer" and shows no timer field', () => {
        renderLive();

        const first = screen.getAllByRole('listitem')[0] ?? document.body;

        expect(within(first).getByRole('button', { name: e.steps.addTimer })).toBeTruthy();
        expect(within(first).queryByRole('group', { name: e.steps.timerLabel })).toBeNull();
    });

    it('"Add a timer" reveals an empty Timer field', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive();
        const first = (): HTMLElement => screen.getAllByRole('listitem')[0] ?? document.body;

        await user.click(within(first()).getByRole('button', { name: e.steps.addTimer }));

        expect(within(first()).getByRole('group', { name: e.steps.timerLabel })).toBeTruthy();
        expect(within(first()).queryByRole('button', { name: e.steps.addTimer })).toBeNull();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('a timer entered is stored in seconds', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive();
        const first = (): HTMLElement => screen.getAllByRole('listitem')[0] ?? document.body;

        await user.click(within(first()).getByRole('button', { name: e.steps.addTimer }));
        fireEvent.change(within(first()).getByRole('spinbutton', { name: 'Step 1 timer, minutes' }), {
            target: { value: '5' },
        });

        expect(lastValues(onChange).steps[0]).toEqual({ instruction: 'Toast the rice.', timerSeconds: 300 });
    });

    it('a step with a timer shows it, with "Remove timer" beside it', () => {
        renderLive();

        const second = screen.getAllByRole('listitem')[1] ?? document.body;

        expect(within(second).getByRole('group', { name: e.steps.timerLabel })).toBeTruthy();
        expect(within(second).getByRole<HTMLInputElement>('spinbutton', { name: 'Step 2 timer, minutes' }).value).toBe(
            '20',
        );
        expect(within(second).getByRole('button', { name: e.steps.removeTimer })).toBeTruthy();
    });

    it('"Remove timer" clears it — the key removed — and hides the field', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive();
        const second = (): HTMLElement => screen.getAllByRole('listitem')[1] ?? document.body;

        await user.click(within(second()).getByRole('button', { name: e.steps.removeTimer }));

        expect(lastValues(onChange).steps[1]).toEqual({ instruction: 'Add the stock.' });
        expect(within(second()).queryByRole('group', { name: e.steps.timerLabel })).toBeNull();
        expect(within(second()).getByRole('button', { name: e.steps.addTimer })).toBeTruthy();
    });

    it('a revealed, still-empty timer follows its step when the step moves', async () => {
        const user = userEvent.setup();
        renderLive();
        const item = (index: number): HTMLElement => screen.getAllByRole('listitem')[index] ?? document.body;

        await user.click(within(item(0)).getByRole('button', { name: e.steps.addTimer }));
        await user.click(within(await openMenu(user, 1)).getByRole('menuitem', { name: e.steps.moveDown }));

        expect(instructions()).toEqual(['Add the stock.', 'Toast the rice.', 'Stir in the cheese.']);
        expect(within(item(1)).getByRole('group', { name: e.steps.timerLabel })).toBeTruthy();
        expect(within(item(2)).queryByRole('group', { name: e.steps.timerLabel })).toBeNull();
    });
});

describe('RecipeInstructionsFields (web) — the step menu', () => {
    it('names its trigger for its step', () => {
        renderLive();

        expect(screen.getByRole('button', { name: 'Actions for step 2' })).toBeTruthy();
    });

    it('offers Move down and Remove on the first step, but not Move up', async () => {
        const user = userEvent.setup();
        renderLive();

        const menu = await openMenu(user, 1);

        expect(
            within(menu)
                .getAllByRole('menuitem')
                .map((item) => item.textContent),
        ).toEqual([e.steps.moveDown, e.steps.remove]);
    });

    it('offers Move up, Move down, a divider, then Remove on a middle step', async () => {
        const user = userEvent.setup();
        renderLive();

        const menu = await openMenu(user, 2);

        expect(
            within(menu)
                .getAllByRole('menuitem')
                .map((item) => item.textContent),
        ).toEqual([e.steps.moveUp, e.steps.moveDown, e.steps.remove]);
        expect(within(menu).getByRole('separator')).toBeTruthy();
    });

    it('offers no Move down on the last step', async () => {
        const user = userEvent.setup();
        renderLive();

        const menu = await openMenu(user, 3);

        expect(within(menu).queryByRole('menuitem', { name: e.steps.moveDown })).toBeNull();
    });

    it('Move up swaps a step with the one above, timer and all', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive();

        await user.click(within(await openMenu(user, 2)).getByRole('menuitem', { name: e.steps.moveUp }));

        expect(lastValues(onChange).steps).toEqual([THREE[1], THREE[0], THREE[2]]);
    });

    it('Move down swaps a step with the one below', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive();

        await user.click(within(await openMenu(user, 2)).getByRole('menuitem', { name: e.steps.moveDown }));

        expect(lastValues(onChange).steps).toEqual([THREE[0], THREE[2], THREE[1]]);
    });

    it('Remove step removes that step', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive();

        await user.click(within(await openMenu(user, 2)).getByRole('menuitem', { name: e.steps.remove }));

        expect(lastValues(onChange).steps).toEqual([THREE[0], THREE[2]]);
        expect(instructions()).toEqual(['Toast the rice.', 'Stir in the cheese.']);
    });
});

describe('RecipeInstructionsFields (web) — focus after a move or a remove (SC 2.4.3)', () => {
    const trigger = (n: number): HTMLElement =>
        screen.getByRole('button', { name: e.steps.actions.replace('{n}', String(n)) });

    it('Move down leaves focus on the moved step`s ⋯, at its new place', async () => {
        const user = userEvent.setup();
        renderLive();

        await user.click(within(await openMenu(user, 2)).getByRole('menuitem', { name: e.steps.moveDown }));

        expect(document.activeElement).toBe(trigger(3));
    });

    it('Move up leaves focus on the moved step`s ⋯, at its new place', async () => {
        const user = userEvent.setup();
        renderLive();

        await user.click(within(await openMenu(user, 3)).getByRole('menuitem', { name: e.steps.moveUp }));

        expect(document.activeElement).toBe(trigger(2));
    });

    it('removing the last step moves focus to the step now last', async () => {
        const user = userEvent.setup();
        renderLive();

        await user.click(within(await openMenu(user, 3)).getByRole('menuitem', { name: e.steps.remove }));

        expect(document.activeElement).toBe(trigger(2));
    });

    it('removing a middle step moves focus to the step that took its place', async () => {
        const user = userEvent.setup();
        renderLive();

        await user.click(within(await openMenu(user, 1)).getByRole('menuitem', { name: e.steps.remove }));

        expect(document.activeElement).toBe(trigger(1));
        expect(stepBox(1).value).toBe('Add the stock.');
    });

    it('removing the only step moves focus to Add step', async () => {
        const user = userEvent.setup();
        renderLive({ initial: withSteps([{ instruction: 'Boil.' }]) });

        await user.click(within(await openMenu(user, 1)).getByRole('menuitem', { name: e.steps.remove }));

        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByRole('button', { name: e.steps.add }));
        });
    });
});

describe('RecipeInstructionsFields (web) — adding steps', () => {
    it('"Add step" appends an empty step at the end', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive();

        await user.click(screen.getByRole('button', { name: e.steps.add }));

        expect(lastValues(onChange).steps).toEqual([...THREE, { instruction: '' }]);
        expect(stepBox(4).value).toBe('');
    });

    it.each([
        ['Ctrl', { ctrlKey: true }],
        ['Cmd', { metaKey: true }],
    ])('%s+Enter in a step adds a step, and adds no line break', (_key, modifier) => {
        const { onChange } = renderLive();

        const accepted = fireEvent.keyDown(stepBox(1), { key: 'Enter', ...modifier });

        expect(accepted).toBe(false);
        expect(lastValues(onChange).steps).toHaveLength(4);
    });

    it('a Ctrl+Enter that confirms an input method`s composition adds no step', () => {
        const { onChange } = renderLive();

        fireEvent.keyDown(stepBox(1), { key: 'Enter', ctrlKey: true, isComposing: true });

        expect(onChange).not.toHaveBeenCalled();
    });

    it('a plain Enter adds no step', () => {
        const { onChange } = renderLive();

        fireEvent.keyDown(stepBox(1), { key: 'Enter' });

        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('RecipeInstructionsFields (web) — empty and refused', () => {
    it('with no steps: "No steps yet." and Add step, and no list', () => {
        renderLive({ initial: withSteps([]) });

        expect(screen.getByText(e.steps.empty)).toBeTruthy();
        expect(screen.queryByRole('list')).toBeNull();
        expect(screen.getByRole('button', { name: e.steps.add })).toBeTruthy();
    });

    it('a refused publish with no steps says "Add at least one step."', () => {
        renderLive({ initial: withSteps([]), errors: { steps: 'stepsRequired' } });

        expect(screen.getByRole('alert').textContent).toBe(e.steps.required);
    });

    it('a refused publish with an empty step marks THAT field, linked to the message at the top of the list', () => {
        renderLive({
            initial: withSteps([{ instruction: 'Boil.' }, { instruction: '  ' }]),
            errors: { steps: 'stepsRequired' },
        });

        const alert = screen.getByRole('alert');

        expect(alert.textContent).toBe(e.index.reason.stepBlank);
        expect(alert.compareDocumentPosition(screen.getByRole('list')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(stepBox(2).getAttribute('aria-invalid')).toBe('true');
        expect(stepBox(2).getAttribute('aria-describedby')).toBe(alert.id);
        expect(stepBox(1).getAttribute('aria-invalid')).toBeNull();
        expect(stepBox(1).getAttribute('aria-describedby')).toBeNull();
    });
});

describe('RecipeInstructionsFields (web) — the blur checkpoint', () => {
    it('calls onFieldBlur when a step field loses focus, not when a button does', async () => {
        const user = userEvent.setup();
        const onFieldBlur = vi.fn();
        renderLive({ onFieldBlur });

        await user.click(stepBox(1));
        await user.click(screen.getByRole('button', { name: e.steps.add }));
        expect(onFieldBlur).toHaveBeenCalledTimes(1);

        await user.click(document.body);
        expect(onFieldBlur).toHaveBeenCalledTimes(1);
    });
});
