/**
 * Native component tests for the Pull-Updates preview dialog (W5 Task 10, C2 / FR-011), rendered via
 * react-native-web under jsdom. Mirrors the web leaf across every branch — closed, loading, populated diff,
 * empty diff, drift/generic errors, committing, and dismissal (Cancel + the RN `Modal.onRequestClose`
 * Android-back/Escape path) — so the two platform renders can't drift on behaviour or accessibility.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';

import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';
import type { PullDiff } from '@kitchensink/recipe-service-client';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { PullUpdatesDialog } from '../PullUpdatesDialog.native.js';
import { expectNativeDesignSystemButton } from '../../__tests__/nativeDesignSystemButton.js';
import type { PullUpdatesDialogProps } from '../model.js';
import { collectionMessages } from '../messages.js';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

const noop = () => undefined;

const populatedDiff: PullDiff = { added: ['rec_a', 'rec_b'], removed: [], unchanged: ['rec_c'] };

function baseProps(overrides: Partial<PullUpdatesDialogProps> = {}): PullUpdatesDialogProps {
    return {
        open: true,
        isLoadingPreview: false,
        isCommitting: false,
        sourceOwnerHandle: 'mealplan_clara',
        sourceCollectionName: 'Keto Staples',
        onCancel: noop,
        onConfirm: noop,
        ...overrides,
    };
}

describe('PullUpdatesDialog (native) — closed', () => {
    it('renders nothing while closed', () => {
        render(<PullUpdatesDialog {...baseProps({ open: false, diff: populatedDiff })} />);

        expect(screen.queryByText('Pull Updates from Source Collection')).toBeNull();
    });
});

describe('PullUpdatesDialog (native) — loading preview', () => {
    it('shows a progress affordance and no counts while the preview is loading', () => {
        render(<PullUpdatesDialog {...baseProps({ isLoadingPreview: true })} />);

        expect(screen.getByRole('progressbar')).toBeTruthy();
        expect(screen.queryByText(/will be added/)).toBeNull();
        expect(screen.queryByRole('button', { name: /^Pull/ })).toBeNull();
    });
});

describe('PullUpdatesDialog (native) — populated diff', () => {
    it('shows the source attribution, the counts, and the protection note', () => {
        render(<PullUpdatesDialog {...baseProps({ diff: populatedDiff })} />);

        expect(screen.getByText('@mealplan_clara / Keto Staples')).toBeTruthy();
        expect(screen.getByText('2 new public recipes will be added')).toBeTruthy();
        expect(screen.getByText('0 recipes removed from source')).toBeTruthy();
        expect(screen.getByText('1 already in this collection (no changes)')).toBeTruthy();
        expect(screen.getByText('Recipes you added directly will not be overwritten.')).toBeTruthy();
    });

    it('the count-templated Pull action fires onConfirm', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        render(<PullUpdatesDialog {...baseProps({ diff: populatedDiff, onConfirm })} />);

        await user.click(screen.getByRole('button', { name: 'Pull 2 Recipes' }));

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
});

describe('PullUpdatesDialog (native) — empty diff (nothing to pull)', () => {
    it('disables the Pull action and shows an up-to-date message; onConfirm cannot fire', async () => {
        const emptyDiff: PullDiff = { added: [], removed: [], unchanged: ['rec_c', 'rec_d'] };
        const onConfirm = vi.fn();
        render(<PullUpdatesDialog {...baseProps({ diff: emptyDiff, onConfirm })} />);

        expect(screen.getByText('You’re all caught up — there’s nothing new to pull.')).toBeTruthy();
        const confirm = screen.getByRole('button', { name: 'Pull 0 Recipes' });
        expect(confirm.getAttribute('aria-disabled')).toBe('true');

        // `fireEvent` (not `userEvent`): react-native-web renders a disabled Pressable with
        // `pointer-events: none`, which `userEvent`'s pointer-interaction check correctly refuses to
        // "click" — matching `RecipeDeleteDialog.native.test.tsx`'s identical disabled-control assertion.
        fireEvent.click(confirm);
        expect(onConfirm).not.toHaveBeenCalled();
    });
});

describe('PullUpdatesDialog (native) — drift error (409: not a dead end)', () => {
    it('shows the re-preview/retry message, hides the stale counts, and Cancel still works', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(<PullUpdatesDialog {...baseProps({ diff: populatedDiff, error: 'drift', onCancel })} />);

        expect(screen.getByRole('alert').textContent).toMatch(/source collection changed/i);
        expect(screen.queryByText(/will be added/)).toBeNull();
        expect(screen.queryByRole('button', { name: /^Pull/ })).toBeNull();

        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});

describe('PullUpdatesDialog (native) — generic error', () => {
    it('shows a generic error alert', () => {
        render(<PullUpdatesDialog {...baseProps({ diff: populatedDiff, error: 'generic' })} />);

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t check for updates. Please try again.');
    });
});

describe('PullUpdatesDialog (native) — committing', () => {
    it('disables the Pull action, marks it busy, and does not double-fire onConfirm', async () => {
        const onConfirm = vi.fn();
        render(<PullUpdatesDialog {...baseProps({ diff: populatedDiff, isCommitting: true, onConfirm })} />);

        const confirm = screen.getByRole('button', { name: 'Pull 2 Recipes' });
        expect(confirm.getAttribute('aria-disabled')).toBe('true');
        expect(confirm.getAttribute('aria-busy')).toBe('true');

        fireEvent.click(confirm);
        expect(onConfirm).not.toHaveBeenCalled();
    });
});

describe('PullUpdatesDialog (native) — dismissal', () => {
    it('Cancel fires onCancel', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(<PullUpdatesDialog {...baseProps({ diff: populatedDiff, onCancel })} />);

        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('wires the Modal onRequestClose (Android back / web Escape) to onCancel', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(<PullUpdatesDialog {...baseProps({ diff: populatedDiff, onCancel })} />);

        // react-native-web's Modal only wires its Escape listener once its `animationType="slide"` entrance
        // animation completes (`ModalContent`'s `active` flag, driven by an `animationend` DOM event) —
        // jsdom never fires real CSS animation events, so this dispatches the same `animationend` a real
        // browser would once the transition finishes, driving the SAME real library code path Escape/the
        // Android back button use (`onRequestClose`), rather than reaching around it.
        const portalRoot = document.body.lastElementChild;
        const animatedLayer = portalRoot?.firstElementChild;
        expect(animatedLayer).toBeTruthy();
        fireEvent.animationEnd(animatedLayer as Element);

        expect(screen.getByRole('dialog')).toBeTruthy();

        await user.keyboard('{Escape}');

        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});

describe('PullUpdatesDialog (native) — the design-system Button (UI overhaul slice 2)', () => {
    it('pulls through a primary check Button and cancels through a secondary x one, the ConfirmDialog’s Keep', () => {
        render(<PullUpdatesDialog {...baseProps({ diff: populatedDiff })} />);

        expectNativeDesignSystemButton(screen.getByRole('button', { name: 'Pull 2 Recipes' }), 'primary', 'check');
        expectNativeDesignSystemButton(screen.getByRole('button', { name: 'Cancel' }), 'secondary', 'x');
    });
});

// D15: the dialog paints from roles at render: the title in ink, the counts and notes in inkMuted, an error in dangerText.
describe.each(['light', 'dark'] as const)('PullUpdatesDialog (native) — the %s scheme', (scheme) => {
    const colours = scheme === 'dark' ? roleDark : role;
    const pull = collectionMessages.en.pull;

    it('paints the title in ink and the diff copy in inkMuted', () => {
        systemScheme.current = scheme;
        render(<PullUpdatesDialog {...baseProps({ diff: populatedDiff })} />);

        expect(getComputedStyle(screen.getByRole('heading', { name: pull.title })).color).toBe(rgb(colours.ink));
        expect(getComputedStyle(screen.getByText(pull.ownMembersNote)).color).toBe(rgb(colours.inkMuted));
    });

    it('says a drift in dangerText', () => {
        systemScheme.current = scheme;
        render(<PullUpdatesDialog {...baseProps({ error: 'drift' })} />);

        expect(getComputedStyle(screen.getByText(pull.driftMessage)).color).toBe(rgb(colours.dangerText));
    });
});
