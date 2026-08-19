/**
 * Every word on the student page, in one place.
 *
 * THE CHROME IS IN THE TARGET LANGUAGE, not in the learner's. A student
 * learning French meets a French page — the tabs, the buttons, the empty states
 * — because the twenty minutes around a conversation are as much exposure as
 * the conversation, and a page that switches to English the moment the tutor
 * stops talking teaches that French is the exercise rather than the medium.
 *
 * WHAT IS NOT HERE IS AS DELIBERATE. Word definitions, grammar notes and the
 * end-of-call evaluation arrive in the learner's own language, because those
 * are explanations — a grammar note the reader cannot read is not immersion,
 * it is a blank. Those come from the model, in the L1 the student picked, and
 * never pass through this table.
 *
 * FRENCH ONLY, FOR NOW. A second target language is a second table and a lookup
 * keyed on the session's language — which is why this is a flat object of
 * finished strings rather than French prose scattered through the JSX. The
 * shape is the migration path; nothing else about it matters yet.
 */

export const FR = {
  // --- Chrome
  tagline: 'Parle avec ton tuteur',
  l1Label: 'Ma langue',
  tabEvaluation: 'Évaluation',
  tabDictionary: 'Dictionnaire',
  tabVocab: 'Mon lexique',

  // --- The call
  start: 'Commencer',
  starting: 'Connexion…',
  hangUp: 'Raccrocher',
  again: 'Recommencer',
  pillIdle: 'Appuie sur Commencer et dis bonjour.',
  pillListening: 'Je t’écoute…',
  pillMuted: 'Micro coupé',
  pillWaiting: 'À toi de parler.',
  muteOn: 'Couper le micro',
  muteOff: 'Rallumer le micro',
  bubbleIdle: 'Ton tuteur te parlera ici.',

  // --- No session published
  noTutorTitle: 'Aucun tuteur n’est prêt',
  noTutorBody:
    'Ton professeur n’a pas encore préparé de conversation. Reviens quand il te l’aura dit.',
  loadFailedTitle: 'Impossible de charger ton tuteur',
  loadFailedBody: 'Vérifie ta connexion, puis recharge la page.',
  retry: 'Réessayer',

  // --- Evaluation
  evalIdle: 'Ton évaluation apparaîtra ici à la fin de la conversation.',
  evalDuring: 'Parle avec ton tuteur. L’évaluation viendra après.',
  evalTooShort: 'Il faut parler au moins deux minutes pour être évalué.',
  evalRemaining: (text: string) => `Encore ${text} de conversation pour être évalué.`,
  evalButton: 'Évalue-moi',
  evalWorking: 'Je relis notre conversation…',
  evalFailed: 'L’évaluation n’a pas pu être écrite.',
  evalElapsed: (text: string) => `Durée : ${text}`,

  evalBestTitle: 'Tes meilleures phrases',
  evalBestEmpty: 'Rien à citer cette fois — parle un peu plus la prochaine fois.',
  evalLevelTitle: 'Ton niveau',
  evalLadderTitle: 'Ce que tu as montré',
  evalPatternsTitle: 'À corriger',
  evalNextTitle: 'Pour progresser',
  evalUnplaced:
    'Tu n’as pas assez parlé pour que je puisse situer ton niveau. Recommence et parle plus longtemps.',
  evalYouAre: (band: string) => `Tu es au niveau ${band}.`,
  evalBorderline: (band: string) => `Tu es tout près du niveau ${band}.`,
  evalSaid: 'Tu as dit',
  evalBetter: 'Mieux',

  // --- Dictionary
  dictPlaceholder: 'Tape un mot français…',
  dictSearch: 'Chercher',
  dictEmpty: 'Tape un mot français, ou appuie longuement sur un mot de la conversation.',
  dictLoading: 'Je cherche…',
  dictNoResult: 'Je n’ai rien trouvé pour ce mot.',
  dictSave: 'Ajouter à mon lexique',
  dictSaved: 'Dans ton lexique',
  dictConjugation: 'Conjugaison',

  // --- Vocab
  vocabEmpty:
    'Ton lexique est vide. Cherche un mot dans le dictionnaire, puis ajoute-le à ton lexique.',
  vocabEmptyCategory: 'Aucun mot dans cette catégorie.',
  vocabSortAlpha: 'A–Z',
  vocabSortRecent: 'Récent',
  vocabCount: (n: number) => (n === 1 ? '1 mot' : `${n} mots`),
  vocabRemove: 'Retirer',
  vocabCats: {
    all: 'Tous',
    verb: 'Verbe',
    noun: 'Nom',
    adjective: 'Adjectif',
    adverb: 'Adverbe',
    expression: 'Expression',
    other: 'Autre',
  } as Record<string, string>,
} as const;

/**
 * A duration, said the way a person says it.
 *
 * Used for the elapsed clock and for how much longer is needed before the
 * evaluation unlocks, so it has to read naturally at both ten seconds and ten
 * minutes. Seconds are dropped past a minute: "2 min" is what somebody wants to
 * know, and "2 min 03 s" invites them to watch it.
 */
export function frenchDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  if (minutes === 0) return `${seconds} s`;
  if (seconds === 0) return `${minutes} min`;
  return `${minutes} min ${seconds} s`;
}
