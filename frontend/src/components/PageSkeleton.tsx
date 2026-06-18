import { CSSProperties } from 'react'

function Bone({ w = '100%', h = 16, radius = 6, style }: {
  w?: string | number
  h?: number
  radius?: number
  style?: CSSProperties
}) {
  return (
    <div
      className="skeleton"
      style={{ width: w, height: h, borderRadius: radius, flexShrink: 0, ...style }}
    />
  )
}

export function SkeletonKpiGrid() {
  return (
    <div className="kpi-grid" style={{ marginBottom: 24 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} style={cardStyle}>
          <Bone w="55%" h={12} style={{ marginBottom: 14 }} />
          <Bone w="70%" h={28} radius={8} />
        </div>
      ))}
    </div>
  )
}

export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div style={tableWrapStyle}>
      <div style={tableHeaderStyle}>
        {Array.from({ length: cols }).map((_, i) => (
          <Bone key={i} w={`${50 + Math.random() * 50}%`} h={10} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={tableRowStyle}>
          {Array.from({ length: cols }).map((_, j) => (
            <Bone key={j} w={`${40 + Math.random() * 50}%`} h={13} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ ...cardStyle, flex: '1 1 220px' }}>
          <Bone w="60%" h={12} style={{ marginBottom: 12 }} />
          <Bone w="80%" h={20} radius={8} style={{ marginBottom: 8 }} />
          <Bone w="45%" h={10} />
        </div>
      ))}
    </div>
  )
}

const cardStyle: CSSProperties = {
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 12,
  padding: '18px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
}

const tableWrapStyle: CSSProperties = {
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 10,
  overflow: 'hidden',
}

const tableHeaderStyle: CSSProperties = {
  display: 'flex',
  gap: 24,
  padding: '12px 18px',
  background: '#F0E8DE',
  borderBottom: '1.5px solid #E8DDD3',
  alignItems: 'center',
}

const tableRowStyle: CSSProperties = {
  display: 'flex',
  gap: 24,
  padding: '13px 18px',
  borderBottom: '1px solid #E8DDD3',
  alignItems: 'center',
}
