import { mapConcurrent } from './asyncPool'

/** 列表刷新 / 预取 / 加载更多的默认并发上限 */
export const FEED_REFRESH_CONCURRENCY = 5

function runtimeConcurrency(): number {
  if (typeof navigator === 'undefined') return FEED_REFRESH_CONCURRENCY
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData)
  return narrow || saveData ? 2 : FEED_REFRESH_CONCURRENCY
}

/**
 * 按 FEED_REFRESH_CONCURRENCY 并行处理源 ID 列表。
 * useFeeds 的 refresh / prefetch / loadMore 统一走这里。
 */
export async function mapWithFeedConcurrency<T>(
  ids: string[],
  fn: (id: string, index: number) => Promise<T>,
  signal?: AbortSignal,
): Promise<T[]> {
  return mapConcurrent(ids, runtimeConcurrency(), fn, signal)
}
