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
