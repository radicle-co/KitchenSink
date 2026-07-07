const base = 0.25;

export const space = {
    0: 0,
    1: `${base}rem`,
    2: `${base * 2}rem`,
    3: `${base * 3}rem`,
    4: `${base * 4}rem`,
    5: `${base * 6}rem`,
    6: `${base * 8}rem`,
    7: `${base * 12}rem`,
    8: `${base * 16}rem`,
    9: `${base * 24}rem`,
} as const;

export const size = {
    0: 0,
    1: `${base}rem`,
    2: `${base * 2}rem`,
    3: `${base * 3}rem`,
    4: `${base * 4}rem`,
    5: `${base * 6}rem`,
    6: `${base * 8}rem`,
    7: `${base * 12}rem`,
    8: `${base * 16}rem`,
    9: `${base * 24}rem`,
} as const;

export type Space = typeof space;
export type Size = typeof size;
