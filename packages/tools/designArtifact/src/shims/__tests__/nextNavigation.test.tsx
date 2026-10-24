// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { notFound, redirect, useParams, usePathname, useRouter, useSearchParams } from '../nextNavigation.js';

afterEach(() => {
    delete window.__commisePath;
});

describe('next/navigation Adapter', () => {
    it('answers /en as the pathname by default', () => {
        expect(renderHook(() => usePathname()).result.current).toBe('/en');
    });

    it('answers the pathname the artifact globals set', () => {
        window.__commisePath = '/en/recipes';

        expect(renderHook(() => usePathname()).result.current).toBe('/en/recipes');
    });

    it('gives a router whose methods do nothing and which is the same object every render', () => {
        const { result, rerender } = renderHook(() => useRouter());
        const first = result.current;
        rerender();

        expect(result.current).toBe(first);
        expect(() => {
            first.push('/x');
            first.replace('/x');
            first.back();
            first.forward();
            first.refresh();
            first.prefetch('/x');
        }).not.toThrow();
    });

    it('answers empty search params', () => {
        const params = renderHook(() => useSearchParams()).result.current;

        expect(params.toString()).toBe('');
        expect(params.get('q')).toBeNull();
    });

    it('answers the same search params object every render, so an effect keyed on it does not rerun', () => {
        const { result, rerender } = renderHook(() => useSearchParams());
        const first = result.current;
        rerender();

        expect(result.current).toBe(first);
    });

    it('refuses to mutate the shared search params, as next’s read-only instance does', () => {
        const params: URLSearchParams = renderHook(() => useSearchParams()).result.current;

        expect(() => {
            params.append('a', '1');
        }).toThrow(/read-only/iu);
        expect(() => {
            params.set('a', '1');
        }).toThrow(/read-only/iu);
        expect(() => {
            params.delete('a');
        }).toThrow(/read-only/iu);
        expect(() => {
            params.sort();
        }).toThrow(/read-only/iu);
        expect(params.toString()).toBe('');
    });

    it('answers the en locale param', () => {
        expect(renderHook(() => useParams()).result.current).toEqual({ locale: 'en' });
    });

    it('redirects and not-found do nothing on a static artboard', () => {
        expect(() => {
            redirect('/x');
            notFound();
        }).not.toThrow();
    });
});
