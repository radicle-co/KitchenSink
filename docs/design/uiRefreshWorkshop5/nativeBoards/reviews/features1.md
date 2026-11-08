# Design review: first feature migration to Tamagui Text

Author: designer session, EVALUATE mode, 2026-11-01. This is a review, not code and not a spec.

- **Branch:** `fix/im-tamagui-features1`, commit `6ed8e6973`. I read the diff with `git show`. I did not run it.
- **Components:** `ViewSaveFailedNotice`, `UnmatchedNote`, `CollectionDetailAlert`, and the own-recipe note in
  `RecipeRatingDisplay`.

## Verdict: pass, with screenshots still owed

Each note now uses the same type role and colour as its web twin:

| Note                  | Native now                          | Web                           | Same?                               |
| --------------------- | ----------------------------------- | ----------------------------- | ----------------------------------- |
| ViewSaveFailedNotice  | `meta`, `$dangerText`               | meta size, danger text        | yes                                 |
| UnmatchedNote         | `caption`, `$attention`             | `text-caption text-attention` | yes, and fixes the old `meta` drift |
| CollectionDetailAlert | `body`, `$dangerText`, padding `$2` | `text-body text-danger-text`  | yes, and fixes the system face      |
| Own-recipe note       | `meta`, `$inkMuted`                 | `text-body-sm text-ink-muted` | yes                                 |

The open question was whether `body-sm` matches `meta`. It does. `body-sm` is 14 px at weight 400, and `meta` is
14 px at weight 400 with a 20 px line. So the own-recipe note keeps the web's size and weight.

The attention text colour is `#8C5A00` in light mode and `#EFBA64` in dark mode. I worked out that both pass 4.5:1 on
their grounds, but I did not measure them. The danger and muted roles are the same ones the other screens use.

## Still owed

- One device screenshot of each note in light and dark mode at 1x, to close the review. The collection alert must
  show its padding, because the padding moved from a style sheet to the `$2` space token.

## Findings

None in the code.
