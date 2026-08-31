# Viseme correspondence audit

**Date:** 2026-08-31  
**Scope:** Whether the pipeline from MFA phones to Polly identifiers to drawn mouth artwork puts the right visible mouth on each sound.

## Executive summary

> **Review note, 2026-08-31, after the audit was read against the code.** Three of its
> conclusions did not survive: the top-ranked finding is currently unobservable, its
> `st` recommendation conflates two different renderers, and its cost model understates
> the asymmetry between the two tables. Corrections are marked inline below and
> summarised under *Review corrections*. What was acted on is listed under *Status*.

The pipeline is not fully correct. This audit found:

- six clear sound-to-pose correspondence defects;
- one high-frequency artwork compromise in the `st` pose;
- one lower-confidence, cross-language affricate issue;
- one latent modifier bug with zero exposure in the current corpus;
- and, added on review, one artwork gap that outranks all of them: the shipped kit has
  no `st` or `fv` patch at all.

The largest exposure is not a phone-table mistake, nor even the `st` prompt this report
originally named, but a missing image: `st` and `fv` are absent from the only kit this
deployment ships, so both fall back to `ee` and a quarter of all marks render as the
exact pose `st` was built to escape. The clearest mapping errors are the collapse of visibly different vowel heights, Spanish `[β]` being drawn with fully closed lips, non-spread palatal sounds being sent to `ee`, and English rhotics losing visible rounding.

No repository behavior was changed as part of this audit. Changes made *afterwards*, in
response to it, are recorded under *Status* at the foot of this document.

## Audited pipeline

The audit covered all three hops:

1. MFA phone to Polly identifier: [`PHONE_TO_POLLY`, `normalise`, `_STRIP`, and `to_polly`](../lipsync/visemes.py).
2. Polly identifier to pose: [`POLLY_VISEMES`](../src/live/visemeTable.ts).
3. Pose to artwork: [`SLOTS`](../src/facekit/slots.ts), with [`VISEMES`](../src/live/visemes.ts) as the no-artwork fallback.

The fixed speech pose set is `rest`, `mbp`, `fv`, `st`, `ee`, `uh`, `aa`, and `oh`. `laugh` and `smile` are not selected by phones.

## Corpus and method

The frequency analysis used only the three lesson alignments described by the audit brief, excluding the two short English probe files.

| Language | Duration | Aligner phone count | Stored marks | Speech marks | Silence marks |
|---|---:|---:|---:|---:|---:|
| English | 56.44 s | 412 | 423 | 391 | 32 |
| French | 58.36 s | 288 | 315 | 285 | 30 |
| Spanish | 46.22 s | 387 | 404 | 376 | 28 |
| **Total** | **161.02 s** | **1,087** | **1,142** | **1,052** | **90** |

All reported percentages use **1,142 stored marks**, including silence, as the denominator.

The stored JSON contains Polly identifiers but not the original MFA phone. To recover phone-level exposure without guessing, the word-level identifier sequences were matched against the exact MFA 2.0 dictionaries pinned by the service. This classified 1,043 of 1,052 speech marks. The remaining nine are inside the joined French token `quis'arrondissent`, which does not match a dictionary entry as stored. Ranges in this report represent dictionary variants that produce the same stored identifier sequence.

### Identifier frequencies

| Polly identifier | Marks | Share of all marks | English | French | Spanish |
|---|---:|---:|---:|---:|---:|
| `t` | 146 | 12.78% | 70 | 35 | 41 |
| `a` | 104 | 9.11% | 21 | 32 | 51 |
| `e` | 104 | 9.11% | 25 | 30 | 49 |
| `i` | 93 | 8.14% | 43 | 21 | 29 |
| `sil` | 90 | 7.88% | 32 | 30 | 28 |
| `r` | 83 | 7.27% | 38 | 24 | 21 |
| `p` | 81 | 7.09% | 19 | 24 | 38 |
| `s` | 78 | 6.83% | 34 | 17 | 27 |
| `o` | 61 | 5.34% | 8 | 9 | 44 |
| `u` | 56 | 4.90% | 19 | 23 | 14 |
| `k` | 56 | 4.90% | 22 | 12 | 22 |
| `l` | 53 | 4.64% | 23 | 16 | 14 |
| `f` | 32 | 2.80% | 19 | 10 | 3 |
| `@` | 28 | 2.45% | 22 | 6 | 0 |
| `O` | 24 | 2.10% | 7 | 17 | 0 |
| `S` | 19 | 1.66% | 8 | 8 | 3 |
| `T` | 17 | 1.49% | 6 | 0 | 11 |
| `J` | 11 | 0.96% | 1 | 1 | 9 |
| `E` | 6 | 0.53% | 6 | 0 | 0 |

### Current pose frequencies

| Pose | Marks | Share of all marks |
|---|---:|---:|
| `st` | 294 | 25.74% |
| `ee` | 214 | 18.74% |
| `uh` | 167 | 14.62% |
| `oh` | 160 | 14.01% |
| `aa` | 104 | 9.11% |
| `rest` | 90 | 7.88% |
| `mbp` | 81 | 7.09% |
| `fv` | 32 | 2.80% |

## Findings ranked by frequency × severity

### 0. `st` and `fv` are not in the shipped kit, and render as `ee`

**Added on review; not in the original audit.**

**Affected phones:** everything routed to `st` and `fv`.
**Exposure:** **326/1,142 marks, 28.55%** — the 294 `st` marks plus the 32 `fv` marks.

[`public/faces/face/manifest.json`](../public/faces/face/manifest.json) lists six mouth
patches: `rest`, `mbp`, `ee`, `uh`, `aa`, `oh`. There is no `mouth-st.png` and no
`mouth-fv.png` in the folder or in `faceKitDefault.zip`.
[`POSE_FALLBACK`](../src/live/Face.tsx#L390) therefore sends both to `ee`.

So on the face this deployment actually ships, the entire `st` routing — the pose added
specifically because `ee` was worn by half of an English lesson's marks — is drawn as
`ee`. `fv`'s own comment in `Face.tsx` already records the same thing happening
unnoticed for `f` and `v`.

This is the largest correspondence defect in the pipeline, it is not a mapping error,
and the original audit missed it because it read the artwork *prompts* in `slots.ts`
rather than the *patches* in the kit. Every conclusion below about how `st` looks is a
conclusion about an image that does not currently exist.

**Recommended correction:** generate `st` and `fv` for the shipped kit with the prompts
as they stand, and check them in. Nothing else in this report can be evaluated on the
default face until that is done.

**Cost and risk:** two patches at $0.134 per attempt, several attempts each, judged in
the filmstrip rather than on the still metric. No code change beyond two manifest
entries.

### 1. `st` invents inward corner movement to distinguish the artwork

**Affected phones:** `/s z t d n l θ ð/` and mapped variants.  
**Current route:** `t/l/s/T → st`.  
**Exposure:** **294/1,142 marks, 25.74%**.

The close jaw and nearly meeting teeth are defensible. The invariant inward corner movement is not. [`ST_NARROWS`](../src/facekit/slots.ts#L347) instructs each corner to travel inward by up to one tenth of the closed-mouth width. The surrounding comments explicitly say narrowing exists because it distinguishes `st` from `ee`.

> **Correction.** The original text also cited the vector fallback in
> [`visemes.ts`](../src/live/visemes.ts#L102) (`w=17` against rest's `w=19`) as part of
> the same defect. It is not. `ST_NARROWS` is a prompt for kit artwork, where two bands
> of teeth carry the cue; the fallback is a two-arc drawing with no teeth at all, and
> says so in its own comment — width is the only cue it has left. Removing narrowing
> there would collapse `st` into `rest` for every kitless face. **That half of the
> recommendation is withdrawn.** The prompt half stands, and is untestable until
> finding 0 is closed.

That answers an artwork-separability question, not the visible-articulation question. Experimental work treats `/t/` and `/s/` as neutral with respect to rounding and observes their labial movement as coarticulatory rather than as a fixed inward lip target. See [Noiray et al., *Test of the movement expansion model*](https://pmc.ncbi.nlm.nih.gov/articles/PMC3055290/).

**Recommended correction:** retain the close-jaw and two-teeth-band cues, but remove `ST_NARROWS` and keep the corners neutral. Leave the vector fallback alone.

**Cost and risk:** every existing `st` patch would need regeneration. The pose could become harder to distinguish from `ee` and `fv`; the comments already report only 3.2% pixel divergence between `st` and `ee`. This is a low-to-moderate error per mark, but it affects a quarter of the corpus.

### 2. One small `oh` pose carries three visibly different rounded apertures

**Affected phones and routes:**

- `/o ø/ → o → oh`: 61 marks;
- `/ɔ ɒ œ/` and nasal counterparts `→ O → oh`: 24 marks.

**Exposure:** **85/1,142 marks, 7.44%**.

The [`oh` artwork](../src/facekit/slots.ts#L807) is a small rounded O with the jaw mostly closed. That is suitable for close rounded sounds such as `/u y w ɥ/`, but `/o ø/` are mid vowels and `/ɔ œ ɒ/` are open-mid or open. French motion-capture studies find visible within-category differences in the lip area and protrusion of rounded vowels. See [Georgeton and Audibert, *Is protrusion of French rounded vowels affected by prosodic positions?*](https://www.isca-archive.org/interspeech_2013/georgeton13_interspeech.html).

**Recommended correction:** ideally add one mid/open-rounded pose and route `o/O` to it, while leaving `u` and postalveolar fricatives on the existing close `oh` pose.

With the fixed pose set, `oh` remains the least-wrong existing choice because it preserves rounding. Routing these phones to `aa` would gain aperture but lose the more salient rounding cue.

**Cost and risk:** one new image in every face kit, with a real risk of colliding visually with both `oh` and `aa`. There is no clean mapping-only correction.

### 3. Front-vowel height is collapsed into the extremely shallow `ee`

**Affected phones and routes:**

- `/ɛ ɛ̃ ɛː/ → e → ee`: 31 marks;
- `/æ/ → E → ee`: 6 marks.

**Exposure:** **37/1,142 marks, 3.24%**.

The [`ee` artwork](../src/facekit/slots.ts#L781) permits an opening no taller than the upper lip and barely moves the jaw. `/ɛ/` is open-mid, while `/æ/` is near-open. Jaw position is visibly different even between `/ɛ/` and `/æ/`; see [Masapollo et al., *Engaging the Articulators Enhances Perception of Concordant Visible Speech Movements*](https://pmc.ncbi.nlm.nih.gov/articles/PMC7201334/).

**Recommended correction:**

- route `/ɛ/` to `@ → uh`, a closer small neutral opening;
- change `E → aa` for `/æ/`.

The relevant rows are in [`visemes.py`](../lipsync/visemes.py#L182) and [`visemeTable.ts`](../src/live/visemeTable.ts#L233).

**Cost and risk:** `E → aa` is a client-table correction, so stored packages can be reposed from their retained `E` identifier. Splitting `/ɛ/` from `/e/` is a first-hop change. Existing marks no longer contain the phone, so those alignments must be rebaked.

### 4. Palatal glides and nonsibilants are incorrectly made wide and toothy

**Affected phones and routes:**

- `/j/ → i → ee`: 14–16 marks;
- `/ɲ ʝ ɟ͡ʝ/ → J → ee`: 11 marks;
- `/ç/` has the same logical problem but occurs zero times in the corpus.

**Exposure:** **25–27/1,142 marks, 2.19–2.36%**.

These sounds have no inherent lip spreading. `/j/` normally inherits the following vowel's lip posture; `/ɲ/` and `/ʝ/` are neutral at the lips. The `J` group in [`PHONE_TO_POLLY`](../lipsync/visemes.py#L140) is internally incoherent because it also contains alveolo-palatal sibilants `/ɕ ʑ tɕ dʑ/`, for which the spread `ee` pose is more defensible.

**Recommended correction:**

- route `/ɲ ʝ ɟ͡ʝ ç/` to `k → uh`;
- ideally let `/j/` borrow the following vowel's pose; if the table must remain context-free, route it to neutral `uh`;
- keep actual alveolo-palatal sibilants on `J → ee`.

**Cost and risk:** mapping-only, but existing `i/J` marks need rebaking because their original phone is absent.

### 5. English `/r/` loses a visible rounding gesture

**Current group:**

- English `/ɹ ɻ ɚ ɝ/`;
- French `/ʁ/`;
- Spanish `/r ɾ/`;
- all become `r → uh`.

**Exposure:** at least the **19 definite `/ɹ/` marks**, and possibly the rhotic-vowel marks too: **19–33/1,142, 1.66–2.89%**.

North American `/r/` generally includes a lip gesture, strongest in prevocalic and stressed positions. French uvular and Spanish tap/trill rhotics do not share that invariant rounding. See [Gick et al., *Spatial and Temporal Properties of Gestures in North American English /R/*](https://pmc.ncbi.nlm.nih.gov/articles/PMC2894326/).

**Recommended correction:** route `/ɹ, ɻ/` to `u → oh`; retain `/ʁ, r, ɾ/` on neutral `uh`. Decide `/ɚ, ɝ/` after examining the actual English voice.

**Cost and risk:** mapping-only plus rebaking. Changing `POLLY_VISEMES.r` directly would incorrectly round every French and Spanish rhotic.

### 6. Spanish `[β]` is drawn as a firm, complete closure

**Current route:** `β → p → mbp`.  
**Exposure:** **7/1,142 marks, 0.61%**.

The source comment says that the lips meet. For the Spanish approximant they characteristically do not. Articulatory measurements show incomplete medial closure, unlike `/p/` and full `[b]`. See [Parrell, *Dynamical account of how /b, d, g/ differ from /p, t, k/ in Spanish*](https://pmc.ncbi.nlm.nih.gov/articles/PMC3703669/).

**Recommended correction:** route `β` to `uh` as the closest existing small opening. A dedicated near-bilabial opening would be more exact, but its corpus frequency does not justify another kit-wide pose.

**Cost and risk:** mapping-only plus rebaking.

### 7. English `/ɐ/` and configured `/ʌ/` are over-opened

**Current route:** `ɐ/ʌ → a → aa`.  
**Exposure:** **5–6/1,142 marks, 0.44–0.53%**.

These are central open-mid vowels, but `aa` drops the jaw dramatically.

**Recommended correction:** route both to `@ → uh`, which is closer in visible aperture and neutrality.

**Cost and risk:** mapping-only plus rebaking.

### 8. Postalveolar affricates are over-rounded across languages

**Current route:** `/tʃ dʒ/ → S → oh`.  
**Exposure:** **5/1,142 marks, 0.44%**: three Spanish `/tʃ/`, one English `/tʃ/`, and one English `/dʒ/`.

The other 14 `S` marks are `/ʃ ʒ/`, where protrusion is well supported. Affricates include a closure and are not consistently rounded, particularly Spanish `/tʃ/`. With one language-independent table, `st` is the better compromise.

**Recommended correction:** route `/tʃ dʒ/` to `t → st`; retain `/ʃ ʒ/ → S → oh`.

**Cost and risk:** mapping-only plus rebaking. This is the lowest-confidence ranked correction because English affricate rounding varies by speaker and context.

## Things checked and found correct

- `/p b m/` correctly share `mbp`, excluding the Spanish `[β]` exception above.
- `/f v/` correctly reach the distinct `fv` artwork.
- Voicing pairs correctly merge: `/p–b/`, `/f–v/`, `/t–d/`, `/s–z/`, and `/ʃ–ʒ/`.
- `/ʃ ʒ → oh/` is correct for all **14 fricative `S` marks**; the identified `S` defect is confined to five affricates.
- `T → st` is the closest available tongue-free rendering of `/θ ð/`. The earlier tongue argument answered an artwork question, but the corrected routing conclusion is sound.
- Nasalization, aspiration, length, stress, tie bars, and syllabicity are correctly stripped for this flat-patch system.
- Silence is clean: **90/1,142 marks, 7.88%**, and only `sil` reaches `rest` in the corpus. All three lessons have zero OOV words.
- The exact pinned dictionaries contain no unmapped phones and no phones that use `to_polly`'s first-character fallback. Real-corpus fallback exposure is therefore **0/1,052 speech marks**.
- Diphthong-first routing is a defensible least-bad choice under the one-still constraint. The corpus contains **15–26 marks** whose matching dictionary candidates are diphthongs. The comment's “Polly does it, therefore it is right” reasoning is insufficient, but the longer initial nucleus generally makes the selected pose preferable to the offglide.
- The prompts describe `rest`, `mbp`, `fv`, `st`, `ee`, `uh`, `aa`, and `oh` with conceptually distinct geometry. The principal prompt defect is `st` purchasing distinction with non-articulatory narrowing.

## Review corrections

Three things this report got wrong, found by reading it against the code.

### The cost model understated the asymmetry

"Mapping-only plus rebaking" appears under most findings and is too weak. The two tables
are not comparable:

- A **`POLLY_VISEMES`** change costs nothing. [`reposed()`](../src/live/visemeTable.ts#L294)
  re-derives every stored mark's pose from its retained identifier on load, and both live
  parsers derive it on the way in. No rebake, and saved packages update themselves.
- A **`PHONE_TO_POLLY`** change invalidates the Modal image (the file is copied onto it),
  requires re-running the aligner, and — at the time of the audit — **could not be applied
  to saved R2 packages at all**, because `to_marks` discarded the phone. There was no
  path from a stored mark back to the sound that selected it, and no re-alignment tool for
  packages.

That is the real reason `/æ/ → aa` is cheap and everything else in this report is not: `E`
is the one identifier with a single phone behind it, so it can move client-side.

**This has since been fixed at the source.** `to_marks` now emits `phone` beside `polly`,
and it travels through `parseMfaMarks`, `VisemeMark` and the package writer. Findings 2–8
are still phone-table changes needing a rebake, but they are no longer one-way doors.

### Finding 1 conflated the kit prompt with the vector fallback

See the correction inline above.

### The corpus percentages are prompt-exposure, not screen-exposure

Every share in this report is computed over stored marks, which is correct for asking
which mapping is worth fixing. It is not what a viewer sees, because finding 0 means the
`st` share never reaches the screen on the shipped face. The two numbers only converge
once `st` and `fv` artwork exists.

## Comments whose reasoning does not hold

### `/l/` did not have to follow `t` for this pipeline

The claim that `/l/` had to follow `t` to prevent language-dependent splitting is irrelevant to the MFA path under audit. [`PHONE_TO_POLLY`](../lipsync/visemes.py#L92) explicitly sends every language's `/l/` to identifier `l`; French `/l/` never arrives as `t` here.

The current `l → st` destination remains phonetically defensible under the no-tongue constraint, so this is not ranked as a correspondence defect. But the language-consistency argument proves nothing about its destination. It governs **53 marks, 4.64%**.

### The diphthong conclusion does not follow from Polly's table

Matching Polly's behavior establishes compatibility, not visible correctness. A single still cannot represent both targets of `/aɪ/`, `/aʊ/`, `/eɪ/`, `/oʊ/`, or `/ɔɪ/`. Choosing the initial nucleus is reasonable under the fixed-still constraint, but it must be justified by the nucleus's dominance, not by Polly having made the same collapse.

### `st` narrowing answers the wrong question

The `st` comments explain why narrowing helps an image generator produce a distinguishable patch. They do not establish that the affected sounds have inward-moving corners. Visible articulation has priority over generator convenience in this audit.

## Zero-exposure latent issue

[`normalise`](../lipsync/visemes.py#L61) strips the labialization modifier `ʷ`, even though labialization is visible lip rounding. None of the three pinned dictionaries contains a `ʷ` phone, so current exposure is **0/1,142 marks**.

If another language or dictionary introduces labialized phones, `ʷ` must stop being treated as an invisible modifier. The current normalization test that equates a labialized consonant with its plain counterpart should also change.

## What could not be settled

### Actual generated `st` distinguishability

The prompt is the most precise artwork contract available, but it is not the rendered output. It cannot be established from the repository whether regenerated `st` patches would remain distinguishable after the false narrowing cue is removed.

**Evidence needed:** contact sheets and speaking-speed filmstrips from several real face kits, with direct `st ↔ ee` and `st ↔ fv` transitions.

### Rhotic-vowel rounding

English `/ɚ, ɝ/` vary by speaker and syllabic position. The corpus proves that they currently share the neutral pose but does not prove that the actual voice visibly rounds every token.

**Evidence needed:** front-view recordings of the English source voice, aligned to the 13 relevant rhotic-vowel marks.

### Exact phones for nine French marks

The stored format discards phones, and the joined token `quis'arrondissent` does not match a dictionary entry. Its nine marks could not be assigned back to exact phones, although their Polly identifiers and pose exposure remain counted exactly.

**Evidence needed:** preserve the original `phone` beside `polly` in future mark files, or retain the source TextGrid. **Done** — see *Status*; marks baked from now on carry the phone, though this lesson's nine marks stay unclassified until it is rebaked.

## Recommended implementation order

*Revised on review.* Finding 0 comes first, because until it is done nothing in this list
changes what anyone sees, and the `st` questions cannot be answered at all.

0. Generate `st` and `fv` for the shipped kit with the prompts unchanged, and check them
   in. This is also what settles the open question about `st` distinguishability.
1. Correct `/æ/ → aa`; this is unambiguous, cheap, and can re-pose stored packages.
2. Correct Spanish `β`, `/ɐ ʌ/`, and the neutral palatals; rebake affected alignments.
3. Split `/ɛ/` from `/e/`; rebake and visually compare `uh` against the current `ee` rendering.
4. Split English `/ɹ ɻ/` from French and Spanish rhotics after checking the actual English voice.
5. Test a neutral-width `st` prompt on several kits before committing to kit-wide regeneration — but only after step 0 has shown what the *current* prompt renders.
6. Treat a new mid/open-rounded pose as a separate cost decision; it is the only complete solution to the rounded-vowel aperture collapse.
7. Change affricates only after checking English and Spanish front-view samples, because this is the least certain mapping recommendation.

## Status

Acted on, 2026-08-31:

- **Finding 3, in part — `/æ/ → aa`.** `E` moved out of the spread block in
  [`visemeTable.ts`](../src/live/visemeTable.ts). Client-table only, so stored packages
  re-pose themselves on load. Covered by `test_ash_is_open_rather_than_spread`. The
  `/ɛ/` half of the finding is deferred: it is a phone-table split.
- **"What could not be settled" — the discarded phone.** `to_marks` now records the
  normalised phone on every speech mark, and collapses runs on the `(polly, phone)` pair
  rather than the identifier alone, so the field cannot misreport a collapsed /s/+/z/.
  Carried through `VisemeMark`, `parseMfaMarks` and the package writer in
  `functions/api/lipsync/generate.ts`. `phonesDuring` in `diagnose.ts` now returns what
  its name claims. This removes the replay barrier described under *Review corrections*
  and would have let the nine French marks in `quis'arrondissent` be classified.
- **Comment corrections.** The `visemes.py` docstring named the wrong file for the pose
  table and the wrong destination for `/l/`; the `uh` fallback comment still listed `/l/`;
  the `J` block defended the whole row on an argument that covers only its sibilants; the
  `l`-consistency argument is now marked as being about Polly's tables and not the MFA
  path; `ʷ` is now documented as the one entry in `_STRIP` that discards something
  visible.

Deferred, with reasons: findings 2, 4, 5, 6, 7 and 8 are all phone-table changes needing
a Modal rebuild and a rebake, and several rest on evidence this report says it does not
have. Finding 1 waits on finding 0. The `ʷ` fix is not worth failing the build assertion
for zero exposure.

Outstanding: finding 0 — the `st` and `fv` patches must be generated in the browser and
checked in, which is the only step here that costs money and the only one that changes
what a viewer sees.

## Verification notes

The existing Python viseme test suite passes in full. Those tests prove that the current tables agree with one another and that every mapped identifier reaches a real pose. Several tests directly assert the mappings questioned in this report, so they are consistency checks rather than independent phonetic evidence.

