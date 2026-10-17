/**
 * @module canvas/boards — the registry of the screens on the canvas: which file, what it is called, which row it sits
 * in, and which platform it draws.
 *
 * A registry rather than discovery because the row and the title are authored facts (a file name cannot say that
 * `RecipeEditorSheet` belongs to the "Recipe editor" row), and `__tests__/boards.test.ts` holds the table equal to the
 * files on disk so a board cannot be added without being placed.
 *
 * `height` is the board's DECLARED height in CSS pixels. The e2e tier measures each rendered board and fails when the
 * content no longer fits, so a stale number is a test failure and not a clipped screen.
 *
 * @pattern Registry — a typed table of the boards; `canvasLayout` is its pure projection onto canvas coordinates.
 */
import { join } from 'node:path';

import { CONTENT_DIR } from '../config.js';

/** Where the board files are authored. */
export const BOARDS_DIR = join(CONTENT_DIR, 'canvas/boards');

/** What a board draws. */
export type BoardPlatform = 'web' | 'native';

/** One screen on the canvas. */
export interface BoardSpec {
    /** The file name in {@link BOARDS_DIR}, which is also its key on the canvas. */
    readonly file: string;
    /** The label above the board. */
    readonly title: string;
    /** The row title; boards sharing it sit in one row. */
    readonly row: string;
    readonly platform: BoardPlatform;
    /** Declared height in CSS pixels. */
    readonly height: number;
}

/** A board's width per platform: a desktop window and an iPhone. */
export const BOARD_WIDTH: Readonly<Record<BoardPlatform, number>> = { web: 1280, native: 390 };

/** Every board, in canvas order. */
export const BOARDS: readonly BoardSpec[] = [
    { file: 'Home.dc.html', title: 'Home, proposal (web)', row: 'Home', platform: 'web', height: 962 },
    { file: 'HomeMobile.dc.html', title: 'Home (mobile)', row: 'Home', platform: 'native', height: 1388 },
    { file: 'Discover.dc.html', title: 'Discover, proposal (web)', row: 'Discover', platform: 'web', height: 1694 },
    { file: 'DiscoverMobile.dc.html', title: 'Discover (mobile)', row: 'Discover', platform: 'native', height: 1949 },
    { file: 'Recipes.dc.html', title: 'My recipes, proposal (web)', row: 'My recipes', platform: 'web', height: 1620 },
    {
        file: 'RecipesMobile.dc.html',
        title: 'My recipes (mobile)',
        row: 'My recipes',
        platform: 'native',
        height: 1439,
    },
    {
        file: 'Collections.dc.html',
        title: 'Collections, proposal (web)',
        row: 'Collections',
        platform: 'web',
        height: 1074,
    },
    {
        file: 'CollectionsMobile.dc.html',
        title: 'Collections (mobile)',
        row: 'Collections',
        platform: 'native',
        height: 1113,
    },
    {
        file: 'CollectionDetail.dc.html',
        title: 'Collection detail, proposal (web)',
        row: 'Collection detail',
        platform: 'web',
        height: 1125,
    },
    {
        file: 'CollectionDetailMobile.dc.html',
        title: 'Collection detail (mobile)',
        row: 'Collection detail',
        platform: 'native',
        height: 1172,
    },
    {
        file: 'RecipeDetail.dc.html',
        title: 'Recipe detail, proposal (web)',
        row: 'Recipe detail',
        platform: 'web',
        height: 1923,
    },
    {
        file: 'RecipeDetailMobile.dc.html',
        title: 'Recipe detail (mobile)',
        row: 'Recipe detail',
        platform: 'native',
        height: 3614,
    },
    {
        file: 'RecipeVersions.dc.html',
        title: 'Recipe versions, proposal (web)',
        row: 'Recipe versions',
        platform: 'web',
        height: 844,
    },
    {
        file: 'RecipeVersionsMobile.dc.html',
        title: 'Recipe versions (mobile)',
        row: 'Recipe versions',
        platform: 'native',
        height: 844,
    },
    {
        file: 'RecipeVersionsEmpty.dc.html',
        title: 'Recipe versions, empty, proposal (web)',
        row: 'Recipe versions',
        platform: 'web',
        height: 844,
    },
    {
        file: 'RecipeVersionsEmptyMobile.dc.html',
        title: 'Recipe versions, empty (mobile)',
        row: 'Recipe versions',
        platform: 'native',
        height: 844,
    },
    {
        file: 'RecipeEditor.dc.html',
        title: 'Recipe editor, proposal (web)',
        row: 'Recipe editor',
        platform: 'web',
        height: 3966,
    },
    {
        file: 'RecipeEditorMobile.dc.html',
        title: 'Recipe editor (mobile)',
        row: 'Recipe editor',
        platform: 'native',
        height: 4726,
    },
    {
        file: 'RecipeEditorSheet.dc.html',
        title: 'Recipe editor, Paste a list sheet, proposal (web)',
        row: 'Recipe editor',
        platform: 'web',
        height: 900,
    },
    {
        file: 'RecipeEditorSheetMobile.dc.html',
        title: 'Recipe editor, Paste a list sheet (mobile)',
        row: 'Recipe editor',
        platform: 'native',
        height: 844,
    },
    { file: 'Profile.dc.html', title: 'Profile, proposal (web)', row: 'Profile', platform: 'web', height: 874 },
    { file: 'ProfileMobile.dc.html', title: 'Profile (mobile)', row: 'Profile', platform: 'native', height: 844 },
    { file: 'SignIn.dc.html', title: 'Sign in (web)', row: 'Sign in', platform: 'web', height: 844 },
    { file: 'SignInMobile.dc.html', title: 'Sign in (mobile)', row: 'Sign in', platform: 'native', height: 844 },
    { file: 'SignUp.dc.html', title: 'Sign up (web)', row: 'Sign up', platform: 'web', height: 844 },
    { file: 'SignUpMobile.dc.html', title: 'Sign up (mobile)', row: 'Sign up', platform: 'native', height: 967 },
    {
        file: 'LegalSources.dc.html',
        title: 'Data sources, proposal (web)',
        row: 'Data sources',
        platform: 'web',
        height: 844,
    },
];
