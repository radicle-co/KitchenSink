import { afterEach, describe, expect, it, vi } from 'vitest';

import { resizeEntryOf, reportResize, reportResizeOf, resizeObserver } from '../resizeObserver.js';

afterEach(() => {
    resizeObserver.observed.clear();
    resizeObserver.callback = undefined;
    resizeObserver.observer = undefined;
});

describe('the recording ResizeObserver', () => {
    // jsdom has no ResizeObserver; react-native-web reports `onLayout` through one. This double is what lets a test
    // see WHICH nodes are watched and report a layout through the callback, so these are its whole contract.
    it('is installed on globalThis by importing the module', () => {
        expect(typeof globalThis.ResizeObserver).toBe('function');
    });

    it('records the callback and the nodes watched, and forgets a node that is unobserved', () => {
        const callback = vi.fn();
        const first = document.createElement('div');
        const second = document.createElement('div');
        const observer = new ResizeObserver(callback);

        observer.observe(first);
        observer.observe(second);
        observer.unobserve(first);

        expect(resizeObserver.callback).toBe(callback);
        expect([...resizeObserver.observed]).toEqual([second]);
    });

    it('forgets every node on disconnect', () => {
        const observer = new ResizeObserver(vi.fn());

        observer.observe(document.createElement('div'));
        observer.disconnect();

        expect(resizeObserver.observed.size).toBe(0);
    });
});

describe('reportResize', () => {
    it('fires the callback with a real entry for each watched node, and the observer that was built', () => {
        const callback = vi.fn<ResizeObserverCallback>();
        const node = document.createElement('div');
        const observer = new ResizeObserver(callback);

        node.getBoundingClientRect = () => new DOMRect(0, 0, 10, 42);
        observer.observe(node);
        reportResize();

        expect(callback).toHaveBeenCalledTimes(1);
        const [entries, from] = callback.mock.calls[0] ?? [];

        expect(entries).toMatchObject([{ target: node, contentRect: { height: 42 } }]);
        expect(from).toBe(observer);
    });

    it('reports only the nodes it is given, and does nothing before an observer exists', () => {
        reportResize();

        const callback = vi.fn<ResizeObserverCallback>();
        const watched = document.createElement('div');
        const other = document.createElement('div');
        const observer = new ResizeObserver(callback);

        observer.observe(watched);
        reportResize([other]);

        expect(callback.mock.calls[0]?.[0]).toEqual([resizeEntryOf(other)]);
    });
});

describe('the options a node was observed with, and reaching every observer', () => {
    afterEach(() => {
        resizeObserver.observers.clear();
        resizeObserver.options.clear();
    });

    it('records the options of each watched node, and forgets them with the node', () => {
        const node = document.createElement('div');
        const observer = new ResizeObserver(vi.fn());

        observer.observe(node, { box: 'border-box' });

        expect(resizeObserver.options.get(node)).toEqual({ box: 'border-box' });

        observer.unobserve(node);

        expect(resizeObserver.options.has(node)).toBe(false);
    });

    it('reaches the observer that watches a node even when another observer was built after it', () => {
        const watched = vi.fn<ResizeObserverCallback>();
        const later = vi.fn<ResizeObserverCallback>();
        const node = document.createElement('div');
        const other = document.createElement('div');

        new ResizeObserver(watched).observe(node);
        new ResizeObserver(later).observe(other);
        reportResizeOf([node]);

        // Kills: reaching only the observer built last, which is how a node watched earlier went unreported.
        expect(watched).toHaveBeenCalledOnce();
        expect(later).not.toHaveBeenCalled();
    });

    it('stops reaching an observer that disconnected', () => {
        const callback = vi.fn<ResizeObserverCallback>();
        const node = document.createElement('div');
        const observer = new ResizeObserver(callback);

        observer.observe(node);
        observer.disconnect();
        reportResizeOf([node]);

        expect(callback).not.toHaveBeenCalled();
    });

    it('keeps a node observed while another observer still watches it', () => {
        const node = document.createElement('div');
        const first = new ResizeObserver(vi.fn());
        const second = new ResizeObserver(vi.fn());

        first.observe(node, { box: 'border-box' });
        second.observe(node);
        first.disconnect();

        // Kills: a record that drops a node one observer let go of, which another observer still watches.
        expect(resizeObserver.observed.has(node)).toBe(true);
        expect(resizeObserver.options.has(node)).toBe(true);

        second.unobserve(node);

        expect(resizeObserver.observed.has(node)).toBe(false);
        expect(resizeObserver.options.has(node)).toBe(false);
    });
});
