/**
 * The languages the agent will hold a conversation in.
 *
 * Shared by the browser and the Pages Functions for the same reason models.ts
 * is: the picker and the server-side allowlist cannot drift apart, and nothing
 * the client sends is passed to a provider without being looked up here first.
 *
 * Deliberately free of imports: functions/ compiles against workers-types with
 * no DOM lib, so this has to stay pure data.
 */

export interface LanguageChoice {
  /** ISO-639-1. What OpenAI's input transcription takes as `language`. */
  code: string;
  /** English name, for the picker and for the agent's instructions. */
  label: string;
  /** The language's own name for itself, which is what the picker shows. */
  endonym: string;
  /**
   * A sample of well-formed text in the language, handed to whisper-1 as
   * `prompt`.
   *
   * Whisper conditions on that field as though it were the transcript leading
   * up to the audio, so it is a style hint rather than a vocabulary list: a
   * sentence carrying the language's accents, punctuation and conventions pulls
   * the output towards them. Without it Whisper drifts to flat unaccented ASCII
   * on exactly the short, hesitant utterances a learner produces most.
   */
  sample: string;
}

// First entry is the default.
export const LANGUAGES: LanguageChoice[] = [
  {
    code: 'fr',
    label: 'French',
    endonym: 'Français',
    sample:
      "Bonjour, je m'appelle Claire. Aujourd'hui, j'aimerais parler de mes vacances à Montréal, où il a fait très froid.",
  },
  {
    code: 'es',
    label: 'Spanish',
    endonym: 'Español',
    sample:
      'Hola, me llamo Andrés. Hoy quiero hablar de mi viaje a Sevilla, donde hacía muchísimo calor.',
  },
  {
    code: 'de',
    label: 'German',
    endonym: 'Deutsch',
    sample:
      'Guten Tag, ich heiße Jürgen. Heute möchte ich über meine Reise nach München sprechen, wo das Wetter sehr schön war.',
  },
  {
    code: 'it',
    label: 'Italian',
    endonym: 'Italiano',
    sample:
      "Buongiorno, mi chiamo Niccolò. Oggi vorrei parlare del mio viaggio a Perugia, dov'era tutto bellissimo.",
  },
  {
    code: 'pt',
    label: 'Portuguese',
    endonym: 'Português',
    sample:
      'Bom dia, meu nome é João. Hoje eu queria falar sobre a minha viagem a São Paulo, onde estava muito calor.',
  },
  {
    code: 'ja',
    label: 'Japanese',
    endonym: '日本語',
    sample: 'こんにちは、田中と申します。今日は京都への旅行について話したいと思います。',
  },
  {
    code: 'zh',
    label: 'Mandarin Chinese',
    endonym: '中文',
    sample: '你好，我叫李明。今天我想聊聊我去北京旅行的经历。',
  },
  {
    code: 'ko',
    label: 'Korean',
    endonym: '한국어',
    sample: '안녕하세요, 저는 김민수입니다. 오늘은 제주도 여행에 대해 이야기하고 싶습니다.',
  },
  {
    code: 'en',
    label: 'English',
    endonym: 'English',
    sample:
      "Hello, my name is Alex. Today I'd like to talk about my trip to Edinburgh, where it rained the whole week.",
  },
];

export function findLanguage(code: string): LanguageChoice | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

export function defaultLanguageCode(): string {
  return LANGUAGES[0].code;
}
