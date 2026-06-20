import { useState, useMemo } from 'react'
import { genId, formatDate } from '../utils/skuUtils'

const MSG_TYPES = ['vraag', 'bod', 'geschil']

function BerichtModal({ bericht, onClose, onSave }) {
  const isNew = !bericht
  const [form, setForm] = useState({
    datum: new Date().toISOString().split('T')[0],
    koper: '',
    sku: '',
    type: 'vraag',
    bericht: '',
    status: 'open',
    notities: '',
    ...(bericht || {}),
  })

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleSave = () => {
    onSave(isNew ? { ...form, id: genId() } : { ...form })
    onClose()
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>{isNew ? 'Bericht toevoegen' : 'Bericht bewerken'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form">
          <div className="form-row">
            <div className="form-group">
              <label>Datum</label>
              <input type="date" value={form.datum} onChange={set('datum')} />
            </div>
            <div className="form-group">
              <label>Koper</label>
              <input type="text" placeholder="@username" value={form.koper} onChange={set('koper')} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>SKU</label>
              <input type="text" placeholder="bv. IND001" value={form.sku} onChange={set('sku')} />
            </div>
            <div className="form-group">
              <label>Type</label>
              <select value={form.type} onChange={set('type')}>
                {MSG_TYPES.map((t) => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Bericht</label>
            <textarea value={form.bericht} onChange={set('bericht')} placeholder="Inhoud van het bericht…" />
          </div>
          <div className="form-group">
            <label>Status</label>
            <div className="toggle-group">
              {['open', 'afgehandeld'].map((s) => (
                <button
                  key={s}
                  className={`toggle-btn${form.status === s ? ' active' : ''}`}
                  onClick={() => setForm((f) => ({ ...f, status: s }))}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>Notities</label>
            <textarea value={form.notities} onChange={set('notities')} placeholder="Interne notities…" />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Annuleer</button>
          <button className="btn btn-primary" onClick={handleSave}>Opslaan</button>
        </div>
      </div>
    </div>
  )
}

function PrijsModal({ item, onClose, onSave }) {
  const isNew = !item
  const [form, setForm] = useState({
    datum: new Date().toISOString().split('T')[0],
    zoekterm: '',
    merk: '',
    maat: '',
    conditie: 'A',
    prijsrange_laag: '',
    prijsrange_hoog: '',
    voorgestelde_prijs: '',
    notities: '',
    ...(item || {}),
  })

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleSave = () => {
    onSave(isNew ? { ...form, id: genId() } : { ...form })
    onClose()
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>{isNew ? 'Prijsonderzoek toevoegen' : 'Prijsonderzoek bewerken'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form">
          <div className="form-row">
            <div className="form-group">
              <label>Datum</label>
              <input type="date" value={form.datum} onChange={set('datum')} />
            </div>
            <div className="form-group">
              <label>Zoekterm</label>
              <input type="text" placeholder="bv. Ralph Lauren trui" value={form.zoekterm} onChange={set('zoekterm')} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Merk</label>
              <input type="text" placeholder="bv. Ralph Lauren" value={form.merk} onChange={set('merk')} />
            </div>
            <div className="form-group">
              <label>Maat</label>
              <input type="text" placeholder="bv. L" value={form.maat} onChange={set('maat')} />
            </div>
            <div className="form-group">
              <label>Conditie</label>
              <select value={form.conditie} onChange={set('conditie')}>
                {['A', 'B', 'C'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Prijsrange laag (€)</label>
              <input type="number" step="0.01" min="0" value={form.prijsrange_laag} onChange={set('prijsrange_laag')} placeholder="15,00" />
            </div>
            <div className="form-group">
              <label>Prijsrange hoog (€)</label>
              <input type="number" step="0.01" min="0" value={form.prijsrange_hoog} onChange={set('prijsrange_hoog')} placeholder="45,00" />
            </div>
            <div className="form-group">
              <label>Voorgestelde prijs (€)</label>
              <input type="number" step="0.01" min="0" value={form.voorgestelde_prijs} onChange={set('voorgestelde_prijs')} placeholder="35,00" />
            </div>
          </div>
          <div className="form-group">
            <label>Notities</label>
            <textarea value={form.notities} onChange={set('notities')} placeholder="Extra info…" />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Annuleer</button>
          <button className="btn btn-primary" onClick={handleSave}>Opslaan</button>
        </div>
      </div>
    </div>
  )
}

function ConfirmDelete({ title, onCancel, onConfirm }) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onCancel}>×</button>
        </div>
        <p style={{ color: 'var(--text-2)', fontSize: 14 }}>Dit wordt permanent verwijderd.</p>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Annuleer</button>
          <button className="btn btn-danger" onClick={onConfirm}>Verwijderen</button>
        </div>
      </div>
    </div>
  )
}

const TYPE_COLOR = { vraag: 'var(--blue)', bod: 'var(--yellow)', geschil: 'var(--red)' }

export default function Berichten({ data, updateData }) {
  const { messages = [], priceResearch = [] } = data

  const [msgFilter, setMsgFilter] = useState('all')
  const [editMsg, setEditMsg] = useState(null)
  const [addMsg, setAddMsg] = useState(false)
  const [delMsg, setDelMsg] = useState(null)

  const [editPrijs, setEditPrijs] = useState(null)
  const [addPrijs, setAddPrijs] = useState(false)
  const [delPrijs, setDelPrijs] = useState(null)

  const filteredMsgs = useMemo(
    () => msgFilter === 'all' ? messages : messages.filter((m) => m.status === msgFilter),
    [messages, msgFilter]
  )

  const handleSaveMsg = (msg) => {
    const isNew = !messages.find((m) => m.id === msg.id)
    updateData({ messages: isNew ? [...messages, msg] : messages.map((m) => m.id === msg.id ? msg : m) })
  }

  const handleSavePrijs = (item) => {
    const isNew = !priceResearch.find((p) => p.id === item.id)
    updateData({ priceResearch: isNew ? [...priceResearch, item] : priceResearch.map((p) => p.id === item.id ? item : p) })
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Berichten</h1>
          <div className="page-subtitle">Berichten & prijsonderzoek</div>
        </div>
      </div>

      {/* Berichten */}
      <div className="glass-card" style={{ marginBottom: 20 }}>
        <div className="section-header">
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Berichten</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{messages.length} berichten</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {['all', 'open', 'afgehandeld'].map((s) => (
              <button
                key={s}
                className={`filter-chip${msgFilter === s ? ' active' : ''}`}
                onClick={() => setMsgFilter(s)}
              >
                {s === 'all' ? 'Alles' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
            <button className="btn btn-primary btn-sm" onClick={() => setAddMsg(true)}>+ Toevoegen</button>
          </div>
        </div>

        {filteredMsgs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-3)', fontSize: 13 }}>
            {messages.length === 0 ? 'Nog geen berichten.' : 'Geen berichten met dit filter.'}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Koper</th>
                  <th>SKU</th>
                  <th>Type</th>
                  <th>Bericht</th>
                  <th>Status</th>
                  <th>Notities</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredMsgs.map((m) => (
                  <tr key={m.id}>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--text-3)', fontSize: 12 }}>{formatDate(m.datum)}</td>
                    <td style={{ fontWeight: 500 }}>{m.koper || '—'}</td>
                    <td>
                      {m.sku
                        ? <span className="sku-tag" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-2)' }}>{m.sku}</span>
                        : '—'}
                    </td>
                    <td>
                      <span className="badge" style={{
                        background: (TYPE_COLOR[m.type] || '#666') + '18',
                        color: TYPE_COLOR[m.type] || '#666',
                        border: `1px solid ${(TYPE_COLOR[m.type] || '#666')}30`,
                      }}>
                        {m.type}
                      </span>
                    </td>
                    <td className="td-truncate">{m.bericht || '—'}</td>
                    <td>
                      <span className={`badge ${m.status === 'open' ? 'badge-yellow' : 'badge-green'}`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="td-truncate" style={{ color: 'var(--text-3)' }}>{m.notities || '—'}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditMsg(m)} title="Bewerken">✏️</button>
                        <button className="btn btn-danger btn-sm btn-icon" onClick={() => setDelMsg(m.id)} title="Verwijderen">🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Prijsonderzoek */}
      <div className="glass-card">
        <div className="section-header">
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Prijsonderzoek</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{priceResearch.length} onderzoeken</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setAddPrijs(true)}>+ Toevoegen</button>
        </div>

        {priceResearch.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-3)', fontSize: 13 }}>
            Nog geen prijsonderzoek.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Zoekterm</th>
                  <th>Merk</th>
                  <th>Maat</th>
                  <th>Cond.</th>
                  <th>Prijsrange</th>
                  <th>Voorstel</th>
                  <th>Notities</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {priceResearch.map((p) => (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--text-3)', fontSize: 12 }}>{formatDate(p.datum)}</td>
                    <td style={{ fontWeight: 500 }}>{p.zoekterm || '—'}</td>
                    <td style={{ color: 'var(--text-2)' }}>{p.merk || '—'}</td>
                    <td style={{ color: 'var(--text-2)' }}>{p.maat || '—'}</td>
                    <td>{p.conditie ? <span className="badge badge-gray">{p.conditie}</span> : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--text-2)', fontSize: 12 }}>
                      {p.prijsrange_laag && p.prijsrange_hoog
                        ? `€${parseFloat(p.prijsrange_laag).toFixed(0)} – €${parseFloat(p.prijsrange_hoog).toFixed(0)}`
                        : '—'}
                    </td>
                    <td style={{ fontWeight: 700, color: 'var(--green)', whiteSpace: 'nowrap' }}>
                      {p.voorgestelde_prijs ? `€${parseFloat(p.voorgestelde_prijs).toFixed(2)}` : '—'}
                    </td>
                    <td className="td-truncate" style={{ color: 'var(--text-3)' }}>{p.notities || '—'}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditPrijs(p)} title="Bewerken">✏️</button>
                        <button className="btn btn-danger btn-sm btn-icon" onClick={() => setDelPrijs(p.id)} title="Verwijderen">🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {addMsg && <BerichtModal onClose={() => setAddMsg(false)} onSave={handleSaveMsg} />}
      {editMsg && <BerichtModal bericht={editMsg} onClose={() => setEditMsg(null)} onSave={handleSaveMsg} />}
      {addPrijs && <PrijsModal onClose={() => setAddPrijs(false)} onSave={handleSavePrijs} />}
      {editPrijs && <PrijsModal item={editPrijs} onClose={() => setEditPrijs(null)} onSave={handleSavePrijs} />}
      {delMsg && (
        <ConfirmDelete
          title="Bericht verwijderen?"
          onCancel={() => setDelMsg(null)}
          onConfirm={() => { updateData({ messages: messages.filter((m) => m.id !== delMsg) }); setDelMsg(null) }}
        />
      )}
      {delPrijs && (
        <ConfirmDelete
          title="Prijsonderzoek verwijderen?"
          onCancel={() => setDelPrijs(null)}
          onConfirm={() => { updateData({ priceResearch: priceResearch.filter((p) => p.id !== delPrijs) }); setDelPrijs(null) }}
        />
      )}
    </div>
  )
}
