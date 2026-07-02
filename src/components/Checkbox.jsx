// Gedeeld tussen Verkopen.jsx en Aankopen.jsx bulk-selectie — gevulde
// paarse achtergrond + wit vinkje bij aangevinkt.
export default function Checkbox({ checked, onChange, size = 20 }) {
  return (
    <label
      style={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0, cursor: 'pointer' }}
      onClick={e => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={!!checked}
        onChange={e => onChange?.(e.target.checked)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0, opacity: 0, cursor: 'pointer' }}
      />
      <span
        style={{
          width: size, height: size, borderRadius: 6, boxSizing: 'border-box',
          border: checked ? '2px solid #818cf8' : '2px solid #64748b',
          background: checked ? '#818cf8' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.15s, border-color 0.15s',
          pointerEvents: 'none',
        }}
      >
        {checked && (
          <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 16 16" fill="none">
            <path d="M3 8.5L6.5 12L13 4.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </label>
  )
}
