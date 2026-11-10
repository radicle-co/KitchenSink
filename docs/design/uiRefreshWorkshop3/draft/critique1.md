# Critique 1 (Designer 1)

Contrast figures below are computed from the hex values in each option's own palette table (WCAG 2.x formula).

## Option 2: Fresh Cut

**Fresh?** Yes. Flat produce cut-outs on cool white are new for a recipe app. There is no paper, cream or serif. The
Home carousel of 4:3 tiles leans a little toward cards, but it does not read as dated.

**Simple?** Nearly. Every control is standard: large title, list, segmented control, stepper, one pill. Two things need
a word. "Screen on" is a switch with an unclear effect. "Keep screen awake" says what it does. The carousel shows one and
a quarter recipes, so the rest of "Recent recipes" is hidden behind a swipe. A short list shows more with no
gesture.

**Palette (Greengrocer).** Clear logic, and the art-only produce colours are a smart rule. Four problems:

- **Primary and danger are the same colour.** Tomato `#B83419` against Chili `#B0241B` is 1.14:1. "Do this" and
  "Delete" look alike. Move danger toward crimson or magenta, or move primary.
- **Rind on Shell is 2.9:1.** A field or stepper border on a Shell fill fails the 3:1 rule.
- **Surface on ground is 1.09:1.** Lists and sheets do not separate from the page without a hairline.
- Also, art colours "Tomato red" and "Blueberry" share names with UI tokens. That invites someone to use them for
  meaning.

**Keep:** the cut-out art, and the rule that text never sits on art.

**Fix:** the danger colour, the Shell border and the shape library. The whole look rests on about 40 shapes that do
not exist yet. They must still read at a 48 px list thumbnail, not as clip-art noise.

**Push:** make the shapes the voice of every empty, loading and first-run state. Then one system covers all.

## Option 3: Enamelware

**Fresh?** Partly. The one-object idea is strong. But blue-and-white enamel with a cobalt rim is a heritage, camping
mug look. It is retro rather than dated, and it sits close to the line workshop 1 crossed. The light ground tints the
whole app blue, which feels cold for food.

**Simple?** Yes. Checkbox ingredients, buttons for servings and plain rows are exactly right. Nothing needs explaining.

**Palette (Enamelware).** It is the best-argued palette here, with one object and one cobalt for action. Checks:

- Herb on ground is 4.66:1. It passes AA by 0.16, so any tinted background breaks it.
- Yolk fills against surface are 1.88:1. That is fine only because a word always rides on them.
- Cobalt does five jobs: action, link, rim, focus and selected toggle. The focus ring on a cobalt button relies on the
  2 px offset alone.

**Keep:** the one-object palette logic and the checklist ingredients.

**Fix:**

- The look depends on overhead photos that cooks do not take.
- Fallback art chosen by cuisine makes every Italian recipe look the same.
- The steam animation loops forever (`7s infinite`). That breaks "calm, nothing moves while you read".

**Push:** for the no-photo case, borrow Option 2's cut-out art and lay it on the plate, seen from above. Each recipe
then gets its own picture, and no photo is needed.
