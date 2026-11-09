import { vi } from 'vitest';

import type { FoodEditSession } from '../useFoodEdit.js';

/** An open edit session with spies, overridable per field. */
export function makeEditSession(over: Partial<FoodEditSession> = {}): FoodEditSession {
    return {
        open: true,
        name: 'Oat milk',
        draft: { name: 'Oat milk', calories: '120', proteinG: '3', carbsG: '16', fatG: '5' },
        fieldErrors: {},
        notice: null,
        sendsForReview: false,
        unchanged: false,
        submitting: false,
        failed: false,
        duplicate: false,
        onOpen: vi.fn(),
        onChange: vi.fn(),
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
        ...over,
    };
}
