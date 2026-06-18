import { CSSProperties } from 'react'

interface PaginationProps {
  page: number
  total_pages: number
  total: number
  per_page: number
  onChange: (page: number) => void
}

function buildPages(current: number, total: number): (number | 'gap')[] {
  if (total <= 1) return [1]
  const pages = new Set<number>([1, total, current, current - 1, current + 1])
  const sorted = Array.from(pages).filter(p => p >= 1 && p <= total).sort((a, b) => a - b)
  const result: (number | 'gap')[] = []
  for (let i = 0; i < sorted.length; i++) {
    result.push(sorted[i])
    if (i < sorted.length - 1 && sorted[i + 1] - sorted[i] > 1) {
      result.push('gap')
    }
  }
  return result
}

export function Pagination({ page, total_pages, total, per_page, onChange }: PaginationProps) {
  if (total === 0) return null

  const from = (page - 1) * per_page + 1
  const to = Math.min(page * per_page, total)
  const pages = buildPages(page, total_pages)
  const prevDisabled = page <= 1
  const nextDisabled = page >= total_pages

  return (
    <div className="pagination-wrap">
      <div className="pagination-info">
        Показано {from}–{to} из {total} записей
      </div>
      <div className="pagination-controls">
        <button
          type="button"
          className="pagination-btn pagination-arrow"
          onClick={() => onChange(page - 1)}
          disabled={prevDisabled}
        >
          ← Пред.
        </button>
        <div className="pagination-numbers">
          {pages.map((p, i) =>
            p === 'gap' ? (
              <span key={`gap-${i}`} style={gapStyle}>…</span>
            ) : (
              <button
                key={p}
                type="button"
                className={`pagination-btn pagination-num${p === page ? ' active' : ''}`}
                onClick={() => onChange(p)}
                disabled={p === page}
              >
                {p}
              </button>
            )
          )}
        </div>
        <button
          type="button"
          className="pagination-btn pagination-arrow"
          onClick={() => onChange(page + 1)}
          disabled={nextDisabled}
        >
          След. →
        </button>
      </div>
    </div>
  )
}

const gapStyle: CSSProperties = {
  padding: '0 6px',
  color: '#8C7B6E',
  alignSelf: 'center',
}
