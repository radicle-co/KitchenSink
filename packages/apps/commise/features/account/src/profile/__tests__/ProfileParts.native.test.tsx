/**
 * Native render leaves of the Profile page. Every state the page owns is asserted by role and name: the loading
 * skeleton, the failed header with its retry, the ready header, a pressable row in each tone, the hint, the busy
 * state, a link row, and the display-name sheet's field, Save gate and failure.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
// Its leaves draw through the design system's Tamagui `Text` (ADR-0080), so the tree renders in its provider.
import { render, renderWithTamagui, resolvedColour, resolvedStyle } from '@commise/ui/testing/tamagui';
import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import userEvent from '@testing-library/user-event';
import { AccessibilityInfo } from 'react-native';

import { recordedTextInputs } from '@commise/ui/testing/record-text-inputs';

// React Native has no `aria-invalid` or `aria-describedby`, and react-native-web drops `accessibilityHint`, so the field
// is wrapped to record what a screen reader is actually given.
vi.mock('@commise/ui/text-input', async (importOriginal) => {
    const { recordingTextInputModule } = await import('@commise/ui/testing/record-text-inputs');

    return recordingTextInputModule(await importOriginal<typeof import('@commise/ui/text-input')>());
});

/**
 * ⚠️ `sendAccessibilityEvent` is MOCKED because react-native-web does not implement it: what is proven is the contract
 * with React Native (the right node, the `'focus'` event, only on a CHANGED signal), not that a screen reader honours it.
 */
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { DisplayNameSheet } from '../DisplayNameSheet.native.js';
import { ProfileGroup } from '../ProfileGroup.native.js';
import { ProfileHeader } from '../ProfileHeader.native.js';
import { ProfileRow } from '../ProfileRow.native.js';
import { DISPLAY_NAME_MAX_LENGTH } from '../model.js';
import type { DisplayNameSheetProps, ProfileRowProps } from '../props.js';

afterEach(() => {
    cleanup();
    recordedTextInputs.clear();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

const noop = () => undefined;

describe('ProfileHeader (native)', () => {
    it('shows a busy skeleton while the profile loads, with no error', () => {
        render(<ProfileHeader read={{ status: 'loading' }} initials="" onRetry={noop} />);

        expect(screen.getByRole('status', { name: 'Loading your profile' })).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('shows the avatar and the display name once ready, with the initials decorative', () => {
        render(
            <ProfileHeader
                read={{ status: 'ready', displayName: 'Eliza Moreno', email: 'eliza@example.com', username: null }}
                initials="EM"
                onRetry={noop}
            />,
        );

        expect(screen.getByText('Eliza Moreno')).toBeTruthy();
        // S2: facts the page does not let you edit show once, in the Account group, never also in the header.
        expect(screen.queryByText('eliza@example.com')).toBeNull();
        expect(screen.getByText('EM').closest('[aria-hidden="true"]')).toBeTruthy();
    });

    // S2 (owner, 2026-10-27): the header is the avatar and the display name. The read-only username and email show once,
    // in the Account group (`ProfileAccountGroup`), so a cook sees each fact one time.
    it('shows neither the username nor the email in the header', () => {
        render(
            <ProfileHeader
                read={{ status: 'ready', displayName: 'Eliza Moreno', email: 'eliza@example.com', username: 'braise' }}
                initials="EM"
                onRetry={noop}
            />,
        );

        expect(screen.getByText('Eliza Moreno')).toBeTruthy();
        expect(screen.queryByText('@braise')).toBeNull();
        expect(screen.queryByText('eliza@example.com')).toBeNull();
    });

    // T8 (owner, 2026-10-29): with no display name, the header shows the @username next to the avatar.
    it('shows the @username when the cook has no display name', () => {
        render(
            <ProfileHeader
                read={{ status: 'ready', displayName: '', email: 'a@b.co', username: 'braise' }}
                initials=""
                onRetry={noop}
            />,
        );

        expect(screen.getByText('@braise')).toBeTruthy();
        expect(screen.queryByText('a@b.co')).toBeNull();
    });

    it('shows no text at all for a cook with no name yet — the page never invents one', () => {
        render(
            <ProfileHeader
                read={{ status: 'ready', displayName: '', email: 'a@b.co', username: null }}
                initials=""
                onRetry={noop}
            />,
        );

        expect(screen.queryByText('a@b.co')).toBeNull();
        expect(screen.queryByText('Add your name')).toBeNull();
    });

    it('reports a failed read with a Try again control that retries', async () => {
        const onRetry = vi.fn();

        render(<ProfileHeader read={{ status: 'failed' }} initials="" onRetry={onRetry} />);

        expect(screen.getByRole('alert').textContent).toContain('We couldn’t load your profile.');

        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledOnce();
    });
});

describe('ProfileHeader (native) — the avatar slot (A-025)', () => {
    const ready = { status: 'ready', displayName: 'Eliza Moreno', email: 'eliza@example.com', username: null } as const;

    it('draws the host’s avatar INSTEAD of the initials disc, so the page has one avatar', () => {
        render(<ProfileHeader read={ready} initials="EM" onRetry={noop} avatar={<span>Photo control</span>} />);

        expect(screen.getByText('Photo control')).toBeTruthy();
        expect(screen.queryByText('EM')).toBeNull();
        expect(screen.getByText('Eliza Moreno')).toBeTruthy();
        expect(screen.queryByText('eliza@example.com')).toBeNull();
    });

    it('still draws the initials disc when the host passes no avatar', () => {
        render(<ProfileHeader read={ready} initials="EM" onRetry={noop} />);

        expect(screen.getByText('EM')).toBeTruthy();
    });

    it('ignores the slot while loading: the skeleton is unchanged', () => {
        render(
            <ProfileHeader
                read={{ status: 'loading' }}
                initials=""
                onRetry={noop}
                avatar={<span>Photo control</span>}
            />,
        );

        expect(screen.getByRole('status', { name: 'Loading your profile' })).toBeTruthy();
        expect(screen.queryByText('Photo control')).toBeNull();
    });

    it('ignores the slot when the read failed: the failed header is unchanged', () => {
        render(
            <ProfileHeader
                read={{ status: 'failed' }}
                initials=""
                onRetry={noop}
                avatar={<span>Photo control</span>}
            />,
        );

        expect(screen.getByRole('alert').textContent).toContain('We couldn’t load your profile.');
        expect(screen.queryByText('Photo control')).toBeNull();
    });
});

describe('ProfileRow (native)', () => {
    const row = (overrides: Partial<ProfileRowProps> = {}): ProfileRowProps => ({
        label: 'Display name',
        tone: 'ink',
        chevron: true,
        onPress: noop,
        ...overrides,
    });

    it('is a button named for its label, whose value is part of what is announced', async () => {
        const onPress = vi.fn();

        render(<ProfileRow {...row({ value: 'Eliza', onPress })} />);

        const button = screen.getByRole('button', { name: /Display name/ });

        expect(button.textContent).toContain('Eliza');

        await userEvent.click(button);

        expect(onPress).toHaveBeenCalledOnce();
    });

    it('renders the danger tone as text, with its consequence hint inside the same control', () => {
        render(
            <ProfileRow {...row({ label: 'Close account', hint: 'Signs you out.', tone: 'danger', chevron: true })} />,
        );

        const button = screen.getByRole('button', { name: /Close account/ });

        expect(button.textContent).toContain('Signs you out.');
    });

    it('paints the danger label in a different colour from an ordinary row, and sign-out stays ordinary ink', () => {
        // REWRITTEN for ADR-0080: the label is the design system's Tamagui `Text`, which paints through a class and a
        // theme variable, not an inline style, so the colour is read through the resolver. The comparisons are as before.
        const colourOf = (label: string): string => resolvedColour(screen.getByText(label), 'color');

        render(
            <>
                <ProfileRow {...row({ label: 'Close account', tone: 'danger' })} />
                <ProfileRow {...row({ label: 'Sign out', tone: 'ink', chevron: false })} />
                <ProfileRow {...row({ label: 'Display name', tone: 'ink' })} />
            </>,
        );

        expect(colourOf('Close account')).not.toBe('');
        expect(colourOf('Close account')).not.toBe(colourOf('Display name'));
        expect(colourOf('Sign out')).toBe(colourOf('Display name'));
    });

    it('cannot be pressed again while busy, and says so', async () => {
        const onPress = vi.fn();

        render(<ProfileRow {...row({ busy: true, onPress })} />);

        const button = screen.getByRole('button');

        expect(button.getAttribute('aria-disabled')).toBe('true');

        await userEvent.click(button, { pointerEventsCheck: 0 });

        expect(onPress).not.toHaveBeenCalled();
    });

    // `inert` is a FACT ("this action is done"), not "in flight": presses are ignored and it reads as disabled, with no
    // busy semantics (`buildSpec.md` §9.1).
    it('cannot be pressed when inert, reads as disabled, and does not claim to be busy', async () => {
        const onPress = vi.fn();

        render(<ProfileRow {...row({ inert: true, onPress })} />);

        const button = screen.getByRole('button');

        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(button.getAttribute('aria-busy')).not.toBe('true');

        await userEvent.click(button, { pointerEventsCheck: 0 });

        expect(onPress).not.toHaveBeenCalled();
    });

    // §10 "Dialogs and sheets": focus returns to the trigger. A sheet this row opened cannot tell React Native where the
    // cursor was, so the host advances `focusSignal` when the sheet closes.
    it('takes the screen-reader cursor back when its focus signal advances, and not on mount', () => {
        const { rerender } = render(<ProfileRow {...row({ label: 'Food data sources', focusSignal: 0 })} />);

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();

        rerender(<ProfileRow {...row({ label: 'Food data sources', focusSignal: 1 })} />);

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByRole('button', { name: 'Food data sources' }),
            'focus',
        );
    });

    it('ignores a web destination: a row is a button that calls onPress', async () => {
        const onPress = vi.fn();

        render(<ProfileRow {...row({ label: 'Food data sources', href: '/en/legal/sources', onPress })} />);

        expect(screen.queryByRole('link')).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: /Food data sources/ }));

        expect(onPress).toHaveBeenCalledOnce();
    });
});

describe('ProfileGroup (native)', () => {
    it('names a group by its H2 heading', () => {
        render(
            <ProfileGroup heading="Preferences">
                <ProfileRow label="Email" tone="ink" chevron={false} onPress={() => undefined} />
            </ProfileGroup>,
        );

        expect(screen.getByRole('heading', { name: 'Preferences' })).toBeTruthy();
    });

    it('draws a group with no visible heading as its rows alone', () => {
        render(
            <ProfileGroup label="Account">
                <ProfileRow label="Email" tone="ink" chevron={false} onPress={() => undefined} />
            </ProfileGroup>,
        );

        expect(screen.getByText('Email')).toBeTruthy();
        expect(screen.queryByRole('heading')).toBeNull();
    });
});

describe('DisplayNameSheet (native)', () => {
    const sheet = (overrides: Partial<DisplayNameSheetProps> = {}): DisplayNameSheetProps => ({
        open: true,
        onOpenChange: noop,
        draft: 'Eliza',
        onDraftChange: noop,
        canSave: true,
        saving: false,
        failed: false,
        onSave: noop,
        ...overrides,
    });

    // `evaluateFinal.md` §4: the field repeated the sheet's title as its label. It is "Display name", with a hint.
    it('labels the field “Display name” and says where the name shows', () => {
        render(<DisplayNameSheet {...sheet()} />);

        expect(screen.getByText('Shown next to your username on recipes you publish.')).toBeTruthy();
        expect(screen.getAllByText('Display name').length).toBeGreaterThan(0);
    });

    it('is a dialog titled “What should we call you?” holding one labelled field with the draft', () => {
        render(<DisplayNameSheet {...sheet()} />);

        expect(screen.getByRole('heading', { name: 'What should we call you?' })).toBeTruthy();
        expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe('Eliza');
    });

    it('renders nothing while closed', () => {
        render(<DisplayNameSheet {...sheet({ open: false })} />);

        expect(screen.queryByRole('heading')).toBeNull();
    });

    it('reports each edit and saves only when Save is pressed', async () => {
        const onDraftChange = vi.fn();
        const onSave = vi.fn();

        render(<DisplayNameSheet {...sheet({ draft: '', onDraftChange, onSave })} />);

        await userEvent.type(screen.getByLabelText('Display name'), 'E');

        expect(onDraftChange).toHaveBeenCalledWith('E');
        expect(onSave).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSave).toHaveBeenCalledOnce();
    });

    it('submits on Enter, so the keyboard reaches Save too', async () => {
        const onSave = vi.fn();

        render(<DisplayNameSheet {...sheet({ onSave })} />);

        await userEvent.type(screen.getByLabelText('Display name'), '{Enter}');

        expect(onSave).toHaveBeenCalledOnce();
    });

    it('disables Save while the name cannot be saved, and never fires it', async () => {
        const onSave = vi.fn();

        render(<DisplayNameSheet {...sheet({ canSave: false, onSave })} />);

        const save = screen.getByRole('button', { name: 'Save' });

        expect(save.getAttribute('aria-disabled')).toBe('true');

        await userEvent.click(save, { pointerEventsCheck: 0 });

        expect(onSave).not.toHaveBeenCalled();
    });

    it('does not submit from the keyboard while Save is disabled', async () => {
        const onSave = vi.fn();

        render(<DisplayNameSheet {...sheet({ canSave: false, onSave })} />);

        await userEvent.type(screen.getByLabelText('Display name'), '{Enter}');

        expect(onSave).not.toHaveBeenCalled();
    });

    it('shows Saving… and cannot be pressed again while the save is in flight', async () => {
        const onSave = vi.fn();

        render(<DisplayNameSheet {...sheet({ saving: true, onSave })} />);

        await userEvent.click(screen.getByRole('button', { name: /Sav/ }), { pointerEventsCheck: 0 });

        expect(onSave).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /Sav/ }).getAttribute('aria-disabled')).toBe('true');
    });

    // The sheet has one field, whose `nativeID` is a generated id.
    const nameField = () => [...recordedTextInputs.values()][0];

    it('announces a failed save, and the field says it first in its accessibility hint', () => {
        render(<DisplayNameSheet {...sheet({ failed: true })} />);

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t save your name. Try again.');
        expect(nameField()?.accessibilityHint).toBe(
            'We couldn’t save your name. Try again. Shown next to your username on recipes you publish.',
        );
    });

    it('names the field by its label for iOS, and speaks the visible hint while nothing has failed', () => {
        render(<DisplayNameSheet {...sheet()} />);

        expect(nameField()?.accessibilityLabel).toBe('Display name');
        expect(nameField()?.accessibilityHint).toBe('Shown next to your username on recipes you publish.');
    });

    it('closes through onOpenChange(false)', async () => {
        const onOpenChange = vi.fn();

        render(<DisplayNameSheet {...sheet({ onOpenChange })} />);

        await userEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});

/**
 * The field stops a name at the identity service's limit. Without it a long name was typed in full and Save went
 * quietly disabled, with nothing saying why.
 */
describe('DisplayNameSheet (native) — the length limit', () => {
    it('stops the field at the display name’s limit', () => {
        render(
            <DisplayNameSheet
                open
                onOpenChange={noop}
                draft=""
                onDraftChange={noop}
                canSave={false}
                saving={false}
                failed={false}
                onSave={noop}
            />,
        );

        expect(screen.getByLabelText('Display name').getAttribute('maxlength')).toBe(String(DISPLAY_NAME_MAX_LENGTH));
    });
});

/**
 * W-26 (native twin): a counter in the `caption` role from 80 characters, `dangerText` at the limit, and a polite live
 * region that says the limit once.
 */
describe('DisplayNameSheet (native) — the length counter (W-26)', () => {
    const withDraft = (draft: string) => (
        <DisplayNameSheet
            open
            onOpenChange={noop}
            draft={draft}
            onDraftChange={noop}
            canSave
            saving={false}
            failed={false}
            onSave={noop}
        />
    );

    it('shows no counter below 80 characters', () => {
        render(withDraft('x'.repeat(79)));

        expect(screen.queryByText(/\d+\/100/)).toBeNull();
    });

    it('shows “{n}/100” from 80 characters, in the muted caption colour', () => {
        render(withDraft('x'.repeat(85)));

        const shown = screen.getByText('85/100');
        const plain = screen.getByText('Shown next to your username on recipes you publish.');

        // REWRITTEN for ADR-0080: the counter paints through a Tamagui class, so both colours are read through the
        // resolver (which reads an inline style first). The comparison is as before.
        expect(resolvedColour(shown, 'color')).toBe(resolvedColour(plain, 'color'));
    });

    it('does not announce while the cook is under the limit', () => {
        render(withDraft('x'.repeat(99)));

        expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('');
    });

    it('turns the counter danger and announces the limit politely when it is reached', () => {
        render(withDraft('x'.repeat(DISPLAY_NAME_MAX_LENGTH)));

        // REWRITTEN for ADR-0080: read through the resolver, as above. The comparison is as before.
        expect(resolvedColour(screen.getByText('100/100'), 'color')).not.toBe(
            resolvedColour(screen.getByText('Shown next to your username on recipes you publish.'), 'color'),
        );
        expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe(
            'That is the longest name we can take.',
        );
    });
});

/**
 * ADR-0080: the Profile leaves draw their text through the design system's `Text`, so it follows the device's dark
 * scheme and the 2x text cap. Each keeps the type role it spread before; every expected value is read from the tokens.
 * `renderWithTamagui` sets the scheme of the Tamagui theme alone, so a text still painted from React Native's
 * `useTheme()` reads the light colour in the dark case.
 */
type Scheme = 'light' | 'dark';
type SizedRole = 'sectionTitle' | 'body' | 'caption' | 'meta' | 'figureStat';

/** Asserts the face, the size and the leading of one type role on an element. */
function expectTypeRole(element: Element, typeRole: SizedRole): void {
    const spec = nativeTokens.type[typeRole];
    const style = getComputedStyle(element);

    expect(style.fontFamily).toContain(spec.fontFamily);
    expect(style.fontSize).toBe(`${String(spec.fontSize)}px`);
    expect(style.lineHeight).toBe(`${String(spec.lineHeight)}px`);
}

describe('ProfileHeader (native) — type and colour', () => {
    const ready = { status: 'ready', displayName: 'Eliza Moreno', email: 'e@x.co', username: null } as const;

    it('sets the name in the sectionTitle role and the initials in the figureStat role', () => {
        renderWithTamagui(<ProfileHeader read={ready} initials="EM" onRetry={noop} />, 'light');

        expectTypeRole(screen.getByText('Eliza Moreno'), 'sectionTitle');
        expectTypeRole(screen.getByText('EM'), 'figureStat');
    });

    it('sets the failed read in the sectionTitle role it has always used (the web says it in body)', () => {
        renderWithTamagui(<ProfileHeader read={{ status: 'failed' }} initials="" onRetry={noop} />, 'light');

        expectTypeRole(screen.getByRole('alert'), 'sectionTitle');
    });

    it.each(['light', 'dark'] as const)(
        'paints the name in ink and the initials in onAction in the %s scheme',
        (scheme) => {
            renderWithTamagui(<ProfileHeader read={ready} initials="EM" onRetry={noop} />, scheme);
            const roles = rolesFor(scheme);

            expect(resolvedColour(screen.getByText('Eliza Moreno'), 'color')).toBe(rgb(roles.ink));
            expect(resolvedColour(screen.getByText('EM'), 'color')).toBe(rgb(roles.onAction));
        },
    );

    it.each(['light', 'dark'] as const)('paints the failed read in ink in the %s scheme', (scheme) => {
        renderWithTamagui(<ProfileHeader read={{ status: 'failed' }} initials="" onRetry={noop} />, scheme);

        expect(resolvedColour(screen.getByRole('alert'), 'color')).toBe(rgb(rolesFor(scheme).ink));
    });
});

describe('ProfileRow (native) — type and colour', () => {
    const full: ProfileRowProps = {
        label: 'Close account',
        value: 'Value',
        hint: 'Signs you out.',
        tone: 'danger',
        chevron: true,
        onPress: noop,
    };

    it('sets the label and the value in the body role, the hint in the caption role', () => {
        renderWithTamagui(<ProfileRow {...full} />, 'light');

        expectTypeRole(screen.getByText('Close account'), 'body');
        expectTypeRole(screen.getByText('Value'), 'body');
        expectTypeRole(screen.getByText('Signs you out.'), 'caption');
    });

    it('lets the value shrink, but to no more than half the row', () => {
        renderWithTamagui(<ProfileRow {...full} />, 'light');
        const value = screen.getByText('Value');

        expect(resolvedStyle(value, 'flexShrink')).toBe('1');
        expect(resolvedStyle(value, 'maxWidth')).toBe('50%');
    });

    it.each(['light', 'dark'] as const)('paints each part in its role colour in the %s scheme', (scheme: Scheme) => {
        renderWithTamagui(
            <>
                <ProfileRow {...full} />
                <ProfileRow label="Sign out" tone="ink" chevron={false} onPress={noop} />
            </>,
            scheme,
        );
        const roles = rolesFor(scheme);

        expect(resolvedColour(screen.getByText('Close account'), 'color')).toBe(rgb(roles.dangerText));
        expect(resolvedColour(screen.getByText('Sign out'), 'color')).toBe(rgb(roles.ink));
        expect(resolvedColour(screen.getByText('Value'), 'color')).toBe(rgb(roles.inkMuted));
        expect(resolvedColour(screen.getByText('Signs you out.'), 'color')).toBe(rgb(roles.inkMuted));
    });
});

describe('ProfileGroup (native) — type and colour', () => {
    const group = (
        <ProfileGroup heading="Preferences">
            <ProfileRow label="Email" tone="ink" chevron={false} onPress={noop} />
        </ProfileGroup>
    );

    it('sets its H2 heading in the sectionTitle role', () => {
        renderWithTamagui(group, 'light');

        expectTypeRole(screen.getByRole('heading', { name: 'Preferences', level: 2 }), 'sectionTitle');
    });

    it.each(['light', 'dark'] as const)('paints its heading in ink in the %s scheme', (scheme) => {
        renderWithTamagui(group, scheme);

        expect(resolvedColour(screen.getByRole('heading', { name: 'Preferences' }), 'color')).toBe(
            rgb(rolesFor(scheme).ink),
        );
    });
});

describe('DisplayNameSheet (native) — type and colour', () => {
    const sheetWith = (draft: string, failed = false) => (
        <DisplayNameSheet
            open
            onOpenChange={noop}
            draft={draft}
            onDraftChange={noop}
            canSave
            saving={false}
            failed={failed}
            onSave={noop}
        />
    );

    it('sets the counter in the caption role and the failure in the meta role', () => {
        renderWithTamagui(sheetWith('x'.repeat(85), true), 'light');

        expectTypeRole(screen.getByText('85/100'), 'caption');
        expectTypeRole(screen.getByRole('alert'), 'meta');
    });

    it.each(['light', 'dark'] as const)(
        'paints the counter inkMuted, then dangerText at the limit, and the failure dangerText, in the %s scheme',
        (scheme) => {
            const roles = rolesFor(scheme);
            const { unmount } = renderWithTamagui(sheetWith('x'.repeat(85), true), scheme);

            expect(resolvedColour(screen.getByText('85/100'), 'color')).toBe(rgb(roles.inkMuted));
            expect(resolvedColour(screen.getByRole('alert'), 'color')).toBe(rgb(roles.dangerText));
            unmount();

            renderWithTamagui(sheetWith('x'.repeat(DISPLAY_NAME_MAX_LENGTH)), scheme);

            expect(resolvedColour(screen.getByText('100/100'), 'color')).toBe(rgb(roles.dangerText));
        },
    );
});
