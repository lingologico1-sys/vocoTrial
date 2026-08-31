# Audit brief: do the drawn mouth poses match the sounds they are shown for?

You have this repository checked out. Audit one thing and nothing else: whether the
pipeline that turns an aligner's phones into a drawn mouth puts the right mouth on the
right sound.

## The pipeline

Three hops, and the audit is about all three:

1. **MFA phone → Polly viseme identifier** — `PHONE_TO_POLLY` in `lipsync/visemes.py`
   (plus `normalise`, the `_STRIP` modifier handling, and the `to_polly` fallback path).
2. **Polly identifier → drawn pose** — `POLLY_VISEMES` in `src/live/visemeTable.ts`.
3. **Pose → actual artwork** — the `SLOTS` array in `src/facekit/slots.ts`. Each slot's
   `prompt` is the literal text an image model is given, so it is the most precise
   available description of what each pose *looks like*. `VISEMES` in
   `src/live/visemes.ts` gives the same poses as crude width/aperture numbers for the
   no-artwork fallback.

Real aligner output is in `lipsync/assets/*.marks.json` for English, French and Spanish —
about 1,100 marks over roughly 160 seconds. Use it. Any claim about how often something
happens should be computed from these files, not estimated.

## Hard constraints — proposals that violate these are not useful

- **A pose is a flat 2D patch** composited onto a fixed portrait. It can show lips, teeth,
  and a dark opening. It cannot show tongue position, velum, or voicing.
- **One table for every language.** Nothing may be conditioned on which language is being
  spoken. A pose set that is complete for the union of languages is complete for each one
  inside it; per-language routing is explicitly rejected and you should not propose it.
- **The pose set is fixed for this audit**: `rest, mbp, fv, st, ee, uh, aa, oh` plus
  `laugh` and `smile`, which no phone ever selects. You may *argue* that a pose is missing,
  but treat adding one as expensive: it costs a new image in every face kit ever made, and
  each new pose has to be drawn distinguishably from every existing one, which is the part
  that usually fails.
- Poses are discrete stills swapped at mark boundaries. There is no interpolation between
  artwork frames.

## What "correct" means here

Rank by what a viewer sees, in this order:

1. **Does the drawn mouth match the visible articulation of the sound?** Front-of-face
   only — lip rounding, spreading, aperture, jaw height, whether teeth show and which.
2. **Does it hold across all three languages?** A route that suits English and misdraws
   Spanish is a defect.
3. **Are distinctions preserved where they are visible, and merged where they are not?**
   Both errors count: two sounds that look different sharing a pose, and two sounds that
   look the same being split.
4. **Weight everything by frequency.** A wrong pose on 12% of marks matters more than a
   wrong pose on 0.5%. Compute the shares.

## Read the comments, then do not trust them

This codebase carries unusually long explanatory comments, many of which argue for the
current mapping. Some of that reasoning is sound and some of it is wrong — at least one
routing decision was recently found to rest on an argument that answered a different
question than the one being asked. Treat every comment as a claim by an interested party.
Where a comment justifies a mapping, say whether the justification actually holds.

Do not audit prose quality, naming, architecture, performance, or test style. Only the
sound-to-mouth correspondence.

## Specifically worth your attention

Form your own view; these are places to look, not conclusions to confirm.

- Sounds sharing a pose that a viewer could tell apart from the front, and sounds split
  across poses that look identical.
- Whether each *group* inside `PHONE_TO_POLLY` is internally coherent — an identifier
  carrying phones with genuinely different lip shapes is a defect one level up from the
  pose table, and cannot be fixed by changing `POLLY_VISEMES`.
- Diphthongs, and whether taking one element of them is right.
- Phones that reach a pose only through `to_polly`'s fallback rather than an explicit row.
- Whether any phone reaches `rest`, and whether that is correct.
- Nasals, rhotics, and laterals across the three languages.
- Whether the artwork prompts in `slots.ts` actually describe mouths that differ from one
  another, independently of whether the routing is right.

## Deliver

A report with:

1. **Findings, ranked by frequency × severity.** For each: the phones affected, the current
   route, what you think it should be, the visible-articulation reason, the share of marks
   involved computed from `lipsync/assets/`, and what the change would cost or break.
2. **A short list of things you checked and found correct**, so the negative result is on
   record and nobody re-audits them.
3. **Anything you could not settle**, and what evidence would settle it.

Be concrete and be willing to say the mapping is fine where it is. A finding with no
frequency number attached is not a finding.
