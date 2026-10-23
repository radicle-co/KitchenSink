# What ordinary people perceive as a good UI: the research

This note collects empirical research on what makes ordinary people judge an interface as beautiful, high
quality, trustworthy and premium. It proposes no design.

**How to read the tags.** Each finding says how I saw the source:

- **[full text]**: I read the paper itself.
- **[abstract]**: I saw only the abstract or a publisher page.
- **[secondary]**: I saw the number only in another paper or summary.
- **[industry]**: a company test, not peer reviewed.

**How to read strength.** _Strong_ means a large sample, or several independent studies agreeing.
_Moderate_ means one good study, or several small ones pointing the same way. _Weak_ means a small sample, an
extreme manipulation, or a correlation only. _Very weak_ means one tiny study or results that conflict.

**One warning for everything below.** Almost all of this work showed desktop website screenshots for under
one second, to students or web volunteers. Very little tests phone apps, real use over time, or "premium".

---

## 1. First impressions

**Lindgaard, Fernandes, Dudek and Brown, 2006. "Attention web designers: You have 50 milliseconds…"**
Behaviour & Information Technology 25(2). [abstract. Numbers are secondary, from Tuch 2012 Table 1].

- **What they did.** Three studies with 22, 31 and 40 people rating the appeal of web home pages at 500 ms and
  50 ms.
- **Result.** r = .97 between two 500 ms trials, .98 between 500 ms and unlimited time, and .97 between 50 ms and
  500 ms. These correlate average ratings across pages, not one person's ratings.
- **Strength.** Moderate. Tuch 2012 replicated effects even at 17 ms.
- **Caveat.** A 2011 follow-up (ACM TOCHI 18(1)) [abstract] found trust and usability judgments "largely driven
  by visual appeal", but "processed in a qualitatively different manner", and slightly slower.
- **Sources.** <https://tandfonline.com/doi/abs/10.1080/01449290500330448> and
  <https://api.crossref.org/works/10.1145%2F1959022.1959023>

**Tuch, Presslaber, Stöcklin, Opwis and Bargas-Avila, 2012. Visual complexity and prototypicality.**
International Journal of Human-Computer Studies 70(11). [full text]

Prototypicality means how much a page looks like a typical page of its kind.

- **Samples.** Study 1: 59 people, 119 real sites, 50 to 1000 ms. Study 2: 82 people with no design training,
  17 to 50 ms.
- **Study 1 effects.** Complexity: partial η² = .58. Prototypicality: .81. Interaction: .60. Prototypicality helped a lot on simple and medium pages (d = 1.96 and 1.79).
  It helped almost not at all on complex pages (d = .24).
- **Mean beauty scores (1 to 9, at 50 ms).** Typical and simple: 5.52. Typical and complex: 4.59. Untypical:
  about 4.35 at every complexity level.
- **Strength.** Moderate to strong. The effect is large and holds across two studies, but uses screenshots only.
- **Source.** <https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/38315.pdf>

**Reinecke, Yeh, Miratrix and others, 2013. Predicting first impressions from colorfulness and complexity.**
CHI 2013. [full text]

- **Sample.** 548 volunteers rated 450 sites after seeing each for 500 ms.
- **Model.** Computed colorfulness and complexity, together with age and education, gave adjusted R² = .48.
- **Shape.** Appeal fell sharply for complex sites, with "a slight decline" for very simple sites too.
- **Age.** "Participants older than 45 years liked websites with a low visual complexity level more than other
  age groups."
- **Strength.** Moderate.
- **Source.** <https://kgajos.seas.harvard.edu/papers/reinecke13aesthetics.pdf>

**Reinecke and Gajos, 2014. "Quantifying visual preferences around the world."** CHI 2014. [full text]

- **Sample.** 39,975 LabintheWild volunteers from 179 countries, aged 12 to 91. After cleaning, 32,222 people
  and 771,083 paired ratings.
- **Complexity.** The relation is an inverted U. Appeal peaks at 4.2 on a 10-point scale. Too complex hurts much
  more than too simple: d = 2.0 between the peak and the most complex sites, d = 0.6 between the peak and the
  simplest sites. These d values compare the most extreme 5% of sites against the peak, so they are inflated.
    - Quote: "websites with a low to medium complexity, but not extremely low, will appeal to most."
- **Colorfulness.** Peaks at 6.1 out of 9. It matters less than complexity (d = 0.3 and 0.8).
- **Age.** People over 50 liked plain, colorless sites much less than other groups (d = 1.8, against 0.4 to 1.1).
  Older people preferred more complex sites: the peak was 4.1 to 4.2 for under-40s, 4.5 for 41 to 50, and 4.7
  for over 50. **This contradicts the 2013 paper**, and the authors say so.
- **Education.** Pre-high-school education peaked at colorfulness 6.9. Higher education lowered the preferred
  colorfulness and complexity: the complexity peak was 4.7 at pre-high-school and 4.0 for PhDs.
- **Gender and country.** Women liked colorful sites more than men. Countries differed too.
- **How much the model explains.** Conditional R² = .47, but **marginal R² = .07**. Complexity, colorfulness and
  demographics together explain about 7%. The rest comes from who rated and which site. Computed metrics alone
  predict little.
- **Strength.** Strong for the inverted U and for demographic effects existing. Weak for any single peak
  number. The sample is a self-selected web sample.
- **Source.** <https://iis.seas.harvard.edu/papers/reinecke14visual.pdf>

---

## 2. The aesthetic–usability effect

**Kurosu and Kashimura, 1995. "Apparent usability vs. inherent usability."** CHI 95. [full text, short paper]

- **What they did.** 252 raters (Monk and Lelos say 156) rated 26 ATM layouts for beauty and for how easy they
  looked to use. Nobody used the ATMs.
- **Result.** r = .589 across the 26 layouts. Quote: "the apparent usability is less correlated with the inherent
  usability compared to the apparent beauty".
- **Strength.** Weak. It is correlational, and nobody used the product.
- **Source.** <https://chi1995.chistatic.hosting.acm.org/proceedings/shortppr/mk_bdy.htm>

**Tractinsky, 1997.** CHI 97. [full text, but its tables were images that I did not read]

- **Result.** Three experiments with 104, 81 and 108 Israeli engineering students. r = .921 in Experiment 1.
- **Strength.** Moderate as a replication of the correlation. Still no real use.
- **Source.** <https://chi1997.acm.org/proceedings/paper/nt.html>

**Tractinsky, Katz and Ikar, 2000. "What is beautiful is usable."** [secondary]

- **Result.** Sample not seen. People used nine ATM layouts. After use, beauty still raised rated usability. Versions made harder
  to use (a 9-second delay) were rated less beautiful.
- **Strength.** Moderate.

**Monk and Lelos, 2007. Painted can openers.** [full text]

- **Result.** Painting identical can openers nicer or uglier "significantly affected ratings of usability" in two
  of three experiments, with students and older adults.
- **Strength.** Moderate. It is causal, but not a screen.
- **Source** (for both). <https://www-users.york.ac.uk/~am1/HOIT07MonkLelos.pdf>

**Sonderegger and Sauer, 2010.** Applied Ergonomics 41. [full text]

- **What they did.** 60 adolescents aged 14 to 17 used a simulated phone. The appealing and unappealing versions
  worked the same way.
- **Result.** The appealing version was rated more usable (F = 9.8, p < .01). Task time was shorter: 147.7 s
  against 198.5 s.
- **Follow-up.** Sauer and Sonderegger 2011 [abstract] again found higher perceived usability, but **longer**
  task times with the attractive product.
- **Strength.** Moderate for perceived usability. Very weak for performance, because the two results conflict.
- **Source.** <https://sonar.ch/documents/302271/files/Sonderegger_Sauer2010.pdf>

**Tuch, Roth, Hornbæk, Opwis and Bargas-Avila, 2012. "Is beautiful really usable?"** Computers in Human
Behavior 28(5). [abstract]

- **Result.** 80 people used one of four shop versions that varied beauty and usability. Beauty did **not** affect perceived usability. Poor usability **lowered** perceived beauty after
  use. The authors' explanation: "The frustration of poor usability lowers ratings on perceived aesthetics."
- **Strength.** Moderate. It is a clear failure to replicate in the classic direction.
- **Source.** <https://research.google/pubs/is-beautiful-really-usable-toward-understanding-the-relation-between-usability-aesthetics-and-affect-in-hci/>

**Hassenzahl, 2004, and later work** [secondary]

- Beauty judgments track "hedonic" qualities (identity and stimulation) more than usability.
- Karapanos, Hassenzahl and Martens found that stimulation drove early beauty judgments but "over time
  stimulation lost its power". In plain words, excitement from novelty fades.
- **Strength.** Weak to moderate.
- **Source.** <https://research.tue.nl/nl/publications/beauty-in-use/>

**Meta-analyses: aesthetics and objective performance**

- **Thielsch, Scharfen, Masoudi and Reuter, 2019.** Mensch und Computer. [full text] 25 studies, 3,025 people.
  "A small significant overall effect of interface aesthetics on user performance (g = 0.12)", with high
  heterogeneity and no significant moderators.
  <https://www.uni-muenster.de/imperia/md/content/owms/2019_thielsch_et_al.pdf>
- **Schlamann, Nestler and Thielsch, 2026.** [abstract, from a Zenodo record of supplementary materials.
  Peer-review status unknown.] Preregistered. 31 studies, 234 effects, 18,794 people. g = 0.29, high
  heterogeneity. Interaction device and typography were moderators.
  <https://zenodo.org/records/18777943>
- **Strength.** Moderate that the effect is real but small.
- **Gap.** I found **no meta-analysis** of beauty and _perceived_ usability.

---

## 3. Measured instruments

**Moshagen and Thielsch, 2010. VisAWI, "Facets of visual aesthetics."** IJHCS 68(10). [full text]

- **What it is.** Seven studies produced an 18-item scale with four facets:
    - **Simplicity.**
    - **Diversity:** variety and interest.
    - **Colorfulness.**
    - **Craftsmanship:** "whether the site was designed with skill and care using modern technologies".
- **Reliability.** Cronbach's α was .85 to .89 for the facets and .94 for the total.
- **Validity.** "Only the Simplicity and the Craftsmanship facets as well as the general factor were
  significantly related to perceived usability."
- **Short form.** VisAWI-S (2013, 1,673 people) [abstract] is "substantially related to the intention to
  revisit a website".
- **Strength.** Strong as a measuring tool. It describes perception. It does not show what causes it.
- **Sources.** <https://www.uni-muenster.de/OWMS/uploads/drafts_thielsch/pdf/moshagen_2010.pdf> and
  <https://ideas.repec.org/a/taf/tbitxx/v32y2013i12p1305-1311.html>

**Lavie and Tractinsky, 2004.** [abstract and secondary]

Users' judgments split into two factors:

- **Classical aesthetics:** clean, clear, pleasant, symmetrical.
- **Expressive aesthetics:** original, sophisticated, fascinating, creative.

This matters because the brief asks for a UI that is both "calm" and "exciting": people see those as **two separate
qualities**, not opposite ends of one scale.

- **Strength.** Moderate.
- **Source.** <https://arxiv.org/pdf/2207.14147>

---

## 4. Typography and reading

**Larson and Picard, "The aesthetics of reading"** (dated about 2005, venue unclear). [full text]

- **What they did.** Two studies, each with 20 people, reading the New Yorker on a tablet. "Good" typography
  used the New Yorker font with ClearType. "Poor" typography used **bitmap Courier with 2 points of extra space
  between words**.
- **Result, reading time.** With good type, people underestimated their reading time more: by 3 min 18 s against
  24 s (Study 1), and 5 min 12 s against 2 min 21 s (Study 2). The authors read this as more enjoyment.
- **Result, candle task.** 4 of 10 solved it with good type, 0 of 9 with poor type. The authors report
  χ²(1) = 2.47, p < .05, but **that statistic actually gives p ≈ .12**.
- **Strength.** Weak. The samples are tiny and the contrast extreme. Some measures showed no difference.
- **Source.** <https://outgrow.co/blog/wp-content/uploads/2018/04/05.larson-picard.pdf>

**Wallace and others, 2022. "Towards individuated reading experiences."** ACM TOCHI. [full text]

- **Sample.** 352 crowdsourced adults tried several fonts.
- **Speed.** Reading speed rose 35% from a person's slowest font (232 words per minute) to their fastest
  (314 wpm), with comprehension unchanged.
- **Preference.** A person's preferred font was their fastest only 20% of the time, "precisely at chance level".
- **Strength.** Moderate.
- **Source.** <https://jeffhuang.com/papers/Readability_TOCHI22.pdf>

**Rello, Pielot and Marcos, 2016. "Make it big!"** CHI 2016. [abstract and secondary]

- **Result.** 104 people aged 14 to 54 read Wikipedia at 10 to 26 pt, with eye tracking. Readability and comprehension improved with size up to about 18 pt. Line spacing mattered little,
  but the extremes (0.8 and 1.8) hurt.
- **Strength.** Moderate.
- **Source.** <https://editingresearch.byu.edu/?p=10398>

**Bernard, Liao and Mills, 2001.** Older adults. [abstract and secondary]

- **Result.** 14 pt was rated more legible than 12 pt and was preferred. Only two sizes were tested. A later
  thesis found that older adults preferred 16 pt.
- **Strength.** Weak to moderate.
- **Source.** <https://arxiv.org/pdf/2107.09615>

**Dyson, 2004. Review of text layout on screen.** Behaviour & IT 23(6). [full text]

- **Speed.** Longer lines, about 100 characters per line (cpl), were read fastest.
- **Comprehension.** Dyson and Haselgrove (2001) found better comprehension at 55 cpl than at 100 cpl.
- **Quote.** Longer lines are read faster, but "people prefer a more moderate length". Also, "a single wide
  column is read faster, but narrow multiple columns are preferred."
- **Strength.** Moderate. It is a review of several small studies.
- **Source.** <https://stu.westga.edu/~ssynan1/literacy/Dyson.pdf>

---

## 5. Layout: whitespace, alignment, symmetry, balance and grid

This is the thinnest area for numbers.

**Ngo, Teo and Byrne, 2003. "Modelling interface aesthetics."** Information Sciences 152. [abstract]

- **Result.** Sample not seen. Proposes 14 computed layout measures. An empirical study suggested they matter to viewers. I saw
  no numbers.
- **Strength.** Weak, because unverified.
- **Source.** <https://www.academia.edu/11749849/Modelling_interface_aesthetics>

**Miniukovich and De Angeli, 2015. "Computation of interface aesthetics."** CHI 2015. [abstract]

- **What they did.** Eight automatic metrics, including clutter and color variety, tested on desktop pages
  (N = 62) and iPhone apps (N = 53), at 150 ms and 4 s.
- **Result.** The metrics explained up to 49% of variance for web pages and up to 32% for apps once app genre
  was included.
- **Related.** Their 2014 NordiCHI paper [secondary] found complexity negatively related to beauty in mobile
  apps.
- **Strength.** Moderate. This is **the only mobile-app evidence here**.
- **Sources.** <https://iris.unitn.it/handle/11572/116796> and <https://arxiv.org/pdf/2102.02510>

**Balance and symmetry** [secondary]

- Samples not seen. Altaboli and Lin (2010) report that balance, unity and sequence each had significant effects on perceived
  interface aesthetics.
- Bauerly and Liu (2006, 2008) and Bi, Fan and Liu (2011) found that symmetry raised ratings.
- **Strength.** Weak. I saw no numbers.
- **Source.** <https://www.iadisportal.org/digital-library/experimental-investigation-of-effects-of-balance-unity-and-sequence-on-interface-and-screen-design-aesthetics>

**Space and perceived value** [abstract and secondary]

- **Sevilla and Townsend, 2016.** Journal of Marketing Research 53. Sample not seen. More empty space around products, with the
  same items, raised perceived value and appeal. This held in lab and field studies, including a jewelry store.
  A blog claims a 98% sales rise. I did not verify it.
  <https://fashionunited.uk/news/retail/shoppers-prefer-to-buy-products-with-more-space-around-them-says-study/2016112522610>
- **Pracejus, Olsen and O'Guinn, 2006.** Journal of Consumer Research. A survey of 31 creative directors
  (Olsen and others 2012) is the only sample I saw. White space in ads carries learned
  meanings such as prestige. Creative directors say that they use it to signal prestige.
  <https://ideas.repec.org/a/oup/jconrs/v33y2006i1p82-90.html>
- **Strength.** Moderate for retail displays. Not tested on apps.

**Shape** [abstract and secondary]

- **Bar and Neta, 2006.** Psychological Science. 14 people chose between pairs of curved and sharp-angled
  objects shown for 84 ms, and preferred the curved ones. It replicated in Spain and Ghana, but depends on expertise.
- **Strength.** Moderate for objects. Untested on UI corners.
- **Source.** <https://pmc.ncbi.nlm.nih.gov/articles/PMC4975689>

---

## 6. Color and dark mode

**Palmer and Schloss, 2010. "An ecological valence theory of human color preference."** PNAS. [full text]

- **Sample.** 48 people, 32 colors.
- **Model.** How much people like the objects tied to a color explained **80%** of the variance in average color
  preference (r = .893), with no free parameters.
- **Saturation.** Saturated colors were preferred to light and muted ones (F(1,47) = 9.20, p < .01).
- **Hue.** There was "a broad peak at blue" and "a pronounced minimum around dark yellow". Dark orange (brown)
  and dark yellow (olive) were disliked.
- **Strength.** Strong for single colors in isolation.
- **Source.** <https://pmc.ncbi.nlm.nih.gov/articles/PMC2889342>

**Schloss and Palmer, 2011. Color pairs.** Attention, Perception & Psychophysics. [full text]

- **Sample.** 48 people, 992 figure-and-background pairs.
- **Hue.** "Pair preference and harmony both increase as hue similarity increases", but preference "relies more
  strongly on component color preference and lightness contrast."
- **Contrast.** Pairs with very different hues were judged "neither preferable nor harmonious". When a figure color's hue
  contrasts with the background, people like that figure color more.
- **Training.** People differ a lot. The link between harmony and liking ran from +.75 to −.03, and people with
  moderate color training favored harmony most.
- **Strength.** Moderate to strong.
- **Source.** <https://pmc.ncbi.nlm.nih.gov/articles/PMC3037488>

**Dark mode** [abstract and secondary, mostly via NN/g]

- **Piepenbrock, Mayr and Buchner, 2013.** Ergonomics. Sample not seen. Dark text on a light background was better for acuity
  and proofreading in both younger and older adults. "The presentation in positive polarity is recommended for
  all ages."
- **Piepenbrock and others, 2013.** Human Factors. Sample not seen. The light-mode advantage grew as text got smaller, yet
  people **did not perceive** any readability difference.
- **Dobres, Chahine and Reimer, 2017.** Applied Ergonomics. Sample not seen. No polarity effect in daytime. At night, light mode
  was faster, and small text in dark mode was much harder to read.
- **Low vision.** Some low-vision users (for example people with cataracts) do better with dark mode.
- **Strength.** Moderate that light mode reads better for normal vision. I found no evidence on whether dark
  mode looks more "premium".
- **Sources.** <https://documentacion.fundacionmapfre.org/documentacion/bib/143702.do> and
  <https://www.nngroup.com/articles/dark-mode/>

---

## 7. Motion and perceived speed

- **Harrison, Yeo and Hudson, 2010. "Faster progress bars."** CHI 2010. [abstract and press] Progress bars with
  pulsing or backward-moving ripples felt faster than plain bars. Press reports put it at about 10%, with
  20 people. **Weak**, because I did not see the paper's numbers.
  <https://chrisharrison.net/index.php/Research/ProgressBars2>
- **Skeleton screens.** Viget 2017 [industry], about 40 to 60 people per group, simulated GIFs. Perceived wait was
  2.82 s for a skeleton, 2.41 s for a spinner and 2.29 s for a blank screen.
  Mejtoft and others (2018) [secondary] reportedly found the opposite. **Very weak and conflicting.**
  <https://www.viget.com/articles/a-bone-to-pick-with-skeleton-screens>
- **Gap.** I found **no peer-reviewed study showing that motion raises perceived quality or premium-ness**.

---

## 8. Trust, credibility, and professional versus amateur

**Fogg and others, 2003. Stanford web credibility.** DUX 2003. [full text of a summary page]

- **What they did.** 2,684 people each judged two live sites, drawn from 100 sites in 10 categories.
- **Result.** "The 'design look' of the site was mentioned most frequently, being present in 46.1 percent of the
  comments." This is a share of **comments**, not of people.
- **Strength.** Moderate. It is large, but it records what people said, not why they decided.
- **Source.** <https://advocacy.consumerreports.org/research/how-do-people-evaluate-a-web-sites-credibility>

**Robins and Holmes, 2008. "Aesthetics and credibility in web site design."** Information Processing &
Management 44. [full text]

- **What they did.** 20 graduate students saw 21 sites twice, once as published and once stripped of visual
  design, with **identical content**.
- **Result.** In 19 of 21 pairs the designed version was rated more credible. The mean decision time was 3.2 s.
- **Strength.** Moderate. The design is causal, but the sample is small.
- **Source.** <https://makinggood.ac.nz/media/1276/robinsholmes_2008_aestheticsandcredibilityinwebdesign.pdf>

**Sillence, Briggs, Harris and Fishwick, 2005. Trust in health websites.** WWW 2005. [full text]

- **What they did.** 13 people with hypertension searched for health information over four weeks.
- **Rejection.** "83% of all comments regarding rejection concerned design factors". A bad first impression
  led to "early rejection of the website", often before people explored the content.
- **Selection.** "74%" of comments about trusted sites "concerned content factors".
- **Strength.** Weak to moderate. It is qualitative and small.
- **Source.** <https://archives.iw3c2.org/www2005/proceedings/docs/p1026.pdf>

**Flat design and clickability. Burmistrov and others, 2015.** INTERACT. [abstract and secondary]

- **Result.** Sample not seen. Flat icons took about twice as long to find as realistic ones. On flat pages, people took longer to
  find clickable objects and made "a significantly greater number of errors".
- **Strength.** Weak to moderate.
- **Source.** <https://www.flatisbad.com/publications/Burmistrov-INTERACT15.pdf>

**Novelty and typicality. Hekkert, Snelders and van Wieringen, 2003. "Most advanced, yet acceptable."**
[secondary]

- **Result.** Sample not seen. The best-liked product designs combined high typicality **and** high novelty. However, the two
  suppress each other, and simple correlations with preference were not significant.
- **Strength.** Moderate in product design. Untested in UI.
- **Source.** <https://www.jimdavies.org/summaries/HekkertSneldersVanwieringen2003.html>

---

## 9. Differences by age, culture and expertise

- **Age, culture and education.** See Reinecke 2013 and 2014 in section 1.
- **Experts versus lay people** [abstract]. In a PeerJ EEG study (2017), 10 design experts and 10 lay people
  agreed on unattractive pages. Experts called more of the attractive pages unaesthetic. In a 2013 study, 111
  users rated most aesthetic attributes lower than the site's own designers did. Color training also changes how
  much people value harmony (Schloss and Palmer 2011).
- **Sources.** <https://peerj.com/articles/3440> and <https://ideas.repec.org/a/igg/jthi00/v9y2013i2p39-52.html>
- **Strength.** Weak, because the samples are small. Experts and users clearly judge differently.

---

## Evidence-backed rules

These are rules about **perception**, not design specs.

1. **People judge the look in a fraction of a second, and the judgment is stable.** _Strong_ (Lindgaard 2006,
   Tuch 2012, Reinecke 2013). **That first look carries into trust and usability judgments.** _Moderate_, and it
   can reverse after real use (Lindgaard 2011, Tuch CHB 2012).
2. **Visual complexity is the biggest single driver of first-impression appeal, and more of it hurts.** _Strong_
   (Reinecke 2014, Tuch 2012). **Extreme plainness also costs a little.** _Weak to moderate_: only one lab finds
   it, and others found a straight-line decline instead.
3. **On a simple screen, looking like a typical member of its category raises appeal a lot. On a complex
   screen, it helps very little.** _Moderate to strong_ (Tuch 2012).
4. **"Clean and orderly" and "original and exciting" are two separate qualities in users' minds, so one can rise
   without the other falling.** _Moderate_ (Lavie and Tractinsky 2004). Excitement from novelty fades with use
   (Karapanos). _Weak._
5. **Visible skill and care ("craftsmanship") is its own factor of perceived beauty, and it tracks perceived
   usability.** _Strong_ as measurement (VisAWI).
6. **A better-looking version of the same content is judged more credible, and a poor look gets content
   rejected before it is read.** _Moderate_ (Robins and Holmes 2008, Fogg 2003, Sillence 2005).
7. **Beauty raises perceived usability before use. After real use, poor usability lowers perceived beauty.**
   _Moderate,_ with mixed replications (Kurosu, Tractinsky, Sonderegger, Tuch CHB 2012).
8. **Beauty gives at best a small boost to actual performance.** _Moderate_ (g = 0.12 to 0.29).
9. **What people say they prefer in type and layout often does not match what helps them read.** _Moderate_
   (Wallace 2022, Dyson 2004, Piepenbrock 2013).
10. **Larger body text, up to about 18 pt for long desktop reading, improves reading and comprehension, and
    older readers prefer larger text.** _Moderate_ (Rello 2016, Bernard 2001). These are desktop point sizes.
    They do not map directly to phone UI sizes.
11. **For people with normal vision, dark text on a light background reads better, especially for small text,
    and people do not notice the difference.** _Moderate_ (Piepenbrock 2013, Dobres 2017).
12. **Color pairs with similar hues read as harmonious, and lightness contrast drives liking. Most people like saturated colors
    and blues. Most people dislike dark yellows and browns.** _Moderate to strong_ for colors in
    isolation (Palmer and Schloss 2010, Schloss and Palmer 2011).
13. **Moderate colorfulness is preferred on average. Highly educated people prefer less color than the average
    user. Whether designers do too is untested.** _Moderate_ (Reinecke 2014).
14. **More empty space around an item raises its perceived value.** _Moderate_ in retail, _untested_ in apps
    (Sevilla and Townsend 2016).
15. **Removing visual cues that something is clickable slows people down and causes errors.** _Weak to
    moderate_ (Burmistrov 2015).

---

## Where the evidence contradicts common design advice

- **"Minimal is always better."** Possibly not. One large study finds an inverted U: the very sparsest designs
  lose some appeal, and older users disliked colorless sites the most (Reinecke 2014). Other studies found no
  penalty at the plain end, so this point is contested.
- **"Ask users what they prefer."** Preference is a poor guide to reading performance. Fonts, line length,
  columns and polarity all show gaps (Wallace 2022, Dyson 2004, Piepenbrock 2013).
- **"Beautiful is usable."** It is fragile. In a strong test, usability changed beauty ratings, not the other
  way round (Tuch CHB 2012). The performance gain is small (g = 0.12 to 0.29).
- **"Dark mode is easier on the eyes."** For reading with normal vision, the evidence favors light mode.
- **"Be original to stand out."** For first impressions, looking typical of the category helped far more than
  looking new (Tuch 2012). Novelty helps in product design only alongside typicality (Hekkert 2003).
- **"Flat is modern and therefore better."** Flat icons and buttons were slower and more error-prone to use.
- **"Skeleton screens always feel faster."** The one controlled industry test found the opposite.
- **Two tensions with this project's brief.**
    - The reading evidence favors larger text than many designers choose, especially for older users. But it is
      desktop evidence for long reading, so it does not show that the owner's "oversized" complaint is wrong.
    - Higher education lowers preferred colorfulness, so a team's sense of "calm" possibly sits below ordinary users'
      peak.

---

## What is unknown

- **Phone apps.** Nearly all evidence is desktop screenshots seen for under a second. Only Miniukovich covers
  phone apps.
- **"Premium."** No study I found measures "premium" or "luxury" for a UI, in light or dark mode. The nearest
  evidence is retail space and print white space.
- **Motion.** I found no peer-reviewed evidence that motion makes a UI look higher quality. Evidence on
  perceived speed is thin and conflicting.
- **Layout metrics.** No verified numbers link balance, symmetry, alignment or grid metrics to lay ratings.
- **Perceived usability.** No meta-analysis exists of beauty and perceived usability.
- **"Cartoony" against "refined."** I found no direct study, though illustration style is probably a
  prototypicality and expertise question.
- **Time.** How first impressions hold up over weeks of real cooking use is largely untested. Karapanos suggests
  novelty fades.
