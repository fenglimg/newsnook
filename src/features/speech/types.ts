export type SpeakContentMode = 'original' | 'translation' | 'translation-compare'

export type SpeechPlaybackState =
  | 'idle'
  | 'speaking-original'
  | 'speaking-translation'
  | 'error'
