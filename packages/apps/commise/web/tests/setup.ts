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
