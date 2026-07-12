import { useState } from 'react'
import Modal from './Modal'
import { formatSkuRange, formatCurrency, calcSaleProfit, getRemainingQty, getBatchUnitCost } from '../utils/skuUtils'
import { supabase } from '../utils/supabase'

const PLATFORM_PRESETS = ['Vinted', 'WhatsApp', 'Instagram', 'Lokaal']

function LinkRow({ value, onChange, onRemove }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="url" placeholder="https://…" value={value}
        onChange={(e) => onChange(e.target.value)} style={{ flex: 1 }} />
      <button type="button" className="btn btn-ghost btn-sm btn-icon"
        onClick={onRemove} style={{ flexShrink: 0, fontSize: 16, padding: '5px 9px' }}>×</button>
    </div>
  )
}

export default function EditSaleModal({ data, sale, onClose, onSave }) {
  const { batches, sales } = data

  const [batchId,      setBatchId]      = useState(sale.batchId || batches[0]?.id || '')
  const [salePrice,    setSalePrice]    = useState(sale.isFree ? '' : String(sale.salePrice ?? ''))
  const isPresetPlatform = PLATFORM_PRESETS.includes(sale.platform)
  const [platformChoice, setPlatformChoice] = useState(isPresetPlatform || !sale.platform ? (sale.platform || 'Vinted') : 'Ander')
  const [customPlatform, setCustomPlatform] = useState(isPresetPlatform ? '' : (sale.platform || ''))
  const [buyer,        setBuyer]        = useState(sale.buyer || '')
  const [buyerCountry, setBuyerCountry] = useState(sale.buyerCountry || '')
  const [shippingCost, setShippingCost] = useState(String(sale.shippingCost || ''))
  const [notes,        setNotes]        = useState(sale.notes || '')
  const [date,         setDate]         = useState(sale.date || '')
  const [saleTime,     setSaleTime]     = useState(sale.saleTime || '')
  const [shipped,      setShipped]      = useState(sale.shipped || false)
  const [shippedDate,  setShippedDate]  = useState(sale.shippedDate || date || '')
  const [links,        setLinks]        = useState(sale.links || [])
  const [isFree,       setIsFree]       = useState(sale.isFree || false)
  // Betaalbewijs/verzendbon — zelfde Storage-aanpak als de factuur-upload op
  // Kosten.jsx (publieke bucket, onraadbaar random pad, geen aparte object-
  // RLS), maar in een 'sales/'-submap van diezelfde 'invoices'-bucket i.p.v.
  // een nieuwe bucket — geen extra Supabase-setup nodig, het pad zelf is al
  // niet te raden. Enkel het pad wordt op de sale zelf opgeslagen (data.sales
  // is een JSON-array, geen losse tabel zoals business_costs, dus geen losse
  // link-stap nodig).
  const [attachmentPath, setAttachmentPath] = useState(sale.attachmentPath || null)
  const [attachmentUploading, setAttachmentUploading] = useState(false)

  const batch     = batches.find((b) => b.id === batchId)
  const remaining = batch ? getRemainingQty(batch, sales.filter((s) => s.id !== sale.id)) : 0
  const unitCost  = batch ? getBatchUnitCost(batch) : 0

  const effectivePrice    = isFree ? 0 : parseFloat(salePrice) || 0
  const effectiveShipping = parseFloat(shippingCost) || 0
  const profit = batch && !isFree
    ? calcSaleProfit({ quantity: 1, salePrice: effectivePrice, shippingCost: effectiveShipping, fees: 0 }, batch)
    : null

  const effectivePlatform = platformChoice === 'Ander' ? (customPlatform.trim() || 'Ander') : platformChoice

  const handleUploadAttachment = async (file) => {
    if (!file) return
    setAttachmentUploading(true)
    const ext = file.name.split('.').pop()
    const path = `sales/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const { error } = await supabase.storage.from('invoices').upload(path, file)
    if (error) { alert(`Upload mislukt: ${error.message}`); setAttachmentUploading(false); return }
    setAttachmentPath(path)
    setAttachmentUploading(false)
  }

  const attachmentUrl = attachmentPath
    ? supabase.storage.from('invoices').getPublicUrl(attachmentPath).data.publicUrl
    : null

  const handleSave = () => {
    onSave({
      ...sale,
      batchId,
      salePrice:    isFree ? 0 : parseFloat(salePrice) || 0,
      platform:     effectivePlatform,
      buyer:        buyer.trim(),
      buyerCountry: buyerCountry.trim(),
      shippingCost: effectiveShipping,
      notes:        notes.trim(),
      date,
      saleTime:     saleTime || null,
      shipped,
      shippedDate:  shipped ? shippedDate : null,
      links:        links.filter((l) => l.trim()),
      isFree,
      attachmentPath,
    })
    onClose()
  }

  const batchLabel = (b) => {
    const range = formatSkuRange(b.supplierPrefix, b.startNum, b.endNum)
    return `${range}${b.name ? ` — ${b.name}` : b.brand ? ` — ${b.brand}` : ''}`
  }

  return (
    <Modal
      title="Verkoop bewerken"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Annuleer</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!batch || (!salePrice && !isFree)}>
            Opslaan
          </button>
        </>
      }
    >
      <div className="form">
        <div className={`free-toggle${isFree ? ' active' : ''}`} onClick={() => setIsFree((f) => !f)}>
          <span>{isFree ? '✓' : '○'}</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Gratis weggegeven</div>
            <div style={{ fontSize: 11, color: isFree ? 'var(--green)' : 'var(--text-3)' }}>
              Prijs wordt €0
            </div>
          </div>
        </div>

        <div className="form-group">
          <label>SKU / Batch</label>
          <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            {batches.map((b) => <option key={b.id} value={b.id}>{batchLabel(b)}</option>)}
          </select>
          {batch && unitCost > 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
              Inkoop/stuk: <strong>{formatCurrency(unitCost)}</strong>
              &nbsp;·&nbsp;Resterend: <strong>{remaining}</strong>
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label>Verkoopprijs (€)</label>
            <input type="number" step="0.01" min="0" value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)} disabled={isFree} />
          </div>
          <div className="form-group">
            <label>Verzendkosten (€)</label>
            <input type="number" step="0.01" min="0" value={shippingCost}
              onChange={(e) => setShippingCost(e.target.value)} />
          </div>
        </div>

        {profit && !isFree && (
          <div style={{ fontSize: 12, color: profit.profit >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600, marginTop: -4, marginBottom: 4 }}>
            Winst: {profit.profit >= 0 ? '+' : ''}{formatCurrency(profit.profit)}
          </div>
        )}

        <div className="form-group">
          <label>Platform</label>
          <select value={platformChoice} onChange={(e) => setPlatformChoice(e.target.value)}>
            {PLATFORM_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
            <option value="Ander">Ander</option>
          </select>
          {platformChoice === 'Ander' && (
            <input
              type="text"
              placeholder="Naam van het platform"
              value={customPlatform}
              onChange={(e) => setCustomPlatform(e.target.value)}
              style={{ marginTop: 8 }}
            />
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label>Koper</label>
            <input value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="Gebruikersnaam" />
          </div>
          <div className="form-group">
            <label>Land koper</label>
            <input value={buyerCountry} onChange={(e) => setBuyerCountry(e.target.value)} placeholder="BE / NL / FR…" maxLength={3} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label>Datum</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Tijdstip</label>
            <input type="time" value={saleTime} onChange={(e) => setSaleTime(e.target.value)} />
          </div>
        </div>

        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={shipped} onChange={(e) => setShipped(e.target.checked)} />
            Verzonden
          </label>
          {shipped && (
            <input type="date" value={shippedDate} onChange={(e) => setShippedDate(e.target.value)}
              style={{ marginTop: 6 }} />
          )}
        </div>

        <div className="form-group">
          <label>Notities</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        <div className="form-group">
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Links</span>
            <button type="button" className="btn btn-ghost btn-sm"
              onClick={() => setLinks((l) => [...l, ''])}>+ Link</button>
          </label>
          {links.map((url, i) => (
            <LinkRow key={i} value={url}
              onChange={(v) => setLinks((l) => l.map((x, idx) => idx === i ? v : x))}
              onRemove={() => setLinks((l) => l.filter((_, idx) => idx !== i))} />
          ))}
        </div>

        <div className="form-group">
          <label>Bewijsstuk (betaalbewijs / verzendbon)</label>
          {attachmentPath ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <a href={attachmentUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                📎 Bekijk bestand
              </a>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttachmentPath(null)}>
                × Verwijder koppeling
              </button>
            </div>
          ) : (
            <label
              className="btn btn-secondary btn-sm"
              style={{ cursor: attachmentUploading ? 'default' : 'pointer', opacity: attachmentUploading ? 0.7 : 1, alignSelf: 'flex-start', display: 'inline-flex', width: 'fit-content' }}
            >
              {attachmentUploading ? 'Bezig…' : '⬆ Bestand uploaden'}
              <input
                type="file"
                accept="application/pdf,image/*"
                style={{ display: 'none' }}
                disabled={attachmentUploading}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; handleUploadAttachment(f) }}
              />
            </label>
          )}
        </div>
      </div>
    </Modal>
  )
}
