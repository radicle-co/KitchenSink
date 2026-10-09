import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

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

        expect(field.getAttribute('aria-invalid')).not.toBe('true');
        expect(field.getAttribute('aria-describedby')).toBeNull();
        expect(getComputedStyle(field).borderTopColor).toBe(rgb(role.lineControl));
    });

    it('marks itself invalid with a danger edge, described by the message the caller names', () => {
        render(
            <>
                <LabelledInput invalid describedBy="email-error" />
                <span id="email-error">Enter a valid email</span>
            </>,
        );

        const field = screen.getByRole('textbox', { name: 'Email' });

        expect(field.getAttribute('aria-invalid')).toBe('true');
        expect(field.getAttribute('aria-describedby')).toBe('email-error');
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

describe('TextArea (native)', () => {
    /**
     * Type into the field with the content standing at `height`. react-native-web measures a multi-line field's content
     * from the DOM node's `scrollHeight` on each change and reports it through `onContentSizeChange` — the same path a
     * device takes — and jsdom lays nothing out, so the measurement is supplied here.
     */
    let contentHeight = 0;

    const grow = (height: number): void => {
        contentHeight = height;
        fireEvent.change(screen.getByRole('textbox', { name: 'Steps' }), { target: { value: `line ${height}` } });
    };

    beforeEach(() => {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
            configurable: true,
            get: () => contentHeight,
        });
    });

    afterEach(() => {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
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

        expect(field.getAttribute('aria-invalid')).toBe('true');
        expect(getComputedStyle(field).borderTopColor).toBe(rgb(role.danger));
    });

    it('grows with its content, and stops at its maximum rows', () => {
        render(
            <>
                <FieldLabel forId="steps" label="Steps" />
                <TextArea id="steps" value="" onChangeText={vi.fn()} minRows={2} maxRows={4} />
            </>,
        );

        const line = nativeTokens.type.body.lineHeight ?? 0;
        const field = (): HTMLElement => screen.getByRole('textbox', { name: 'Steps' });

        grow(3 * line);
        expect(getComputedStyle(field()).height).toBe(`${3 * line + 34}px`);

        grow(10 * line);
        expect(getComputedStyle(field()).height).toBe(`${4 * line + 34}px`);

        grow(line);
        expect(getComputedStyle(field()).height).toBe(`${2 * line + 34}px`);
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
