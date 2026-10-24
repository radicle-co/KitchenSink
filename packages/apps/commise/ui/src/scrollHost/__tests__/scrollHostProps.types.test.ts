/**
 * `topInset` is a WEB-only input (a bar pinned over the document, measured by the observer), so it lives on
 * `ScrollHostWebProps` and the shared `ScrollHostProps` does not carry a prop native ignores. The assertions are
 * conditional types: a regression fails `tsc` (the gate), and the runtime check keeps the file a real test.
 */
import { describe, expect, it } from 'vitest';

import type { ScrollHostProps, ScrollHostWebProps } from '../props.js';

type SharedHasTopInset = 'topInset' extends keyof ScrollHostProps ? true : false;
type WebHasTopInset = 'topInset' extends keyof ScrollHostWebProps ? true : false;

describe('ScrollHost props', () => {
    it('keeps topInset off the shared props and on the web props', () => {
        const shared: SharedHasTopInset = false;
        const web: WebHasTopInset = true;

        expect(shared).toBe(false);
        expect(web).toBe(true);
    });
});
