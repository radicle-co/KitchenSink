/**
 * Native component tests for the Steps leaf, `RecipeInstructionsFields.native` (`docs/design/uiOverhaul/buildSpec.md`
 * §7.6, §7.12), rendered through react-native-web under jsdom. Mirrors `RecipeInstructionsFields.test.tsx`, except the
 * Ctrl/Cmd+Enter shortcut, which §7.12 drops on native, and the blur checkpoint, which no native field reports.
 *
 * Moved here from `recipeFieldGroups.native.test.tsx`, whose instructions blocks pinned the wizard-era row.
 *
 * ⚠️ NOT pinned: "the new step's field takes focus" — see the web file's note.
 */
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { useState, type FC } from 'react';

import { AccessibilityInfo } from 'react-native';

import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...withSystemScheme(actual),
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
    };
});

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { editorMessages } from '../../editor/messages.js';
import { RecipeInstructionsFields } from '../RecipeInstructionsFields.native.js';
import type { RecipeFormErrors } from '../validate.js';
import { defaultRecipeFormValues, type RecipeFormStep, type RecipeFormValues } from '../values.js';

const e = editorMessages.en;

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

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
}

const Harness: FC<HarnessProps> = ({ initial, errors, onChange }) => {
    const [values, setValues] = useState(initial);

    return (
        <RecipeInstructionsFields
            values={values}
            {...(errors === undefined ? {} : { errors })}
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
const item = (index: number): HTMLElement => screen.getAllByRole('listitem')[index] ?? document.body;

/** Open a step's menu (a sheet on native) and press one of its items. */
const choose = (n: number, action: string): void => {
    fireEvent.click(screen.getByRole('button', { name: e.steps.actions.replace('{n}', String(n)) }));
    fireEvent.click(screen.getByRole('menuitem', { name: action }));
};

describe('RecipeInstructionsFields (native) — the list', () => {
    it('is a list of steps, each a labelled multi-line field', () => {
        renderLive();

        expect(screen.getAllByRole('listitem')).toHaveLength(3);
        expect(stepBox(2).value).toBe('Add the stock.');
        expect(stepBox(2).tagName).toBe('TEXTAREA');
        expect(screen.queryByRole('heading')).toBeNull();
    });

    it.each(['light', 'dark'] as const)('paints the numeral in the selected fill in the %s scheme', (scheme) => {
        systemScheme.current = scheme;
        renderLive();

        const numeral = within(item(0)).getByText('1');
        const theme = scheme === 'dark' ? roleDark : role;

        expect(getComputedStyle(numeral.parentElement ?? numeral).backgroundColor).toBe(rgb(theme.selectedFill));
        expect(getComputedStyle(numeral).color).toBe(rgb(theme.ink));
    });

    it('a return inserts a line break', () => {
        const { onChange } = renderLive({ initial: withSteps([{ instruction: '' }]) });

        fireEvent.change(stepBox(1), { target: { value: 'Boil\nSalt' } });

        expect(lastValues(onChange).steps).toEqual([{ instruction: 'Boil\nSalt' }]);
    });
});

describe('RecipeInstructionsFields (native) — the timer', () => {
    it('"Add a timer" reveals an empty Timer field; "Remove timer" clears and hides it', () => {
        const { onChange } = renderLive();

        expect(within(item(0)).queryByRole('group', { name: e.steps.timerLabel })).toBeNull();
        fireEvent.click(within(item(0)).getByRole('button', { name: e.steps.addTimer }));
        expect(within(item(0)).getByRole('group', { name: e.steps.timerLabel })).toBeTruthy();

        fireEvent.change(within(item(0)).getByLabelText('Step 1 timer, minutes'), { target: { value: '5' } });
        expect(lastValues(onChange).steps[0]).toEqual({ instruction: 'Toast the rice.', timerSeconds: 300 });

        fireEvent.click(within(item(0)).getByRole('button', { name: e.steps.removeTimer }));
        expect(lastValues(onChange).steps[0]).toEqual({ instruction: 'Toast the rice.' });
        expect(within(item(0)).queryByRole('group', { name: e.steps.timerLabel })).toBeNull();
    });

    it('a step with a timer shows it, with "Remove timer"', () => {
        renderLive();

        expect(within(item(1)).getByLabelText<HTMLInputElement>('Step 2 timer, minutes').value).toBe('20');
        expect(within(item(1)).getByRole('button', { name: e.steps.removeTimer })).toBeTruthy();
    });

    it('a revealed, still-empty timer follows its step when it moves', () => {
        renderLive();

        fireEvent.click(within(item(0)).getByRole('button', { name: e.steps.addTimer }));
        choose(1, e.steps.moveDown);

        expect(stepBox(2).value).toBe('Toast the rice.');
        expect(within(item(1)).getByRole('group', { name: e.steps.timerLabel })).toBeTruthy();
        expect(within(item(2)).queryByRole('group', { name: e.steps.timerLabel })).toBeNull();
    });
});

describe('RecipeInstructionsFields (native) — the step menu', () => {
    it('offers no Move up on the first step and no Move down on the last', () => {
        renderLive();

        fireEvent.click(screen.getByRole('button', { name: 'Actions for step 1' }));
        expect(screen.queryByRole('menuitem', { name: e.steps.moveUp })).toBeNull();
        expect(screen.getByRole('menuitem', { name: e.steps.moveDown })).toBeTruthy();
        cleanup();

        renderLive();
        fireEvent.click(screen.getByRole('button', { name: 'Actions for step 3' }));
        expect(screen.getByRole('menuitem', { name: e.steps.moveUp })).toBeTruthy();
        expect(screen.queryByRole('menuitem', { name: e.steps.moveDown })).toBeNull();
    });

    it.each([
        [e.steps.moveUp, [1, 0, 2]],
        [e.steps.moveDown, [0, 2, 1]],
    ])('%s on the middle step reorders', (action, order) => {
        const { onChange } = renderLive();

        choose(2, action);

        expect(lastValues(onChange).steps).toEqual(order.map((index) => THREE[index]));
    });

    it('Remove step removes it', () => {
        const { onChange } = renderLive();

        choose(2, e.steps.remove);

        expect(lastValues(onChange).steps).toEqual([THREE[0], THREE[2]]);
    });
});

describe('RecipeInstructionsFields (native) — focus after a move (SC 2.4.3)', () => {
    it('moves the screen-reader cursor to the moved step`s ⋯', () => {
        renderLive();
        vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();

        choose(2, e.steps.moveDown);

        const focused = vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls.at(-1);

        expect(focused?.[1]).toBe('focus');
        expect(focused?.[0]).toBe(screen.getByRole('button', { name: 'Actions for step 3' }));
    });
});

describe('RecipeInstructionsFields (native) — adding, empty and refused', () => {
    it('"Add step" appends an empty step', () => {
        const { onChange } = renderLive();

        fireEvent.click(screen.getByRole('button', { name: e.steps.add }));

        expect(lastValues(onChange).steps).toEqual([...THREE, { instruction: '' }]);
    });

    it('with no steps: "No steps yet." and Add step', () => {
        renderLive({ initial: withSteps([]) });

        expect(screen.getByText(e.steps.empty)).toBeTruthy();
        expect(screen.queryAllByRole('listitem')).toHaveLength(0);
        expect(screen.getByRole('button', { name: e.steps.add })).toBeTruthy();
    });

    it('a refused publish with no steps says "Add at least one step."', () => {
        renderLive({ initial: withSteps([]), errors: { steps: 'stepsRequired' } });

        expect(screen.getByRole('alert').textContent).toBe(e.steps.required);
    });

    it('a refused publish with an empty step marks that field, linked to the message', () => {
        renderLive({
            initial: withSteps([{ instruction: 'Boil.' }, { instruction: '' }]),
            errors: { steps: 'stepsRequired' },
        });

        const alert = screen.getByRole('alert');

        expect(alert.textContent).toBe(e.index.reason.stepBlank);
        expect(stepBox(2).getAttribute('aria-invalid')).toBe('true');
        expect(stepBox(2).getAttribute('aria-describedby')).toBe(alert.id);
        expect(stepBox(1).getAttribute('aria-invalid')).not.toBe('true');
    });
});
