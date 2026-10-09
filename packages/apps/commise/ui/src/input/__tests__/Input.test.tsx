import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { FieldLabel } from '../FieldLabel.js';
import { Input } from '../Input.js';
import { TextArea } from '../TextArea.js';
import { fieldHintId } from '../props.js';

/**
 * Input, TextArea and FieldLabel (web) — the text-field geometry of `docs/design/uiOverhaul/buildSpec.md` §1.11: a
 * 12 px rectangle with a 1 px `lineControl` edge, 48 tall, the `body` role, 16 of padding, a `danger` edge when
 * invalid. `FieldLabel` is the visible label above every field and owns the `htmlFor` association.
 *
 * jsdom lays nothing out, so geometry is pinned on the class contract; the rendered size is `controlLabels.spec.ts`'s.
 */

afterEach(cleanup);

const tokensOf = (element: Element): readonly string[] => element.className.split(/\s+/u);

describe('Input + FieldLabel (web)', () => {
    it('is named by its visible FieldLabel through htmlFor', () => {
        render(
            <>
                <FieldLabel forId="email" label="Email" />
                <Input id="email" value="" onChangeText={vi.fn()} />
            </>,
        );

        expect(screen.getByRole('textbox', { name: 'Email' }).id).toBe('email');
    });

    it('renders the controlled value and reports each edit', async () => {
        const user = userEvent.setup();
        const onChangeText = vi.fn();
        render(
            <>
                <FieldLabel forId="email" label="Email" />
                <Input id="email" value="" onChangeText={onChangeText} />
            </>,
        );

        await user.type(screen.getByRole('textbox', { name: 'Email' }), 'a');

        expect(onChangeText).toHaveBeenCalledWith('a');
    });

    it('draws the spec geometry on the lineControl edge, in the body role', () => {
        render(<Input id="email" value="" onChangeText={vi.fn()} />);

        expect(tokensOf(screen.getByRole('textbox'))).toEqual(
            expect.arrayContaining([
                'rounded-md',
                'border',
                'border-line-control',
                'min-h-12',
                'px-4',
                'text-body',
                'bg-paper',
                'text-ink',
                'placeholder:text-ink-muted',
            ]),
        );
    });

    it('shows the focusRing on keyboard focus and is dimmed to 40% when disabled', () => {
        render(<Input id="email" value="" onChangeText={vi.fn()} />);

        expect(tokensOf(screen.getByRole('textbox'))).toEqual(
            expect.arrayContaining(['focus-visible:ring-2', 'focus-visible:ring-focus-ring', 'disabled:opacity-40']),
        );
    });

    it('is valid by default, and invalid with a danger edge, described by the message the caller names', () => {
        const { rerender } = render(<Input id="email" value="" onChangeText={vi.fn()} />);
        const field = screen.getByRole('textbox');

        expect(field.getAttribute('aria-invalid')).toBeNull();
        expect(field.getAttribute('aria-describedby')).toBeNull();

        rerender(<Input id="email" value="" onChangeText={vi.fn()} invalid describedBy="email-error" />);

        expect(field.getAttribute('aria-invalid')).toBe('true');
        expect(field.getAttribute('aria-describedby')).toBe('email-error');
        expect(tokensOf(field)).toContain('aria-invalid:border-danger');
    });

    it('passes the keyboard, autofill and return-key hints through', () => {
        render(
            <Input
                id="email"
                value=""
                onChangeText={vi.fn()}
                inputMode="email"
                autoComplete="email"
                enterKeyHint="next"
            />,
        );

        const field = screen.getByRole('textbox');

        expect(field.getAttribute('inputmode')).toBe('email');
        expect(field.getAttribute('autocomplete')).toBe('email');
        expect(field.getAttribute('enterkeyhint')).toBe('next');
    });

    it('is a password field when secret', () => {
        const { container } = render(<Input id="password" value="" onChangeText={vi.fn()} secret />);

        expect(container.querySelector('input')?.type).toBe('password');
    });

    it('cannot be edited when disabled', () => {
        render(<Input id="email" value="" onChangeText={vi.fn()} disabled />);

        expect(screen.getByRole<HTMLInputElement>('textbox').disabled).toBe(true);
    });

    it('reports Enter as a submit', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        render(<Input id="email" value="" onChangeText={vi.fn()} onSubmit={onSubmit} />);

        await user.type(screen.getByRole('textbox'), '{Enter}');

        expect(onSubmit).toHaveBeenCalledOnce();
    });
});

/**
 * A field a host shows on demand (the editor's group-name field) takes focus when asked: a LEVEL the host clears on
 * acknowledgement, as `Button`'s, so a field that mounts while the request stands still takes it.
 */
describe('Input (web) — a focus request', () => {
    it('takes focus when asked, and acknowledges once', () => {
        const onHandled = vi.fn();
        render(
            <>
                <FieldLabel forId="group" label="Group name" />
                <Input id="group" value="" onChangeText={vi.fn()} focusRequested onFocusRequestHandled={onHandled} />
            </>,
        );

        expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Group name' }));
        expect(onHandled).toHaveBeenCalledTimes(1);
    });

    it('does not take focus unasked', () => {
        render(
            <>
                <FieldLabel forId="group" label="Group name" />
                <Input id="group" value="" onChangeText={vi.fn()} />
            </>,
        );

        expect(document.activeElement).toBe(document.body);
    });
});

describe('FieldLabel (web)', () => {
    it('sets the label in the label role, in inkMuted', () => {
        render(<FieldLabel forId="title" label="Title" />);

        expect(tokensOf(screen.getByText('Title'))).toEqual(expect.arrayContaining(['text-label', 'text-ink-muted']));
    });

    it('renders a hint in the caption role, under the id a field describes itself by', () => {
        render(<FieldLabel forId="title" label="Title" hint="Up to 120 characters" />);

        const hint = screen.getByText('Up to 120 characters');

        expect(hint.id).toBe(fieldHintId('title'));
        expect(tokensOf(hint)).toContain('text-caption');
    });

    it('renders no hint when none is given', () => {
        const { container } = render(<FieldLabel forId="title" label="Title" />);

        expect(container.querySelector(`#${fieldHintId('title')}`)).toBeNull();
    });
});

describe('TextArea (web)', () => {
    it('is a multi-line field named by its FieldLabel, starting at its minimum rows', () => {
        render(
            <>
                <FieldLabel forId="steps" label="Steps" />
                <TextArea id="steps" value="" onChangeText={vi.fn()} minRows={3} />
            </>,
        );

        const field = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Steps' });

        expect(field.tagName).toBe('TEXTAREA');
        expect(field.rows).toBe(3);
    });

    it('grows with its content by field-sizing, bounded by min and max rows', () => {
        render(<TextArea id="steps" value="" onChangeText={vi.fn()} minRows={2} maxRows={6} />);

        const field = screen.getByRole<HTMLTextAreaElement>('textbox');

        expect(tokensOf(field)).toContain('field-sizing-content');
        expect(field.style.minHeight).toBe('calc(2lh + 2px + 2rem)');
        expect(field.style.maxHeight).toBe('calc(6lh + 2px + 2rem)');
    });

    it('has no upper bound when no maximum is given', () => {
        render(<TextArea id="steps" value="" onChangeText={vi.fn()} minRows={2} />);

        expect(screen.getByRole<HTMLTextAreaElement>('textbox').style.maxHeight).toBe('');
    });

    it('shares the Input geometry and invalid state', () => {
        render(<TextArea id="steps" value="" onChangeText={vi.fn()} minRows={2} invalid describedBy="steps-error" />);

        const field = screen.getByRole('textbox');

        expect(tokensOf(field)).toEqual(
            expect.arrayContaining(['rounded-md', 'border-line-control', 'px-4', 'text-body']),
        );
        expect(field.getAttribute('aria-invalid')).toBe('true');
        expect(field.getAttribute('aria-describedby')).toBe('steps-error');
    });

    it('reports each edit', async () => {
        const user = userEvent.setup();
        const onChangeText = vi.fn();
        render(<TextArea id="steps" value="" onChangeText={onChangeText} minRows={2} />);

        await user.type(screen.getByRole('textbox'), 'S');

        expect(onChangeText).toHaveBeenCalledWith('S');
    });
});

/** A field with a length limit stops the text at the limit, so a too-long value is never typed in the first place. */
describe('Input (web) — a length limit', () => {
    function Controlled({ maxLength }: { readonly maxLength?: number }) {
        const [value, setValue] = useState('');

        return (
            <>
                <FieldLabel forId="name" label="Name" />
                <Input
                    id="name"
                    value={value}
                    onChangeText={setValue}
                    {...(maxLength === undefined ? {} : { maxLength })}
                />
            </>
        );
    }

    it('stops typing at maxLength', async () => {
        const user = userEvent.setup();
        render(<Controlled maxLength={5} />);

        await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Abcdefgh');

        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Name' }).value).toBe('Abcde');
    });

    it('has no limit when none is given', async () => {
        const user = userEvent.setup();
        render(<Controlled />);

        await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Abcdefgh');

        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Name' }).value).toBe('Abcdefgh');
    });
});
