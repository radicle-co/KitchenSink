# Iteration 1 critique by Designer 2 (Fresh Cut)

I read each option's document and rendered its mockup in headless Chrome, both at first paint and after the
animations had settled. I worked out every contrast figure below from the hex values with the WCAG 2.x formula.
Numbers in brackets point to the sources at the end.

## Option 1: Pilot Light

**Fresh?** Yes, and it is the most original idea here. A cool room with one warm lamp is a mood, not a style, with
no paper or cream in it. The risk is the dish art. A soft blur of colour is how apps show an image that has not
loaded: BlurHash "shows while the real image is loading" [1]. At 52 px the rows look unloaded, and the red and orange
blobs are hard to tell apart.

**Simple?** Mostly. At first paint the lit "Last opened" row is almost invisible, because the whole row fades in.

**Palette.** It is calm and well documented, and Plum for danger is the right fix. Art in true food colours suits
appetite, because colour sets the taste we expect [6]. One gap: glow on surface is **1.12:1** in light and
**1.08:1** in dark. The document says the dark wash can be seen "from across the kitchen". At 1.08:1 it cannot. WCAG
1.4.11 asks 3:1 of a visual that shows state [2]. The pill and the step disc pass, so the page is accessible, but the
signature light carries almost no signal.

**At the stove.** It is the best of the three. The current step grows to 23 px. Reading slows below about a 0.2°
x-height [3]. My estimate: 23 px on a 390 pt phone is about a 1.9 mm x-height, fluent out to about 0.55 m. That is
arm's length, not across the kitchen.

**Keep:** one light, only for "now", always with a word.

**Fixes, in order**

1. Make the lit state visible: a 2 px Lamplight border with a darker inner keyline, or a glow of 1.3:1 or more.
2. Draw the dish art as sharp bands of each colour, not blur.
3. The floating "New recipe" button covers the last My recipes row and the Coming soon row. Pad lists by the
   button height plus 16 px.
4. Fade in the glow only, never the content.

**Bold push:** let the light grow with distance. Turn on Screen on, and the current step fills the lower half at 28
to 32 px, which is fluent to about 0.75 m. The room dims around it. This is calm technology: at need, something
comes from the edge of attention to the centre [4].

## Option 3: Enamelware

**Fresh?** It is bright and confident, and the cobalt rim is an ownable mark. But a pale blue ground with white
plates in blue rims leans toward heritage tableware, as the document itself warns.

**Distinct?** This is the biggest problem. The hero, the Home rows and My recipes show flat, illustrated dishes
(pancakes, pad thai, focaccia). The "angled photo" on the detail page is an illustration too. That contradicts "I did
not use option 2's cut-outs" and the monogram rule. The brief says the options must stay clearly different. Today
the gap between Enamelware and Fresh Cut is a circle.

**Simple?** Yes. Lists, the stepper, the labelled Screen on switch and one primary pill are all familiar.

**Palette.** It is accessible and carefully tabled. But cobalt is the button, the links, the selected tab and the
rim on every thumbnail. Ten blue rings per screen weaken the one button. NN/g measured 22% more time and 25% more
fixations with weak signifiers [5], and a primary colour reused as decoration is one. Herb against cobalt is 1.19:1,
so a ticked box and a selected control differ only in hue.

**At the stove.** It is the weakest of the three. The current step keeps 16 px body type, about a 1.3 mm x-height,
fluent only to about 0.37 m (my estimate, [3]). The wash is **1.19:1** in light and **1.16:1** in dark [2]. Only the
filled disc and a 12 px caps label mark it. Struck-through ingredients are hard to re-read.

**Keep:** the rim as the brand mark, and the monogram plate.

**Fixes, in order**

1. Remove the food illustrations: photos or monograms only, as promised.
2. Make thumbnail rims Slate. Cobalt is for actions and the hero plate only.
3. Make the current step 22 px or more, with a 2 px cobalt left rule and a 14 px sentence-case label.
4. Show ticked lines as muted text, not struck through.
5. Pad lists below the floating button, which covers "Coming soon".

**Bold push:** make the plate the progress object. In cooking mode the hero rim fills clockwise as steps are done. It
is a familiar ring, readable across a room, and still between taps.

## Sources

1. woltapp/blurhash README: https://github.com/woltapp/blurhash. Reading it, I now treat blurred art as a "loading"
   signal, not as a style.
2. WCAG 2.2 Understanding 1.4.11 Non-text Contrast: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html.
   It makes "state" visuals subject to 3:1, so both washes are decoration and not signal.
3. Legge and Bigelow (2011), "Does print size matter for reading?", _Journal of Vision_:
   https://pmc.ncbi.nlm.nih.gov/articles/PMC3428264. Its 0.2° critical print size turns "big type" into a distance I
   can estimate.
4. Calm Tech Institute principles: https://calmtech.institute/calm-tech-principles. It supports a light that comes
   forward only at need.
5. NN/g, "Flat UI Elements Attract Less Attention and Cause Uncertainty":
   https://www.nngroup.com/articles/flat-ui-less-attention-cause-uncertainty/. It is why a primary colour that is
   repeated as decoration costs findability.
6. Spence (2015), "On the psychological impact of food colour", _Flavour_:
   https://flavourjournal.biomedcentral.com/articles/10.1186/s13411-015-0031-3. Colour sets expectations of taste.
   This favours art in true food colours (Pilot Light) over a cool ground. I did not repeat the "blue suppresses
   appetite" claims, because the evidence for them is mixed.
