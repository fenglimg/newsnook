import { detectLanguage } from '../translation/detectLanguage'
import type { TranslationLanguage, TranslationSourceLanguage } from '../translation/types'

const LOCALE: Record<TranslationLanguage, string> = {
  en: 'en-US',
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-TW',
  ja: 'ja-JP',
  ko: 'ko-KR',
  fr: 'fr-FR',
  de: 'de-DE',
  es: 'es-ES',
}

export function toTtsLocale(language: TranslationLanguage): string {
  return LOCALE[language]
}

export function resolveSpeakLocale(options: {
  kind: 'original' | 'translation'
  sourceLanguage: TranslationSourceLanguage
  targetLanguage: TranslationLanguage
  sampleText: string
}): string {
  if (options.kind === 'translation') return toTtsLocale(options.targetLanguage)
  if (options.sourceLanguage !== 'auto') return toTtsLocale(options.sourceLanguage)
  const detected = detectLanguage(options.sampleText)
  return toTtsLocale(detected.language)
}
