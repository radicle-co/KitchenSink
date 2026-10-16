import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { Platform } from 'react-native';

import { placeholderContrast } from '@commise/test-utils';

import { FieldLabel } from '../FieldLabel.native.js';
import { Input } from '../Input.native.js';
import { TextArea } from '../TextArea.native.js';
import { fieldHintId } from '../props.js';
import { role } from '../../tokens/colors.js';
import { nativeTokens } from '../../tokens/native.js';

/**
 * Input, TextArea and FieldLabel (native) — rendered via react-native-web under jsdom.
 *
 * ⚠️ REWRITTEN in slice 2 of the UI overhaul (`docs/architecture/uiOverhaulBlueprint.md` Part B, the Input contract):
 * the label and the error slot are no longer inside `Input`. `FieldLabel` is a separate primitive that owns the label
 * association (its `nativeID`, which the field's `aria-labelledby` names by id convention), and `Input` takes `invalid`
 * and `describedBy`, so the caller places a message wherever its layout needs one. The geometry is the spec's (§1.11:
 * 12 px radius, a 1 px `lineControl` edge, 48 tall, the `body` role, 16 of padding; a `danger` edge when invalid).
 */

afterEach(cleanup);

/** `#RRGGBB` → jsdom's `rgb(r, g, b)`. */
function rgb(hex: string): string {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
}

/** A labelled field, as every caller composes it. */
const LabelledInput = (props: Partial<Parameters<typeof Input>[0]> & { readonly hint?: string }) => (
    <>
        <FieldLabel forId="email" label="Email" {...(props.hint === undefined ? {} : { hint: props.hint })} />
        <Input id="email" value="" onChangeText={vi.fn()} {...props} />
    </>
);

describe('Input + FieldLabel (native)', () => {
    it('takes its accessible name from the visible FieldLabel, by aria-labelledby', () => {
        render(<LabelledInput />);

        const field = screen.getByRole('textbox', { name: 'Email' });
        const labelledby = field.getAttribute('aria-labelledby');

        expect(document.getElementById(labelledby ?? '')?.textContent).toBe('Email');
    });

    it('renders the controlled value and reports edits', () => {
        const onChangeText = vi.fn();
        render(<LabelledInput value="a@b.com" onChangeText={onChangeText} />);

        const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'Email' });
        expect(field.value).toBe('a@b.com');

        fireEvent.change(field, { target: { value: 'c@d.com' } });
        expect(onChangeText).toHaveBeenCalledWith('c@d.com');
    });

    it('is valid by default, with a lineControl edge and no description', () => {
        render(<LabelledInput />);

        const field = screen.getByRole('textbox', { name: 'Email' });

        expect(getComputedStyle(field).borderTopColor).toBe(rgb(role.lineControl));
    });

    // REWRITTEN: this used to assert `aria-invalid` and `aria-describedby` in the DOM, which react-native-web maps and a
    // device ignores. The spoken error and the iOS name are asserted in `FieldAccessibility.native.test.tsx`; what is
    // left to see here is the edge.
    it('marks itself invalid with a danger edge', () => {
        render(<LabelledInput invalid />);

        const field = screen.getByRole('textbox', { name: 'Email' });

        expect(getComputedStyle(field).borderTopColor).toBe(rgb(role.danger));
    });

    // The TYPE role is pinned on `fieldSurface` (`fieldStyle.test.ts`): jsdom lets react-native-web's static
    // `font: 14px System` shorthand outrank the atomic longhands, so a computed font here reads the shim, not the field.
    it('draws the spec geometry: 12 radius, a 1 px edge, 48 tall, 16 padding', () => {
        render(<LabelledInput />);

        const style = getComputedStyle(screen.getByRole('textbox', { name: 'Email' }));

        expect(style.borderTopLeftRadius).toBe('12px');
        expect(style.borderTopWidth).toBe('1px');
        expect(style.minHeight).toBe('48px');
        expect(style.paddingLeft).toBe('16px');
    });

    it('hides what it is given as secret', () => {
        render(<LabelledInput secret />);

        expect(screen.getByLabelText('Email').getAttribute('type')).toBe('password');
    });

    it('passes the keyboard, autofill and return-key hints through', () => {
        render(<LabelledInput inputMode="email" autoComplete="email" enterKeyHint="next" />);

        const field = screen.getByRole('textbox', { name: 'Email' });

        expect(field.getAttribute('inputmode')).toBe('email');
        expect(field.getAttribute('autocomplete')).toBe('email');
        expect(field.getAttribute('enterkeyhint')).toBe('next');
    });

    it.each(['given-name', 'family-name'] as const)(
        'offers the %s autofill a sign-up name field needs (WCAG 2.2 SC 1.3.5)',
        (autoComplete) => {
            render(<LabelledInput autoComplete={autoComplete} />);

            expect(screen.getByRole('textbox', { name: 'Email' }).getAttribute('autocomplete')).toBe(autoComplete);
        },
    );

    it('turns autocorrect AND spellcheck off when asked (a username is not a word)', () => {
        render(<LabelledInput autoCorrect={false} />);

        const field = screen.getByRole('textbox', { name: 'Email' });

        expect(field.getAttribute('autocorrect')).toBe('off');
        expect(field.getAttribute('spellcheck')).toBe('false');
    });

    it('cannot be edited when disabled, and dims to 40%', () => {
        render(<LabelledInput disabled />);

        const field = screen.getByRole('textbox', { name: 'Email' });

        expect(field.hasAttribute('readonly')).toBe(true);
        expect(getComputedStyle(field).opacity).toBe('0.4');
    });

    it('reports a submit from the keyboard', () => {
        const onSubmit = vi.fn();
        render(<LabelledInput onSubmit={onSubmit} />);

        fireEvent.keyDown(screen.getByRole('textbox', { name: 'Email' }), { key: 'Enter' });

        expect(onSubmit).toHaveBeenCalledOnce();
    });

    it('draws the PLACEHOLDER above the WCAG AA body-text floor on its paper field', () => {
        render(<LabelledInput placeholder="you@example.com" />);

        expect(placeholderContrast(screen.getByRole('textbox', { name: 'Email' }))).toBeGreaterThanOrEqual(4.5);
    });
});

describe('FieldLabel (native)', () => {
    it('sets the label in the label role, in inkMuted', () => {
        render(<FieldLabel forId="title" label="Title" />);

        const label = getComputedStyle(screen.getByText('Title'));

        expect(label.fontFamily).toBe(nativeTokens.type.label.fontFamily);
        expect(label.color).toBe(rgb(role.inkMuted));
    });

    it('renders a hint in the caption role under the label, under the id the field describes itself by', () => {
        render(<FieldLabel forId="title" label="Title" hint="Up to 120 characters" />);

        const hint = screen.getByText('Up to 120 characters');

        expect(hint.id).toBe(fieldHintId('title'));
        expect(getComputedStyle(hint).fontFamily).toBe(nativeTokens.type.caption.fontFamily);
    });

    it('renders no hint when none is given', () => {
        const { container } = render(<FieldLabel forId="title" label="Title" />);

        expect(container.querySelector(`#${fieldHintId('title')}`)).toBeNull();
    });
});

describe('FieldLabel → field focus (native)', () => {
    // A web `<label for>` focuses its field when pressed; React Native has no label element, so the native label
    // asks the field it names to take focus. Maestro's `tapOn: 'Name'` is that press (the new-collection sheet's
    // Name field never took focus from it, so the flow typed into nothing and its Back closed the sheet).
    it('focuses the Input it names when the label is pressed', () => {
        render(<LabelledInput />);

        fireEvent.click(screen.getByText('Email'));

        expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Email' }));
    });

    it('focuses the TextArea it names when the label is pressed', () => {
        render(
            <>
                <FieldLabel forId="notes" label="Notes" />
                <TextArea id="notes" value="" onChangeText={vi.fn()} minRows={2} />
                <FieldLabel forId="other" label="Other" />
                <Input id="other" value="" onChangeText={vi.fn()} />
            </>,
        );

        fireEvent.click(screen.getByText('Notes'));

        expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Notes' }));
        expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: 'Other' }));
    });

    it('focuses the field again after it remounts, and nothing once it has gone', () => {
        const { rerender } = render(<LabelledInput key="first" />);
        rerender(<LabelledInput key="second" />);

        fireEvent.click(screen.getByText('Email'));
        expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Email' }));

        rerender(<FieldLabel forId="email" label="Email" />);
        expect(() => fireEvent.click(screen.getByText('Email'))).not.toThrow();
    });

    it('adds no control of its own: the label is text, not a button', () => {
        render(<LabelledInput />);

        expect(screen.queryByRole('button')).toBeNull();
    });
});

describe('TextArea (native) — a focus request', () => {
    // A-008 / E2 (build spec §7.6: "The new step's field takes focus"): the editor asks the step it just added for focus.
    it('takes focus when asked, and acknowledges once', () => {
        const onHandled = vi.fn();
        render(
            <>
                <FieldLabel forId="step" label="Step 2" />
                <TextArea
                    id="step"
                    value=""
                    onChangeText={vi.fn()}
                    minRows={2}
                    focusRequested
                    onFocusRequestHandled={onHandled}
                />
            </>,
        );

        expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Step 2' }));
        expect(onHandled).toHaveBeenCalledTimes(1);
    });

    it('does not take focus unasked', () => {
        render(<TextArea id="step" value="" onChangeText={vi.fn()} minRows={2} />);

        expect(document.activeElement).toBe(document.body);
    });
});

describe('TextArea (native)', () => {
    /**
     * jsdom lays nothing out, so the measurement is supplied. `textHeight` is the text's own height. With
     * `reportsPadding` the stub measures like react-native-web, whose `scrollHeight` is the larger of the box's padding
     * box (its current height less the edge) and the text plus BOTH paddings; without it, like a device, whose content
     * size is the text alone. Typing re-measures, which is also how the web shim is re-measured after a height change.
     */
    let textHeight = 0;
    let reportsPadding = true;

    const field = (): HTMLElement => screen.getByRole('textbox', { name: 'Steps' });
    const heightOf = (): string => getComputedStyle(field()).height;

    const renderSteps = (minRows: number, maxRows?: number): void => {
        render(
            <>
                <FieldLabel forId="steps" label="Steps" />
                <TextArea id="steps" value="" onChangeText={vi.fn()} minRows={minRows} maxRows={maxRows} />
            </>,
        );
    };

    const measure = (height: number): void => {
        textHeight = height;
        fireEvent.change(field(), { target: { value: `line ${height} ${Math.random()}` } });
    };

    beforeEach(() => {
        textHeight = 0;
        reportsPadding = true;
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
            configurable: true,
            get(this: HTMLElement) {
                if (!reportsPadding) {
                    return textHeight;
                }

                const box = parseFloat(getComputedStyle(this).height) - 2;

                return Math.max(Number.isNaN(box) ? 0 : box, textHeight + 32);
            },
        });
    });

    afterEach(() => {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
    });

    it('reaches a fixed height under react-native-web and stays there when re-measured', () => {
        renderSteps(2);

        const line = nativeTokens.type.body.lineHeight ?? 0;
        measure(3 * line);
        const settled = heightOf();

        expect(settled).toBe(`${3 * line + 34}px`);

        for (let again = 0; again < 5; again += 1) {
            measure(3 * line);
        }

        expect(heightOf()).toBe(settled);
    });

    it('still grows to fit a device-style report, the text height alone', () => {
        reportsPadding = false;
        const original = Platform.OS;
        Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

        try {
            renderSteps(2, 4);

            const line = nativeTokens.type.body.lineHeight ?? 0;
            measure(3 * line);
            expect(heightOf()).toBe(`${3 * line + 34}px`);

            measure(10 * line);
            expect(heightOf()).toBe(`${4 * line + 34}px`);

            measure(line);
            expect(heightOf()).toBe(`${2 * line + 34}px`);
        } finally {
            Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
        }
    });

    it('is a multi-line field named by its FieldLabel', () => {
        render(
            <>
                <FieldLabel forId="steps" label="Steps" />
                <TextArea id="steps" value="" onChangeText={vi.fn()} minRows={3} />
            </>,
        );

        const field = screen.getByRole('textbox', { name: 'Steps' });

        expect(field.tagName).toBe('TEXTAREA');
    });

    it('starts at its minimum rows: three body lines plus padding and edge', () => {
        render(
            <>
                <FieldLabel forId="steps" label="Steps" />
                <TextArea id="steps" value="" onChangeText={vi.fn()} minRows={3} />
            </>,
        );

        const line = nativeTokens.type.body.lineHeight ?? 0;

        expect(getComputedStyle(screen.getByRole('textbox', { name: 'Steps' })).height).toBe(`${3 * line + 34}px`);
    });

    it('marks itself invalid with a danger edge', () => {
        render(
            <>
                <FieldLabel forId="steps" label="Steps" />
                <TextArea id="steps" value="" onChangeText={vi.fn()} minRows={2} invalid />
            </>,
        );

        const field = screen.getByRole('textbox', { name: 'Steps' });

        expect(getComputedStyle(field).borderTopColor).toBe(rgb(role.danger));
    });
});

/** A field a host shows on demand takes focus when asked (a level, acknowledged once), as `Button`'s request. */
describe('Input (native) — a focus request', () => {
    it('takes focus when asked, and acknowledges once', () => {
        const onHandled = vi.fn();
        render(<LabelledInput focusRequested onFocusRequestHandled={onHandled} />);

        expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Email' }));
        expect(onHandled).toHaveBeenCalledTimes(1);
    });

    it('does not take focus unasked', () => {
        render(<LabelledInput />);

        expect(document.activeElement).toBe(document.body);
    });
});

/** A field with a length limit hands it to the platform's text input, which stops the text at the limit. */
describe('Input (native) — a length limit', () => {
    it('passes maxLength to the text input', () => {
        render(<LabelledInput maxLength={5} />);

        expect(screen.getByRole('textbox', { name: 'Email' }).getAttribute('maxlength')).toBe('5');
    });

    it('has no limit when none is given', () => {
        render(<LabelledInput />);

        expect(screen.getByRole('textbox', { name: 'Email' }).hasAttribute('maxlength')).toBe(false);
    });
});
