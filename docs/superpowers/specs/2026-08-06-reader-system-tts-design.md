# 阅读页系统 TTS 朗读设计

> 日期：2026-08-06  
> 范围：阅读页整篇朗读（原文 / 译文双按钮），系统 TTS  
> 不改：翻译 provider / DOM 翻译管线；不做语速设置、逐句高亮、云端 TTS、音标

## 1. 目标

在阅读页为用户提供**整篇朗读**：

1. 「读原文」「读译文」两个独立入口
2. 使用系统 TTS（经 Capacitor 社区插件）
3. 译文未就绪或翻译进行中时，「读译文」禁用
4. 仅播放 / 停止；语速用系统默认

## 2. 决策摘要

| 项 | 选择 |
|---|---|
| 形态 | 整篇朗读（非段落点读、非音标） |
| 引擎 | 系统 TTS |
| 接入 | `@capacitor-community/text-to-speech` |
| UI | 双按钮：读原文 / 读译文 |
| 语速 | 系统默认（MVP 不暴露） |
| 无译文时 | 「读译文」禁用 |
| 与翻译关系 | 解耦；翻译只提供文本与就绪态 |

## 3. 架构

```
ReaderScreen
  ├─ 读原文 / 读译文 / 停止（UI + 状态）
  └─ features/speech
        ├─ html → 纯文本（跳过 code/pre/script 等）
        ├─ 语言码 → TTS locale
        └─ @capacitor-community/text-to-speech
              └─ Android TextToSpeech（web 回退 speechSynthesis）
```

| 模块 | 负责 | 不负责 |
|------|------|--------|
| `src/features/speech/` | speak / stop、文本抽取、locale 映射、错误文案 | 翻译、语速设置 |
| `ReaderScreen` | 双按钮、播放态、译文禁用条件、离页 stop | TTS 实现细节 |
| 翻译模块 | 产出 `translated`（含 title/html/resolvedSourceLanguage） | 不调用 TTS |

**生产依赖**：新增 `@capacitor-community/text-to-speech`（需 `npx cap sync`）。

## 4. 交互与状态机

### 4.1 入口

- 位置：阅读页顶栏，靠近现有「翻译」按钮
- 「读原文」：正文 `loadState === 'ready'` 后可点
- 「读译文」：已有完整译文且 `translationState !== 'loading'` 时可点；否则禁用
- 播放中：当前侧按钮变为「停止」；点另一侧则先 `stop` 再播新内容

### 4.2 读什么

| 按钮 | 标题 | 正文 |
|------|------|------|
| 读原文 | `article.title` | 原文 HTML；若含对照节点则**排除** `.reader-translation` |
| 读译文 | `translated.title` | 替换模式：译文 HTML 全文；对照模式：仅 `.reader-translation` |

### 4.3 状态

| 状态 | UI |
|------|-----|
| `idle` | 两按钮常态；译文按条件禁用 |
| `speaking-original` | 「读原文」→「停止」 |
| `speaking-translation` | 「读译文」→「停止」 |
| `error` | 短提示，不阻塞阅读；可再点重试 |

### 4.4 生命周期

- 离开阅读页或切换文章：自动 `stop`，状态回 `idle`
- 不自动触发翻译；不跟读；不高亮当前句

## 5. 文本抽取与语言

### 5.1 抽取规则

- 跳过父级：`CODE` / `PRE` / `SCRIPT` / `STYLE` / `NOSCRIPT` / `SVG`（与翻译侧一致）
- 空白归一：多余空白压成少量换行，便于 TTS 断句
- 空文本：不调用 TTS
- 超长文本：优先一次 `speak`；若系统/插件有长度限制，再按段顺序队列播放（实现时按实测）

### 5.2 Locale

| 按钮 | 来源 |
|------|------|
| 读原文 | `translated?.resolvedSourceLanguage`，否则 prefs 源语言；仍为 `auto` 则复用 `detectLanguage`，估不出回退 `en` |
| 读译文 | `translationPrefs.targetLanguage` |

映射（示例，实现时集中在一处）：

- `zh-Hans` → `zh-CN`
- `zh-Hant` → `zh-TW`
- 其余与现有 `TranslationLanguage` 对齐为 BCP-47 后交给插件

## 6. 错误处理

- 语言/引擎不可用：提示「当前设备可能未安装该语言的语音包」
- `speak` 失败：回 `idle` + 短错误条
- MVP **不**默认弹出系统语音包安装页（避免打断阅读）；后续可加可选入口

## 7. 非目标（MVP）

- 语速 / 音色设置
- 段落点读、逐句高亮、跟读
- 云端 TTS
- 音标 / 拼音
- 后台 / 锁屏续播保证
- 自动先翻译再朗读

## 8. 测试要点

- 纯函数：HTML → 朗读文本（原文排除 `.reader-translation`；对照模式只取译文节点）
- locale 映射表单测
- Reader：无译文时「读译文」禁用；播放中停止；离页 stop（可用逻辑单测或轻量组件测，按仓库现有风格）

## 9. 验收

1. 未翻译时只能读原文；译完后可读译文
2. 对照模式读译文不叠读原文
3. Android 真机上系统 TTS 可播；离开阅读页声音停止
4. 缺语音包时有可读错误提示，不崩溃
