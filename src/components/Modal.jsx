export default function Modal({ title, onClose, children, footer, className = '' }) {
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`modal ${className}`}>
        <div className="modal-header">
          <h2 style={{ fontSize: '1.1rem' }}>{title}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}
