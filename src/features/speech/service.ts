import { TextToSpeech } from '@capacitor-community/text-to-speech'

export interface SpeechEngine {
  speak(options: { text: string; lang: string }): Promise<void>
  stop(): Promise<void>
}

const DEFAULT_ENGINE: SpeechEngine = {
  speak: ({ text, lang }) =>
    TextToSpeech.speak({ text, lang, rate: 1.0, pitch: 1.0, volume: 1.0 }),
  stop: () => TextToSpeech.stop(),
}

const CHUNK_LIMIT = 3500

function chunkText(text: string): string[] {
  if (text.length <= CHUNK_LIMIT) return text ? [text] : []
  const chunks: string[] = []
  let rest = text
  while (rest.length > CHUNK_LIMIT) {
    let cut = rest.lastIndexOf('\n\n', CHUNK_LIMIT)
    if (cut < CHUNK_LIMIT * 0.5) cut = rest.lastIndexOf('。', CHUNK_LIMIT)
    if (cut < CHUNK_LIMIT * 0.5) cut = rest.lastIndexOf('. ', CHUNK_LIMIT)
    if (cut < CHUNK_LIMIT * 0.5) cut = CHUNK_LIMIT
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks.filter(Boolean)
}

export class SpeechService {
  private readonly engine: SpeechEngine
  private generation = 0

  constructor(engine: SpeechEngine = DEFAULT_ENGINE) {
    this.engine = engine
  }

  async stop(): Promise<void> {
    this.generation += 1
    await this.engine.stop()
  }

  async speakText(text: string, lang: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return
    this.generation += 1
    const gen = this.generation
    await this.engine.stop()
    for (const chunk of chunkText(trimmed)) {
      if (gen !== this.generation) return
      await this.engine.speak({ text: chunk, lang })
    }
  }
}

export function createSpeechService(): SpeechService {
  return new SpeechService()
}
