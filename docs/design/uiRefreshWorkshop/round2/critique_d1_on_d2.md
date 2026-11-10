# Designer 1 on Designer 2, round 2: Kitchen Press

Files reviewed: `round2/d2/concept.md` and `round2/d2/mockup.html`. I read the HTML source and reasoned about how it
renders. I checked the doubtful contrast pairs again from the hexes in the CSS. Every figure in D2's interface table is
correct. The new numbers below are ones the table does not show.

## Verdict

This is a real round 2. Almost every point from round 1 was fixed, and fixed properly. The owner rulings are now listed
one by one. The covers are flat shapes with precomputed overlaps, so they will build on native. The grain shows in
dark. The registration offset is set in rendered pixels. The ticket wraps. The fallback palette is drawn, not just
described. Removing DM Mono and Figtree was the right call. Two families with clear jobs is calmer and more grown-up.

I compared the screens with the current boards (`HomeMobile`, `RecipeDetailMobile`, `Collections`). The order and
placement of every element match. No layout was changed.

Is it exciting? On Home and on Collections, yes. A shelf of small prints made from the cook's own food is charming, and
no other recipe app has it. The overprinted collection covers are the best new thing in this round. But the excitement
is still mostly in thumbnails 173 px wide. On a recipe with a photo, the identity is almost gone. The print is
biggest on the hero of a recipe with no photo, and that screen is not drawn. The calm side works very well. The next
step is to make the art beautiful at large sizes, not only calm at small ones.

## Keep these

1. **Covers from the recipe's own foods, with the hash only for composition.** This is the heart of the concept. It
   also gives the cook a small reward for editing: change the food, and the print changes.
2. **Collections as overprints.** The 1-recipe collection that shows one plate is a lovely detail. The cover tells you
   how full the collection is without any words. This is the frame where desktop earns its width.
3. **Overlaps as tokens, not blend modes.** This is the right engineering for a design meant to look the same on web,
   iOS and Android. It also makes the overlap testable. (But see fix 1 on its value in light.)
4. **Text never on art.** Time, Private, Draft and PRO all sit on solid chips. Keep this rule exactly as written.
5. **Shape means press.** Pills for controls and 6–8 px rectangles for badges, tags and the timer. Together with one
   action colour, the cook never has to ask what is pressable. This is the main source of the calm.
6. **Glass measured at its worst case.** I checked it: `ink-muted` on the light glass over `ink` is 4.59:1, and on the
   dark glass over `ink` it is 4.67:1. Over the brightest dark overlap (`#B491A9`) it is 5.26:1. This is the correct
   way to specify glass.
7. **Today as an `action` ring (5.09:1 against `well`), and a muted strike on checked ingredients.** Both are small,
   correct fixes that make the states honest.
8. **Motion only after the cook acts.** The stamp on publish and the plate landing on a collection use the owner's
   one curve with the same meaning. This is a good, narrow amendment, and it is framed so the owner can say no.

## Fix these, most important first

### 1. In light, every overlap is almost black, and the table leaves that number out

The concept says day and night now "sit in the same band". That is true for the plates. It is not true for the
overlaps. The dark overlaps are given with their range (3.81 to 5.26:1). The light overlaps have no range in the table.
Here it is:

| Light overlap           | On cream         | On gold | Against `ink` text |
| ----------------------- | ---------------- | ------- | ------------------ |
| tomato × sea `#422628`  | **11.57**        | 8.97    | 1.17               |
| tomato × leaf `#382E18` | **11.33**        | 8.79    | **1.19**           |
| sea × leaf `#12404A`    | 9.59 (sage 9.08) | 7.44    | 1.33               |

The plates sit between 2.46 and 4.03:1. The overlaps sit between 7.4 and 11.6:1, so they are about three times louder
than the plates. They are also nearly the same colour as `ink` (1.19:1). So the "third colour" in light is not a third
colour. It reads as a black blot. In the soup print it is a dark crescent across the middle of the bowl. On Home, three
of four covers carry one, and those blots will be the heaviest thing on the screen, heavier than the greeting.

The two themes also lose balance in the other direction now. In round 1, dark was louder. Now light is louder: its
overlaps are about twice the contrast of the dark ones.

A true multiply of two full-strength inks is close to black. That is correct physics, but it is wrong for this
screen. Set the light overlap by a target, as you did for the plates: about 5 to 7:1 against the grounds, clearly
darker than both parents, and clearly not `ink`. These values do that (I computed them):

| Overlap       | Candidate             | On the five grounds | To parents  | To `ink` |
| ------------- | --------------------- | ------------------- | ----------- | -------- |
| tomato × sea  | `#82364A` (aubergine) | 5.36 to 6.92        | 2.19 / 1.71 | 1.94     |
| tomato × leaf | `#6E4F1E` (umber)     | 4.93 to 6.36        | 2.01 / 1.85 | 2.11     |
| sea × leaf    | `#235F68` (deep teal) | 4.75 to 6.13        | 1.52 / 1.78 | 2.20     |

Do not just lower the ink density. I tried that: at 50–60% density the overlaps become dusty mauve and grey-brown
(`#89676F`, `#836F59`), which look like dirt. The overlap must stay a saturated colour.

Then add the light overlap range to the table, so the concept's own claim can be checked.

### 2. The ink pairs repeat too much, and tomato is in almost every print

With three inks there are only three pairs. The mockup shows how fast that runs out:

- On Home, three of four covers use tomato. Pancakes (cream) and soup (sage) are both sea × tomato, and they sit on the
  same diagonal.
- In the stress test, all six chicken prints use tomato. Four of the six are sea × tomato.

The neighbour rule only covers grounds. The composition changes, which is good. But at a glance, a library is read by
colour first and by shape second. A 200-recipe library will look like tomato-and-blue, over and over. Fixes:

- Extend the neighbour rule to the ink pair. Two neighbouring cards never share a pair, including the diagonal in the
  2 × 2 grid.
- Check what really chooses the pair. The concept says the hash picks it. But in the stress test, chicken seems to
  give tomato. If a food category maps to an ink, say so. Then a cook who cooks a lot of chicken gets a red library.
- Think about a fourth ink. Four inks give six pairs instead of three. A deep plum or an ochre can fit the band, and
  neither competes with the `action` green. This needs three more overlap tokens per theme, which is cheap now that
  overlaps are tokens.

### 3. The identity disappears on the recipe page, and the no-photo hero is not drawn

The recipe page is where a cook spends the most time. In the mockup, the detail page with a photo has the new type, the
ticket and the paper. That is tasteful, but nothing there says "Kitchen Press". Then the most common case is not drawn
at all: most recipes have no photo, so their hero is a print at about 390 × 330 px.

That size is the real test of the art. At 173 px, stacked rounded rectangles read as pancakes and a circle reads as a
tomato. At 390 px, the same primitives can look like clip art: perfect circles, perfect pills, perfect bowls. Draw the
no-photo hero next round, in light and dark. If it looks crude, the motifs need a second level of detail at large
sizes (see bold suggestion 2).

Discover is also missing. Discover is where photos and prints will mix in one grid. The grain on photos at 60%
is a good idea. But only a photo next to a print shows whether they look like one set. One mixed row at 390 px
answers it.

### 4. Dark mode: show more of it, and give the dark grounds more hue

Dark is shown for Home and for the shelf. It is not shown for the recipe page or for any desktop frame. On the recipe
page that leaves the checked box in `#7CC8BE`, the current step and the ticket's dashed rules unseen. The brief and D15 both ask for both themes on every slice.
Add at least the recipe page and Collections in dark.

On the art itself: three of the five dark grounds are brown (cream `#3A3220`, blush `#3A2620`, gold `#4E3B16`). The cream
ground is only 1.38:1 against dark `paper`, so dark covers sit close to the page. Then the brightest note on each dark
cover is the overlap, and two of the three overlaps are muted (lilac `#B491A9`, khaki `#AF967D`). I expect the dark
library to look dusty and brown, which is calm but not inviting. Push the five dark grounds apart in hue, not in
lightness: keep their low contrast to the inks, but make blush a real rose-brown, cream an olive, and gold a deep amber.
The aim: five dark papers that look like five colours of card stock under a lamp, not three browns.

### 5. Gold does four jobs

Gold is an art ground (`#F7CC6E`). It is also the Draft badge, the "for 4" tag, and the PRO text. The concept says the
colour lives in the art, but gold now also marks a status and a label.

There is also a concrete failure. The Draft badge background is the same token as the gold ground. If the hash gives a
Draft recipe the gold ground, the badge is 1.00:1 against the cover. The text still passes (`ink` on gold is 10.43:1),
but the chip vanishes as a shape. In dark it is the same: `#4E3B16` on `#4E3B16`. Fix it in one of two ways:

- Make Draft a `sheet` chip with a dashed `edge` border. A dashed edge already means "not finished yet" in this
  language (the "Soon" tag uses it). Make the "for 4" tag `well`. Gold stays art and PRO only.
- Or, at the least, make the hash never give the gold ground to a Draft.

I prefer the first. It keeps the rule "colour is art" true.

### 6. One compliance claim is not quite right

The concept says glass is only on the tab bar, the photo's back and ⋯ discs, and "the carousel indicator", and calls
this "Complied". D12 names seven places: the tab bar, the condensed title bar, the editor's action bar, the jump bar,
the photo's back and ⋯ buttons, menus, and sheets. The carousel indicator is not one of them. It is a small thing, and
it is close to the navigation layer. But either list it as a small amendment, or give the indicator a solid `sheet`
ground. A list that says "complied" must have no gaps for the owner to find.

### 7. The selected segment depends on a 1 px line

On the Collections segmented control, `action-tint` against `well` is **1.01:1** in light and **1.04:1** in dark. So
the fill says nothing. The state is carried by a 1 px `action` ring and the check. It passes, because the check and the
ring both carry it. But 1 px is the thinnest line on the page, and Today uses 1.5 px. Make the ring 1.5 px, or make the
selected segment `sheet` so the fill itself carries contrast.

### Smaller points

- **Pewter on `well` is 3.04:1 in light and 3.10:1 in dark.** That passes, but only by a little. If someone nudges
  `well` later, every switch track and stepper edge on it fails. Add a token test that pins this pair, the same way
  the glass is pinned.
- **Cover chips on pale grounds are 1.15 to 1.25:1 as shapes.** The text is fine. But the time chip has no edge while
  the Private badge has a 1 px `line` edge. Give both the same edge, so all chips on art are one family.
- **The soup print uses a bowl.** A bowl is a vessel, not a food, and the motif table lists foods only. That is fine as
  a fallback, but name it in the table, so the rule and the mockup agree.
- **The "Soon" tag is 11 px.** Everything else in the system starts at 12 px. Make it 12.
- **The long-name greeting is a rule, not a render.** You said so yourself. A 30-character name at 30 px is one line
  of CSS to show. Show it.

## Two bold suggestions

1. **Give every recipe a printer's colour bar.** Print shops put a small strip of the inks they used in the margin of a
   sheet. Do the same. Make a strip of three small swatches: plate A, plate B and the overlap, about 24 × 6 px. Set it
   on `paper` beside the overline on the recipe page ("British"), and in the footer of the desktop card. It is drawn
   from the recipe's foods, like the cover, so **a recipe with a photo still has its print identity**. That fixes the
   biggest gap in fix 3 without touching the layout. It is decorative and `aria-hidden`, and it never carries text. It
   also makes the publish stamp richer: the strip stamps with the plate.

2. **Cut the plates by hand.** Today the prints are perfect geometry. That is why they risk looking like clip art when
   they are large. Give each plate outline a small wobble from the hash, about 1 to 1.5 rendered px. The edges then
   read as a linocut or a cut stencil. Precompute it into the path, so native still draws flat fills. Then add one
   detail for large sizes. At hero and collection sizes, one plate carries a coarse dot pattern, drawn as a flat
   precomputed shape (not a mask or a filter). At card size the dots are dropped. This makes a print feel made by a
   person. It is the step from "nice system" to "I want to open this app".
