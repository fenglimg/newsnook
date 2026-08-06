# Reader System TTS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在阅读页用系统 TTS 提供「读原文 / 读译文」整篇朗读（播放/停止），与翻译模块解耦。

**Architecture:** 新增 `src/features/speech/`：纯函数负责 HTML→朗读文本与 locale 映射；`SpeechService` 封装 `@capacitor-community/text-to-speech`；`ReaderScreen` 只负责双按钮与状态机。对照模式读译文时只抽取 `.reader-translation`。

**Tech Stack:** TypeScript, React, Capacitor 8, `@capacitor-community/text-to-speech@^8`, linkedom（测 DOM）, 仓库既有 `scripts/*.test.ts` + rolldown/`tsx` 风格

## Global Constraints

- 系统 TTS only；不引入云端 TTS；MVP 不暴露语速/音色。
- 不修改翻译 provider / `TranslationService` DOM 翻译管线。
- 「读译文」仅在已有完整译文且非 `loading` 时可点；否则禁用。
- 不自动翻译再朗读；不逐句高亮；不默认弹出语音包安装页。
- 离开阅读页 / 换文章必须 `stop`。
- 新增生产依赖 `@capacitor-community/text-to-speech`（与 Capacitor 8 peer 对齐，装 `8.x`）。

---

## File Structure

| 文件 | 职责 |
|------|------|
| `src/features/speech/text.ts` | HTML/标题 → 朗读纯文本；对照/原文排除规则 |
| `src/features/speech/locale.ts` | `TranslationLanguage` / `auto` → BCP-47 TTS locale；解析源语言 |
| `src/features/speech/service.ts` | `speak` / `stop`；可注入 engine；超长按段队列 |
| `src/features/speech/types.ts` | `SpeechState`、`SpeakRequest` 等 |
| `src/screens/ReaderScreen.tsx` | 双按钮 UI + 状态机 |
| `scripts/speech-text.test.ts` | 文本抽取与 locale 单测 |
| `scripts/speech-service.test.ts` | service 队列/stop 单测（假 engine） |
| `package.json` | 依赖 + `test:speech` script |
| `android/app/src/main/AndroidManifest.xml` | 若 sync 未写入，补 TTS `<queries>` |

---

### Task 1: 文本抽取 + locale 映射

**Files:**
- Create: `src/features/speech/types.ts`
- Create: `src/features/speech/text.ts`
- Create: `src/features/speech/locale.ts`
- Create: `scripts/speech-text.test.ts`
- Modify: `package.json`（加 `test:speech`）

**Interfaces:**
- Produces: `export type SpeakContentMode = 'original' | 'translation' | 'translation-compare'`
- Produces: `export function buildSpeakText(title: string, html: string, mode: SpeakContentMode): string`
- Produces: `export function toTtsLocale(language: TranslationLanguage): string`
- Produces: `export function resolveSpeakLocale(options: { kind: 'original' | 'translation'; sourceLanguage: TranslationSourceLanguage; targetLanguage: TranslationLanguage; sampleText: string }): string`

- [ ] **Step 1: Write failing tests**

`scripts/speech-text.test.ts`:

```ts
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'

import { buildSpeakText } from '../src/features/speech/text'
import { resolveSpeakLocale, toTtsLocale } from '../src/features/speech/locale'

const window = parseHTML('<html><body></body></html>')
Object.assign(globalThis, {
  DOMParser: window.DOMParser,
  NodeFilter: { SHOW_TEXT: 4 },
  document: window.document,
})

assert.equal(toTtsLocale('zh-Hans'), 'zh-CN')
assert.equal(toTtsLocale('zh-Hant'), 'zh-TW')
assert.equal(toTtsLocale('en'), 'en-US')
assert.equal(toTtsLocale('ja'), 'ja-JP')

const original = buildSpeakText(
  'Hello Title',
  '<p>Hello <strong>world</strong>.</p><pre>const x = 1</pre><p class="x"><span class="reader-translation">你好世界</span></p>',
  'original',
)
assert.match(original, /Hello Title/)
assert.match(original, /Hello/)
assert.match(original, /world/)
assert.doesNotMatch(original, /const x/)
assert.doesNotMatch(original, /你好世界/)

const compare = buildSpeakText(
  '译标题',
  '<p>Hello world<span class="reader-translation">你好世界</span></p>',
  'translation-compare',
)
assert.match(compare, /译标题/)
assert.match(compare, /你好世界/)
assert.doesNotMatch(compare, /Hello world/)

const replace = buildSpeakText('译标题', '<p>你好<strong>世界</strong></p>', 'translation')
assert.match(replace, /译标题/)
assert.match(replace, /你好/)
assert.match(replace, /世界/)

assert.equal(
  resolveSpeakLocale({
    kind: 'translation',
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hans',
    sampleText: 'ignored',
  }),
  'zh-CN',
)

assert.equal(
  resolveSpeakLocale({
    kind: 'original',
    sourceLanguage: 'ja',
    targetLanguage: 'zh-Hans',
    sampleText: 'ignored',
  }),
  'ja-JP',
)

// auto + 明显中文样本 → zh-CN；极短无把握 → en-US
assert.equal(
  resolveSpeakLocale({
    kind: 'original',
    sourceLanguage: 'auto',
    targetLanguage: 'en',
    sampleText: '今天国际新闻关注世界经济与科技发展，多家媒体报道了相关进展与政策变化。',
  }),
  'zh-CN',
)

console.log('speech-text tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/speech-text.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement types + text + locale**

`src/features/speech/types.ts`:

```ts
export type SpeakContentMode = 'original' | 'translation' | 'translation-compare'

export type SpeechPlaybackState =
  | 'idle'
  | 'speaking-original'
  | 'speaking-translation'
  | 'error'
```

`src/features/speech/text.ts`（要点）：

```ts
import type { SpeakContentMode } from './types'

const SKIP_PARENTS = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG'])

function isSkipped(el: Element | null): boolean {
  if (!el) return true
  return [...SKIP_PARENTS].some((tag) => el.closest(tag.toLowerCase()))
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function buildSpeakText(title: string, html: string, mode: SpeakContentMode): string {
  const document = new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    'text/html',
  )
  const parts: string[] = []
  const t = normalizeWhitespace(title)
  if (t) parts.push(t)

  if (mode === 'translation-compare') {
    for (const el of document.body.querySelectorAll('.reader-translation')) {
      const s = normalizeWhitespace(el.textContent ?? '')
      if (s) parts.push(s)
    }
  } else {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const parent = (node as Text).parentElement
      if (
        parent &&
        !isSkipped(parent) &&
        !(mode === 'original' && parent.closest('.reader-translation'))
      ) {
        const s = normalizeWhitespace(node.nodeValue ?? '')
        if (s) parts.push(s)
      }
      node = walker.nextNode()
    }
  }

  return parts.join('\n\n')
}
```

`src/features/speech/locale.ts`（要点）：

```ts
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
```

- [ ] **Step 4: Add npm script and run tests**

在 `package.json` `scripts` 增加：

```json
"test:speech": "npx tsx scripts/speech-text.test.ts && npx tsx scripts/speech-service.test.ts"
```

（此时 `speech-service.test.ts` 尚不存在：本步先只跑 text）

Run: `npx tsx scripts/speech-text.test.ts`  
Expected: `speech-text tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/features/speech/types.ts src/features/speech/text.ts src/features/speech/locale.ts scripts/speech-text.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(speech): add speak-text extraction and TTS locale mapping

EOF
)"
```

---

### Task 2: SpeechService + 依赖

**Files:**
- Create: `src/features/speech/service.ts`
- Create: `scripts/speech-service.test.ts`
- Modify: `package.json`（依赖 + 确认 `test:speech` 含 service 测）

**Interfaces:**
- Consumes: `buildSpeakText`, `resolveSpeakLocale`, `SpeakContentMode`
- Produces:

```ts
export interface SpeechEngine {
  speak(options: { text: string; lang: string }): Promise<void>
  stop(): Promise<void>
}

export class SpeechService {
  constructor(engine?: SpeechEngine)
  stop(): Promise<void>
  speakText(text: string, lang: string): Promise<void>
}
```

- 默认 engine：`@capacitor-community/text-to-speech` 的 `TextToSpeech.speak` / `stop`
- 超长：按约 `3500` 字符在段落边界切分；段间用 `QUEUE`/顺序 `await`（假 engine 测顺序）；新 `speak` 或 `stop` 取消后续段

- [ ] **Step 1: Install dependency**

```bash
npm install @capacitor-community/text-to-speech@^8.0.2
```

Expected: `package.json` / lockfile 更新；peer 满足 `@capacitor/core` >=8。

- [ ] **Step 2: Write failing service tests**

`scripts/speech-service.test.ts`:

```ts
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
  return { engine, calls, setSpeakImpl: (fn: typeof speakImpl) => { speakImpl = fn } }
}

{
  const { engine, calls } = createFakeEngine()
  const service = new SpeechService(engine)
  await service.speakText('Hello', 'en-US')
  assert.deepEqual(calls, [{ type: 'speak', text: 'Hello', lang: 'en-US' }])
}

{
  const { engine, calls, setSpeakImpl } = createFakeEngine()
  let resolveSpeak!: () => void
  setSpeakImpl(() => new Promise((resolve) => { resolveSpeak = resolve }))
  const service = new SpeechService(engine)
  const pending = service.speakText('A', 'en-US')
  await service.stop()
  resolveSpeak()
  await pending
  assert.ok(calls.some((c) => c.type === 'stop'))
}

{
  const { engine, calls } = createFakeEngine()
  const service = new SpeechService(engine)
  const long = '段落。'.repeat(2000) // 远超 3500
  await service.speakText(long, 'zh-CN')
  assert.ok(calls.filter((c) => c.type === 'speak').length >= 2)
  assert.ok(calls.every((c) => c.type !== 'speak' || (c.text!.length <= 3600)))
}

console.log('speech-service tests passed')
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx scripts/speech-service.test.ts`  
Expected: FAIL（`SpeechService` 不存在）

- [ ] **Step 4: Implement SpeechService**

`src/features/speech/service.ts`:

```ts
import { TextToSpeech } from '@capacitor-community/text-to-speech'

export interface SpeechEngine {
  speak(options: { text: string; lang: string }): Promise<void>
  stop(): Promise<void>
}

const DEFAULT_ENGINE: SpeechEngine = {
  speak: ({ text, lang }) => TextToSpeech.speak({ text, lang, rate: 1.0, pitch: 1.0, volume: 1.0 }),
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
    await this.stop()
    const gen = this.generation
    const chunks = chunkText(trimmed)
    for (const chunk of chunks) {
      if (gen !== this.generation) return
      await this.engine.speak({ text: chunk, lang })
    }
  }
}

export function createSpeechService(): SpeechService {
  return new SpeechService()
}
```

注意：`speakText` 开头 `stop()` 会 bump `generation`；实现时先 bump 再记下 `const gen = this.generation`，再播，避免「自己 stop 掉自己」。上面伪码若有竞态，按此修正：

```ts
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
```

- [ ] **Step 5: Run tests**

Run: `npx tsx scripts/speech-text.test.ts` && `npx tsx scripts/speech-service.test.ts`  
或：`npm run test:speech`  
Expected: 全部 passed

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/features/speech/service.ts scripts/speech-service.test.ts
git commit -m "$(cat <<'EOF'
feat(speech): add SpeechService over system TTS plugin

EOF
)"
```

---

### Task 3: ReaderScreen 双按钮与状态机

**Files:**
- Modify: `src/screens/ReaderScreen.tsx`

**Interfaces:**
- Consumes: `createSpeechService`, `buildSpeakText`, `resolveSpeakLocale`, `SpeechPlaybackState`
- UI：顶栏「翻译」旁增加「读原文」「读译文」；播放中对应侧显示「停止」
- 禁用：「读原文」在 `loadState !== 'ready'`；「读译文」在 `!(translated && translationState === 'idle')`（无译文或 loading/error 未产出完整结果时禁用；`error` 且无 `translated` 禁用；若曾译成功仍保留 `translated` 则可读）
- 精确禁用条件（实现按此）：

```ts
const canSpeakOriginal = loadState === 'ready' && html.trim().length > 0
const canSpeakTranslation =
  loadState === 'ready' &&
  translationState === 'idle' &&
  !!translated &&
  buildSpeakText(translated.title, translated.html, translationPrefs.displayMode === 'compare' ? 'translation-compare' : 'translation').trim().length > 0
```

- locale：

```ts
// original
resolveSpeakLocale({
  kind: 'original',
  sourceLanguage: translated?.resolvedSourceLanguage ?? translationPrefs.sourceLanguage,
  targetLanguage: translationPrefs.targetLanguage,
  sampleText: buildSpeakText(article.title, html, 'original'),
})
// translation → kind: 'translation'
```

- [ ] **Step 1: Wire speech state + service ref**

在 `ReaderScreen` 内：

```ts
import { Volume2, Square } from 'lucide-react' // 或复用现有图标风格；文案以文字为主与「翻译」一致
import { createSpeechService } from '../features/speech/service'
import { buildSpeakText } from '../features/speech/text'
import { resolveSpeakLocale } from '../features/speech/locale'
import type { SpeechPlaybackState } from '../features/speech/types'

const speechRef = useRef(createSpeechService())
const [speechState, setSpeechState] = useState<SpeechPlaybackState>('idle')
const [speechError, setSpeechError] = useState('')
```

`useEffect` cleanup / `article.id` 变化：

```ts
useEffect(() => {
  return () => {
    void speechRef.current.stop()
  }
}, [])

useEffect(() => {
  void speechRef.current.stop()
  setSpeechState('idle')
  setSpeechError('')
}, [article.id])
```

（若现有重置译文的 effect 已在 prefs/article 变化时跑，把 stop 并入同一处亦可，避免重复。）

- [ ] **Step 2: Implement toggle handlers**

```ts
const stopSpeech = useCallback(async () => {
  await speechRef.current.stop()
  setSpeechState('idle')
}, [])

const speakOriginal = async () => {
  if (speechState === 'speaking-original') {
    await stopSpeech()
    return
  }
  setSpeechError('')
  setSpeechState('speaking-original')
  try {
    const text = buildSpeakText(article.title, html, 'original')
    const lang = resolveSpeakLocale({
      kind: 'original',
      sourceLanguage: translated?.resolvedSourceLanguage ?? translationPrefs.sourceLanguage,
      targetLanguage: translationPrefs.targetLanguage,
      sampleText: text,
    })
    await speechRef.current.speakText(text, lang)
    setSpeechState((s) => (s === 'speaking-original' ? 'idle' : s))
  } catch {
    setSpeechError('当前设备可能未安装该语言的语音包')
    setSpeechState('error')
  }
}

const speakTranslation = async () => {
  if (speechState === 'speaking-translation') {
    await stopSpeech()
    return
  }
  if (!translated) return
  setSpeechError('')
  setSpeechState('speaking-translation')
  try {
    const mode =
      translationPrefs.displayMode === 'compare' ? 'translation-compare' : 'translation'
    const text = buildSpeakText(translated.title, translated.html, mode)
    const lang = resolveSpeakLocale({
      kind: 'translation',
      sourceLanguage: translationPrefs.sourceLanguage,
      targetLanguage: translationPrefs.targetLanguage,
      sampleText: text,
    })
    await speechRef.current.speakText(text, lang)
    setSpeechState((s) => (s === 'speaking-translation' ? 'idle' : s))
  } catch {
    setSpeechError('当前设备可能未安装该语言的语音包')
    setSpeechState('error')
  }
}
```

- [ ] **Step 3: Add header buttons + error line**

在翻译按钮旁（`Languages` 那一组）增加两个 `button`，风格对齐现有 `font-mono text-[10px]`：

- 文案：`读原文` / `停止`；`读译文` / `停止`
- `disabled={!canSpeakOriginal}` / `disabled={!canSpeakTranslation && speechState !== 'speaking-translation'}`
- `aria-label` 对应
- 在现有 `translationError` 区域附近，若 `speechError` 非空则显示一行短错误（可复用同类样式）

- [ ] **Step 4: Typecheck / lint 相关文件**

Run: `npx tsc -b --pretty false`（或项目惯用 `npm run build` 中的 tsc 步）  
Expected: 无 speech / Reader 相关错误

Run: `npx oxlint src/features/speech src/screens/ReaderScreen.tsx`  
Expected: 无新增问题

- [ ] **Step 5: Commit**

```bash
git add src/screens/ReaderScreen.tsx
git commit -m "$(cat <<'EOF'
feat(reader): add original and translation speak controls

EOF
)"
```

---

### Task 4: Android sync 与 TTS queries

**Files:**
- Modify: 经 `cap sync` 更新的 Capacitor Android 配置
- Possibly Modify: `android/app/src/main/AndroidManifest.xml`

**Interfaces:**
- 无新 TS API；交付可在真机调起系统 TTS 的安装包路径

- [ ] **Step 1: Sync Capacitor**

Run: `npm run android:sync`  
Expected: 构建成功；Android 工程出现 text-to-speech 插件引用

- [ ] **Step 2: Verify / add package visibility queries**

打开 `android/app/src/main/AndroidManifest.xml`。若尚无 TTS queries，在 `<manifest>` 下增加（与 [capacitor-community/text-to-speech](https://github.com/capacitor-community/text-to-speech) 文档一致）：

```xml
<queries>
  <intent>
    <action android:name="android.intent.action.TTS_SERVICE" />
  </intent>
</queries>
```

若插件或 Capacitor 已自动合并等价条目，则不重复添加。

- [ ] **Step 3: Manual device check（验收）**

在 Android 真机 / 模拟器：

1. 打开一篇英文文章 → 「读原文」有声  
2. 未翻译时「读译文」禁用  
3. 翻译完成后「读译文」可读；对照模式不叠读原文  
4. 播放中点「停止」停止；返回列表声音停止  

- [ ] **Step 4: Commit（若有 manifest / sync 相关应入库文件）**

```bash
git add android/app/src/main/AndroidManifest.xml android/app/capacitor.plugins.json package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(android): wire text-to-speech plugin and TTS queries

EOF
)"
```

（勿提交 `android/app/build`、`.gradle` 等构建产物。）

---

## Spec coverage (self-review)

| Spec 要求 | Task |
|-----------|------|
| 系统 TTS + community 插件 | Task 2、4 |
| 读原文 / 读译文双按钮 | Task 3 |
| 无译文禁用读译文 | Task 3 |
| 播放/停止，无语速设置 | Task 2–3 |
| 对照不叠读；排除 code/pre | Task 1 |
| locale 映射与 auto 检测 | Task 1 |
| 离页/换文 stop | Task 3 |
| 错误文案（语音包） | Task 3 |
| 超长分段 | Task 2 |
| 单测 | Task 1–2 |
| 非目标未纳入 | — |

无 TBD；`SpeechService.speakText` 的 generation 语义在 Task 2 Step 4 已写明修正方式。
