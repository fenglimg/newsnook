import assert from 'node:assert/strict'

import { SpeechService, type SpeechEngine } from '../src/features/speech/service'

function createFakeEngine() {
  const calls: Array<{ type: 'speak' | 'stop'; text?: string; lang?: string }> = []
  let speakImpl: (text: string, lang: string) => Promise<void> = async () => {}
  const engine: SpeechEngine = {
    async speak({ text, lang }) {
      calls.push({ type: 'speak', text, lang })
      await speakImpl(text, lang)
    },
    async stop() {
      calls.push({ type: 'stop' })
    },
  }
  return {
    engine,
    calls,
    setSpeakImpl: (fn: typeof speakImpl) => {
      speakImpl = fn
    },
  }
}

{
  const { engine, calls } = createFakeEngine()
  const service = new SpeechService(engine)
  await service.speakText('Hello', 'en-US')
  assert.deepEqual(calls, [
    { type: 'stop' },
    { type: 'speak', text: 'Hello', lang: 'en-US' },
  ])
}

{
  const { engine, calls, setSpeakImpl } = createFakeEngine()
  let resolveSpeak!: () => void
  setSpeakImpl(
    () =>
      new Promise((resolve) => {
        resolveSpeak = resolve
      }),
  )
  const service = new SpeechService(engine)
  const pending = service.speakText('A', 'en-US')
  // wait until first speak started
  while (!calls.some((c) => c.type === 'speak')) {
    await new Promise((r) => setTimeout(r, 0))
  }
  await service.stop()
  resolveSpeak()
  await pending
  assert.ok(calls.some((c) => c.type === 'stop'))
}

{
  const { engine, calls } = createFakeEngine()
  const service = new SpeechService(engine)
  const long = '段落。'.repeat(2000)
  await service.speakText(long, 'zh-CN')
  const speaks = calls.filter((c) => c.type === 'speak')
  assert.ok(speaks.length >= 2)
  assert.ok(speaks.every((c) => (c.text?.length ?? 0) <= 3600))
}

console.log('speech-service tests passed')
