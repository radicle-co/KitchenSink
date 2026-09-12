import { configure } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// jsdom does not implement `URL.createObjectURL`/`revokeObjectURL` (a real-browser-only API the recipe photo
// upload queue uses to mint a per-file preview thumbnail — w3/e4). Stub them globally, once, so no individual
// test needs its own ad-hoc polyfill.
let objectUrlCounter = 0;

if (typeof URL.createObjectURL !== 'function') {
    (URL as unknown as { createObjectURL: (obj: Blob) => string }).createObjectURL = () => {
        objectUrlCounter += 1;

        return `blob:mock-${objectUrlCounter}`;
    };
}

if (typeof URL.revokeObjectURL !== 'function') {
    (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = () => undefined;
}

/*
 * ⛔ RTL's async-util budget, raised from its 1000 ms default — matching `mobile/tests/setup.native.ts`,
 * which established this in this repo and carries the full argument (raising it weakens no assertion; fake
 * timers were rejected because they defeat the deliberate debounce tests).
 *
 * This package simply never got it. `waitFor` / `findBy*` carry their OWN timeout, independent of vitest's
 * `testTimeout`, so a suite configured at 30 s still failed any wait needing more than one second — and
 * under a full parallel `turbo run test` a userEvent → react-query → render chain genuinely can.
 *
 * ⚠️ HONEST LIMIT: this is a mitigation, not a diagnosed fix, for the flake seen on 2026-09-12 in
 * `IngredientPickerLiveSearch.test.tsx` (red once in a full run; green standalone, green for its own
 * package, green on re-run, and green for six runs under eight busy cores). It cannot hide a logic bug — a
 * wrong assertion still fails — so if that test goes red again the cause is elsewhere, and this note is the
 * record that the timeout was already ruled out.
 */
configure({ asyncUtilTimeout: 5_000 });
