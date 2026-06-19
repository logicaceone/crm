import { useCallback, useEffect, useRef, useState } from 'react'

export interface PaginationInfo {
  page: number
  per_page: number
  total: number
  total_pages: number
}

export interface PaginatedResult<T> {
  items: T[]
  pagination: PaginationInfo
  /**
   * Optional extra fields the server includes alongside items/pagination
   * (e.g. /users returns admin_count). Stored on the hook so consumers
   * don't need to refetch separately.
   */
  meta?: Record<string, unknown>
}

interface UsePaginatedDataOptions {
  /** Re-run on dependency changes, like filter values. */
  deps?: ReadonlyArray<unknown>
  /** Initial page to load. */
  initialPage?: number
  /**
   * When filter `deps` change, reset to page 1 automatically. Default
   * true — matches every page in the app today.
   */
  resetPageOnDepsChange?: boolean
}

/**
 * Drives a paginated table:
 *   - tracks `page` state internally
 *   - fetches via the supplied `fetchFn(page)`
 *   - re-fetches when `page` or any item in `opts.deps` changes
 *   - resets to page 1 when filters change
 *   - **after every fetch, if the current page is past the last page
 *     (e.g. deleting the last row of page N → backend reports
 *     total_pages = N-1), it transparently re-fetches the new last
 *     page so the UI never lingers on an empty page**
 */
export function usePaginatedData<T>(
  fetchFn: (page: number) => Promise<PaginatedResult<T> | null>,
  options: UsePaginatedDataOptions = {},
) {
  const { deps = [], initialPage = 1, resetPageOnDepsChange = true } = options
  const [page, setPage] = useState<number>(initialPage)
  const [data, setData] = useState<T[]>([])
  const [pagination, setPagination] = useState<PaginationInfo | null>(null)
  const [meta, setMeta] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const firstRunRef = useRef(true)

  // Reset page when filters change (after the first mount).
  useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false
      return
    }
    if (resetPageOnDepsChange) setPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const fetchPage = useCallback(
    async (targetPage: number) => {
      setLoading(true)
      try {
        const result = await fetchFn(targetPage)
        if (!result) return
        const { items, pagination: pg, meta: m } = result

        // Page went out of range (deleted last row of last page, filters
        // shrunk the result set, etc.) — re-fetch the new last page once.
        if (pg.total_pages > 0 && targetPage > pg.total_pages) {
          setPage(pg.total_pages)
          await fetchPage(pg.total_pages)
          return
        }

        setData(items)
        setPagination(pg)
        setMeta(m ?? {})

        // total_pages == 0 means no rows at all — keep page = 1 so the
        // Pagination component hides cleanly (it returns null on total=0).
        if (pg.total_pages === 0 && page !== 1) setPage(1)
      } finally {
        setLoading(false)
      }
    },
    // fetchFn is expected to be stable (use useCallback in callers).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetchFn],
  )

  useEffect(() => {
    fetchPage(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, ...deps])

  const refetch = useCallback(() => fetchPage(page), [fetchPage, page])

  return { data, pagination, meta, page, setPage, loading, refetch }
}
