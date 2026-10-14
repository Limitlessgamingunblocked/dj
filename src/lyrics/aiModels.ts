/*
 * The speech models AI lyrics can use, and the languages it can be told to
 * expect. Shared by the listening worker and the settings.
 */

export type ListenQuality = 'standard' | 'best';

export interface ModelChoice {
  id: ListenQuality;
  name: string;
  /** what you'd notice */
  note: string;
  /** a rough download size, said to the player */
  size: string;
  /** Hugging Face repos to try in order (the first that loads wins) */
  repos: string[];
}

export const LISTEN_MODELS: Record<ListenQuality, ModelChoice> = {
  standard: {
    id: 'standard',
    name: 'Standard',
    note: 'Whisper Base: quick, and right on most clear vocals',
    size: 'about 80–150 MB',
    repos: ['onnx-community/whisper-base_timestamped', 'Xenova/whisper-base'],
  },
  best: {
    id: 'best',
    name: 'Best',
    note: 'Whisper Small: slower and a bigger download, better on busy mixes and accents',
    size: 'about 250–450 MB',
    repos: ['onnx-community/whisper-small_timestamped', 'Xenova/whisper-small'],
  },
};

/** the languages offered (Whisper knows ~100; these cover most dance music) */
export const LISTEN_LANGUAGES: [code: string, name: string][] = [
  ['auto', 'Detect it'],
  ['en', 'English'],
  ['es', 'Spanish'],
  ['pt', 'Portuguese'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['nl', 'Dutch'],
  ['sv', 'Swedish'],
  ['pl', 'Polish'],
  ['tr', 'Turkish'],
  ['ru', 'Russian'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
  ['hi', 'Hindi'],
  ['ar', 'Arabic'],
  ['yo', 'Yoruba'],
  ['sw', 'Swahili'],
];

