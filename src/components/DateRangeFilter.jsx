export const RANGE_LABELS = {
  today: 'Vandaag',
  week: 'Deze week',
  month: 'Deze maand',
  all: 'Alle tijd',
  custom: 'Aangepast',
}

export function getDateBounds(range, customFrom, customTo) {
  const now = new Date()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  if (range === 'today') return { from: today, to: now }
  if (range === 'week') {
    const f = new Date(today); f.setDate(f.getDate() - 6); return { from: f, to: now }
  }
  if (range === 'month') {
    const f = new Date(today); f.setDate(f.getDate() - 29); return { from: f, to: now }
  }
  if (range === 'custom') {
    return {
      from: customFrom ? new Date(customFrom) : new Date(0),
      to: customTo ? new Date(customTo + 'T23:59:59') : now,
    }
  }
  return { from: new Date(0), to: now }
}

export function filterByRange(sales, range, bounds) {
  if (range === 'all') return sales
  return sales.filter((s) => {
    if (!s.date) return false
    const d = new Date(s.date)
    return d >= bounds.from && d <= bounds.to
  })
}

export default function DateRangeFilter({ value, onChange, customFrom, customTo, onCustom }) {
  const RANGES = ['today', 'week', 'month', 'all', 'custom']

  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
      {RANGES.map((r) => (
        <button key={r} onClick={() => onChange(r)} className={`filter-chip${value === r ? ' active' : ''}`}>
          {RANGE_LABELS[r]}
        </button>
      ))}
      {value === 'custom' && (
        <>
          <input
            type="date" value={customFrom} onChange={(e) => onCustom('from', e.target.value)}
            className="search-input" style={{ width: 'auto' }}
          />
          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>–</span>
          <input
            type="date" value={customTo} onChange={(e) => onCustom('to', e.target.value)}
            className="search-input" style={{ width: 'auto' }}
          />
        </>
      )}
    </div>
  )
}
