/**
 * The learner's own language — the one explanations are written in.
 *
 * NOT THE SAME LIST AS languages.ts, and not the same question. That file is
 * every language the tutor will hold a conversation in; this is every language
 * a learner might already have. They overlap heavily and mean different things,
 * which is why picking from one list for both jobs would be wrong in a way that
 * is hard to see: French is a perfectly good target and a useless L1 for
 * somebody learning French.
 *
 * THESE TEN, BECAUSE LINGOLECTO OFFERS THESE TEN. The student page is modelled
 * on that one and the dictionary is ported from it, so a learner who uses both
 * apps meets the same list in the same order. Adding one is an entry here plus
 * a check that the model actually explains well in it.
 *
 * Deliberately free of DOM imports: the dictionary route resolves a code to a
 * name server-side, and functions/ compiles against workers-types.
 */

/**
 * `reportCode` is the wrinkle, and it is worth stating plainly.
 *
 * The end-of-call report is written by a route that resolves its L1 against
 * languages.ts and refuses anything it cannot find — see the `bad_l1` branch in
 * functions/api/report/analyse.ts. That list carries one `zh`, where this one
 * carries Simplified and Traditional separately, because a dictionary that
 * cannot tell 简体 from 繁體 is a dictionary showing half its readers the wrong
 * characters.
 *
 * So the two consumers get different things from one pick. The dictionary takes
 * `name`, a free-text language name, and honours the script. The report takes
 * `reportCode` and gets `zh` for both — prose about grammar reads the same
 * either way, and the alternative is either a language missing from the picker
 * or a second entry in a list shared with the live path that has no business
 * carrying script variants.
 */
export interface L1Choice {
  /** This app's key. Not always ISO-639-1 — see the note above. */
  code: string;
  /** The language's own name for itself, which is what the picker shows. */
  name: string;
  /** What the report route will accept, resolved against languages.ts. */
  reportCode: string;
}

// First entry is the default.
export const L1_CHOICES: L1Choice[] = [
  { code: 'en', name: 'English', reportCode: 'en' },
  { code: 'es', name: 'Español', reportCode: 'es' },
  { code: 'de', name: 'Deutsch', reportCode: 'de' },
  { code: 'pt', name: 'Português', reportCode: 'pt' },
  { code: 'it', name: 'Italiano', reportCode: 'it' },
  { code: 'ja', name: '日本語', reportCode: 'ja' },
  { code: 'hi', name: 'हिन्दी', reportCode: 'hi' },
  { code: 'ar', name: 'العربية', reportCode: 'ar' },
  { code: 'zh_hans', name: '简体中文', reportCode: 'zh' },
  { code: 'zh_hant', name: '繁體中文', reportCode: 'zh' },
];

export function findL1(code: string): L1Choice | undefined {
  return L1_CHOICES.find((choice) => choice.code === code);
}

/** The pick, or English. Never undefined — every caller needs an answer. */
export function resolveL1(code: string | null | undefined): L1Choice {
  return (code ? findL1(code) : undefined) ?? L1_CHOICES[0];
}
