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
    { file: 'Discover.dc.html', title: 'Discover, proposal (web)', row: 'Discover', platform: 'web', height: 1107 },
    {
        file: 'DiscoverMobile.dc.html',
        title: 'Discover, proposal (mobile)',
        row: 'Discover',
        platform: 'native',
        height: 1360,
    },
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
        height: 1501,
    },
    {
        file: 'RecipeDetailMobile.dc.html',
        title: 'Recipe detail, proposal (mobile)',
        row: 'Recipe detail',
        platform: 'native',
        height: 3212,
    },
    {
        file: 'RecipeDetailScrolled.dc.html',
        title: 'Recipe detail, scrolled, proposal (web)',
        row: 'Recipe detail',
        platform: 'web',
        height: 844,
    },
    {
        file: 'RecipeDetailScrolledMobile.dc.html',
        title: 'Recipe detail, scrolled, proposal (mobile)',
        row: 'Recipe detail',
        platform: 'native',
        height: 844,
    },
    {
        file: 'RecipeDetailIngredientsOpenMobile.dc.html',
        title: 'Recipe detail, ingredients open, proposal (mobile)',
        row: 'Recipe detail',
        platform: 'native',
        height: 844,
    },
    {
        file: 'RecipeDetailNutritionOpenMobile.dc.html',
        title: 'Recipe detail, nutrition open, proposal (mobile)',
        row: 'Recipe detail',
        platform: 'native',
        height: 844,
    },
    {
        file: 'RecipeDetailMenu.dc.html',
        title: 'Recipe detail, more menu, proposal (web)',
        row: 'Recipe detail',
        platform: 'web',
        height: 844,
    },
    {
        file: 'RecipeDetailMenuMobile.dc.html',
        title: 'Recipe detail, more menu, proposal (mobile)',
        row: 'Recipe detail',
        platform: 'native',
        height: 844,
    },
    {
        file: 'RecipeDetailReader.dc.html',
        title: "Recipe detail, another cook's recipe, proposal (web)",
        row: 'Recipe detail',
        platform: 'web',
        height: 1500,
    },
    {
        file: 'RecipeDetailReaderMobile.dc.html',
        title: "Recipe detail, another cook's recipe, proposal (mobile)",
        row: 'Recipe detail',
        platform: 'native',
        height: 3128,
    },
    {
        file: 'RecipeRating.dc.html',
        title: 'Rate this recipe, proposal (web)',
        row: 'Recipe detail',
        platform: 'web',
        height: 844,
    },
    {
        file: 'RecipeRatingMobile.dc.html',
        title: 'Rate this recipe, proposal (mobile)',
        row: 'Recipe detail',
        platform: 'native',
        height: 844,
    },
    {
        file: 'RecipeComments.dc.html',
        title: 'Comments, proposal (web)',
        row: 'Recipe detail',
        platform: 'web',
        height: 844,
    },
    {
        file: 'RecipeCommentsMobile.dc.html',
        title: 'Comments, proposal (mobile)',
        row: 'Recipe detail',
        platform: 'native',
        height: 844,
    },
    {
        file: 'RecipeCommentsYours.dc.html',
        title: 'Comments, with your own, proposal (web)',
        row: 'Recipe detail',
        platform: 'web',
        height: 844,
    },
    {
        file: 'RecipeCommentsYoursMobile.dc.html',
        title: 'Comments, with your own, proposal (mobile)',
        row: 'Recipe detail',
        platform: 'native',
        height: 844,
    },
    {
        file: 'RecipeCommentDelete.dc.html',
        title: 'Delete your comment, proposal (web)',
        row: 'Recipe detail',
        platform: 'web',
        height: 844,
    },
    {
        file: 'RecipeCommentDeleteMobile.dc.html',
        title: 'Delete your comment, proposal (mobile)',
        row: 'Recipe detail',
        platform: 'native',
        height: 844,
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
        title: 'Recipe versions, proposal (mobile)',
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
        title: 'Recipe versions, empty, proposal (mobile)',
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
    {
        file: 'RecipeEditorFoodSearchTooShort.dc.html',
        title: 'Recipe editor, food search: too short (web)',
        row: 'Food search: typing and results',
        platform: 'web',
        height: 1000,
    },
    {
        file: 'RecipeEditorFoodSearchTooShortMobile.dc.html',
        title: 'Recipe editor, food search: too short (mobile)',
        row: 'Food search: typing and results',
        platform: 'native',
        height: 837,
    },
    {
        file: 'RecipeEditorFoodSearchSearching.dc.html',
        title: 'Recipe editor, food search: searching (web)',
        row: 'Food search: typing and results',
        platform: 'web',
        height: 1000,
    },
    {
        file: 'RecipeEditorFoodSearchSearchingMobile.dc.html',
        title: 'Recipe editor, food search: searching (mobile)',
        row: 'Food search: typing and results',
        platform: 'native',
        height: 821,
    },
    {
        file: 'RecipeEditorFoodSearchResults.dc.html',
        title: 'Recipe editor, food search: results (web)',
        row: 'Food search: typing and results',
        platform: 'web',
        height: 1000,
    },
    {
        file: 'RecipeEditorFoodSearchResultsMobile.dc.html',
        title: 'Recipe editor, food search: results (mobile)',
        row: 'Food search: typing and results',
        platform: 'native',
        height: 1239,
    },
    {
        file: 'RecipeEditorFoodSearchMoreSources.dc.html',
        title: 'Recipe editor, food search: more sources still searching (web)',
        row: 'Food search: typing and results',
        platform: 'web',
        height: 1000,
    },
    {
        file: 'RecipeEditorFoodSearchMoreSourcesMobile.dc.html',
        title: 'Recipe editor, food search: more sources still searching (mobile)',
        row: 'Food search: typing and results',
        platform: 'native',
        height: 1127,
    },
    {
        file: 'RecipeEditorFoodSearchMoreSourcesDone.dc.html',
        title: 'Recipe editor, food search: results from more sources (web)',
        row: 'Food search: typing and results',
        platform: 'web',
        height: 1000,
    },
    {
        file: 'RecipeEditorFoodSearchMoreSourcesDoneMobile.dc.html',
        title: 'Recipe editor, food search: results from more sources (mobile)',
        row: 'Food search: typing and results',
        platform: 'native',
        height: 1235,
    },
    {
        file: 'RecipeEditorFoodSearchNoResults.dc.html',
        title: 'Recipe editor, food search: no matches (web)',
        row: 'Food search: typing and results',
        platform: 'web',
        height: 1000,
    },
    {
        file: 'RecipeEditorFoodSearchNoResultsMobile.dc.html',
        title: 'Recipe editor, food search: no matches (mobile)',
        row: 'Food search: typing and results',
        platform: 'native',
        height: 1019,
    },
    {
        file: 'RecipeEditorFoodSearchCatalogUnavailable.dc.html',
        title: 'Recipe editor, food search: food catalog unavailable (web)',
        row: 'Food search: problems',
        platform: 'web',
        height: 1000,
    },
    {
        file: 'RecipeEditorFoodSearchCatalogUnavailableMobile.dc.html',
        title: 'Recipe editor, food search: food catalog unavailable (mobile)',
        row: 'Food search: problems',
        platform: 'native',
        height: 1073,
    },
    {
        file: 'RecipeEditorFoodSearchYourFoodsUnavailable.dc.html',
        title: 'Recipe editor, food search: your foods unavailable (web)',
        row: 'Food search: problems',
        platform: 'web',
        height: 1000,
    },
    {
        file: 'RecipeEditorFoodSearchYourFoodsUnavailableMobile.dc.html',
        title: 'Recipe editor, food search: your foods unavailable (mobile)',
        row: 'Food search: problems',
        platform: 'native',
        height: 1217,
    },
    {
        file: 'RecipeEditorFoodSearchBothUnavailable.dc.html',
        title: 'Recipe editor, food search: your foods and catalog unavailable (web)',
        row: 'Food search: problems',
        platform: 'web',
        height: 1000,
    },
    {
        file: 'RecipeEditorFoodSearchBothUnavailableMobile.dc.html',
        title: 'Recipe editor, food search: your foods and catalog unavailable (mobile)',
        row: 'Food search: problems',
        platform: 'native',
        height: 1095,
    },
    {
        file: 'RecipeEditorFoodSearchFailed.dc.html',
        title: 'Recipe editor, food search: search failed (web)',
        row: 'Food search: problems',
        platform: 'web',
        height: 1000,
    },
    {
        file: 'RecipeEditorFoodSearchFailedMobile.dc.html',
        title: 'Recipe editor, food search: search failed (mobile)',
        row: 'Food search: problems',
        platform: 'native',
        height: 1003,
    },
    {
        file: 'RecipeEditorFoodSearchOffline.dc.html',
        title: 'Recipe editor, food search: offline (web)',
        row: 'Food search: problems',
        platform: 'web',
        height: 1000,
    },
    {
        file: 'RecipeEditorFoodSearchOfflineMobile.dc.html',
        title: 'Recipe editor, food search: offline (mobile)',
        row: 'Food search: problems',
        platform: 'native',
        height: 1009,
    },
    {
        file: 'RecipeEditorFoodSearchSourceLimited.dc.html',
        title: 'Recipe editor, food search: lookup limit and busy source (web)',
        row: 'Food search: problems',
        platform: 'web',
        height: 1000,
    },
    {
        file: 'RecipeEditorFoodSearchSourceLimitedMobile.dc.html',
        title: 'Recipe editor, food search: lookup limit and busy source (mobile)',
        row: 'Food search: problems',
        platform: 'native',
        height: 1169,
    },
    {
        file: 'RecipeEditorFoodSearchIncomplete.dc.html',
        title: 'Recipe editor, food search: search did not finish (web)',
        row: 'Food search: problems',
        platform: 'web',
        height: 1000,
    },
    {
        file: 'RecipeEditorFoodSearchIncompleteMobile.dc.html',
        title: 'Recipe editor, food search: search did not finish (mobile)',
        row: 'Food search: problems',
        platform: 'native',
        height: 1121,
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
