import { useState, useEffect, useRef } from 'react'
import { supabase } from '../utils/supabase'
import { genId, getBatchUnitCost, findBatchForSku } from '../utils/skuUtils'

export async function fetchAllVintedOrders() {
  const { data, error } = await supabase
    .from('vinted_orders')
    .select('*')
  if (error) { console.warn('[Vault] Supabase fetch error:', error); return [] }
  // Sorteer op sale_date (val terug op synced_at als die ontbreekt), nieuwste eerst.
  return (data || []).sort((a, b) => {
    const da = a.sale_date || a.synced_at || ''
    const db = b.sale_date || b.synced_at || ''
    return db.localeCompare(da)
  })
}

// vtOrders-fetch + auto-registratie (vinted_orders -> data.sales), app-breed
// i.p.v. gescopet aan de Verkopen-pagina — voorheen leefde dit als een
// useEffect binnenin Verkopen.jsx, dus draaide de registratie ENKEL als die
// pagina daadwerkelijk gemount werd. Home.jsx leest uitsluitend data.sales,
// nooit vinted_orders rechtstreeks, dus een verse Vinted-verkoop bleef
// onzichtbaar op het Dashboard totdat de gebruiker toevallig ook de
// Verkopen-pagina bezocht. App.jsx roept deze hook 1x aan (altijd gemount,
// ongeacht welke pagina actief is), zodat registratie voortaan gebeurt
// ongeacht welke pagina de gebruiker als eerste opent na een sync.
export function useVintedOrdersSync(data, updateData) {
  // data is nog null vlak na app-start (vóór de cloud-load klaar is) — App.jsx
  // roept deze hook onvoorwaardelijk aan (React-hookregels), dus vóór elke
  // conditionele "nog aan het laden"-return. batches/sales vallen dan terug op
  // een lege array; de auto-registratie-effect hieronder doet dan simpelweg
  // niets totdat de echte data binnen is (sales/batches komt dan in de deps-
  // array terecht en de effect draait opnieuw).
  const { batches = [], sales = [] } = data || {}
  const [vtOrders, setVtOrders] = useState([])
  const [vtLoading, setVtLoading] = useState(true)
  const [vtError, setVtError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchAllVintedOrders().then(rows => {
      if (cancelled) return
      // \d{1,6} i.p.v. \d{3,6}: SKU's krijgen sinds de migratie geen
      // voorloopnullen meer (RIA20 i.p.v. RIA020).
      const SKU_RE = /\b([A-Z]{2,4}\d{1,6})\b/
      const enriched = rows.map(row => {
        if (!row.sku_ref && row.description) {
          const m = row.description.match(SKU_RE)
          if (m) {
            supabase.from('vinted_orders').update({ sku_ref: m[1] }).eq('id', row.id)
            return { ...row, sku_ref: m[1] }
          }
        }
        return row
      })
      setVtOrders(enriched)
      setVtLoading(false)
    }).catch(e => { if (!cancelled) { setVtError(e.message); setVtLoading(false) } })
    return () => { cancelled = true }
  }, [])

  // Auto-registratie: zonder dit bleef een verse Vinted-verkoop onzichtbaar
  // voor het Dashboard totdat iemand handmatig op "+ Empl." klikte. Elke
  // niet-geannuleerde verkooporder krijgt hier meteen een data.sales-entry
  // met de echte sale_date/sold_at, óók zonder gekoppelde SKU/batch (batchId
  // dan null -> €0 kostprijs, zie getBatchUnitCost). COGS kan later alsnog
  // via "SKU koppelen" aangevuld worden; dat vervangt deze entry (zie
  // handleBulkSkuConfirm in Verkopen.jsx) zodat er nooit dubbel geteld wordt.
  //
  // autoRegisterSeenRef: React 18 StrictMode (dev) voert effects 2x uit met
  // dezelfde stale sales/vtOrders-closure — zonder deze ref-guard zou de 2e
  // uitvoering dezelfde orders nog een keer proberen te registreren vóórdat
  // de eerste update is doorgerenderd. Refs overleven StrictMode's dubbele
  // invocatie (in tegenstelling tot de closure-waarden), dus dit sluit de
  // race definitief.
  const autoRegisterSeenRef = useRef(new Set())
  useEffect(() => {
    // data nog null (app-start): sales/batches zijn dan de lege-array-
    // fallback hierboven, niet de echte staat — niets registreren tot de
    // echte data binnen is, anders zou elke vtOrder hier als "nieuw" gezien
    // worden en dubbel/overschrijvend geregistreerd worden zodra de echte
    // sales-lijst alsnog laadt.
    if (!data) return
    const registeredOrderIds = new Set(sales.map(s => s.vintedOrderId).filter(Boolean))
    const eligible = (o) =>
      !autoRegisterSeenRef.current.has(o.id) &&
      !/geannuleerd|cancel/i.test(o.status || '') &&
      (o.order_direction === 'sale' || !o.order_direction)

    // LET OP: baseert zich bewust NIET (meer) op !o.registered_in_vault —
    // enkel op "bestaat er al een data.sales-entry voor deze order". Bug
    // (bevestigd live, 2026-07-11): de updateData(...)-call hieronder en de
    // registered_in_vault:true-write naar Supabase zijn 2 losse, niet-
    // atomaire operaties (zie ook handleSaleModalSave in Verkopen.jsx, zelfde
    // patroon) — als de sales-array-write faalt/wordt ingehaald door een
    // andere gelijktijdige updateData()-call terwijl de vlag-write wél
    // slaagt, blijft een order permanent "registered_in_vault=true" zonder
    // ooit een sales-entry te krijgen. Met de oude `!o.registered_in_vault`-
    // voorwaarde werd zo'n order NOOIT meer opnieuw opgepikt (voor altijd
    // onzichtbaar in omzet/telling) — nu wordt elke order zonder sales-entry
    // altijd opnieuw geregistreerd, ongeacht de vlag.
    const toRegister = vtOrders.filter(o =>
      !registeredOrderIds.has(o.id) && eligible(o)
    )
    // Zelfherstel: order heeft al een data.sales-entry (bv. via "+ Empl.",
    // of een eerdere auto-registratie waarvan de Supabase-update werd
    // onderbroken) maar registered_in_vault staat nog op false — enkel de
    // vlag bijwerken, geen nieuwe (dubbele) sales-entry aanmaken.
    const toReconcile = vtOrders.filter(o =>
      !o.registered_in_vault && registeredOrderIds.has(o.id) && eligible(o)
    )
    if (!toRegister.length && !toReconcile.length) return

    toRegister.forEach(o => autoRegisterSeenRef.current.add(o.id))
    toReconcile.forEach(o => autoRegisterSeenRef.current.add(o.id))

    // Als de order al een batch_id heeft (handmatig gekoppeld, of al eerder
    // gedetecteerd) gebruiken we die. Anders proberen we sku_ref (bv. door de
    // extensie gedetecteerd bij sync, zie content.js) te herleiden naar een
    // bestaande batch via findBatchForSku — dezelfde matching-logica als
    // elders in de app, geen aparte implementatie. Bundel-sku_ref's (met een
    // komma) slaan we hier over: die lopen via BulkSkuModal/handleBulkSkuConfirm.
    const vtOrderPatches = {}
    const resolveBatch = (order) => {
      if (order.batch_id && !order.batch_id.includes(',')) {
        // Order heeft al een batch_id (bv. eerder gekoppeld, of net hersteld
        // via toReconcile hieronder) — toch in vtOrderPatches zetten, anders
        // slaat de patchedSales-stap verderop deze order over en blijft de
        // bijhorende sales-entry op batchId:null staan (telt dan nooit mee
        // in getRemainingQty/"X verkocht" voor die batch, ook al is de order
        // wél degelijk gekoppeld — dit was de oorzaak van een structureel
        // te lage verkocht-telling voor sommige batches).
        vtOrderPatches[order.id] = { batch_id: order.batch_id, cost_price: order.cost_price ?? null }
        return { batchId: order.batch_id, costPrice: order.cost_price ?? null }
      }
      if (order.sku_ref && !order.sku_ref.includes(',')) {
        const batch = findBatchForSku(batches, order.sku_ref)
        if (batch) {
          const costPrice = getBatchUnitCost(batch)
          vtOrderPatches[order.id] = { batch_id: batch.id, cost_price: costPrice }
          return { batchId: batch.id, costPrice }
        }
      }
      return { batchId: null, costPrice: null }
    }

    const newSales = toRegister.map(order => {
      let photo = order.photo_url || null
      try { photo = JSON.parse(order.photo_urls || '[]')[0] || photo } catch { /* val terug op photo_url */ }
      const { batchId } = resolveBatch(order)
      return {
        id: genId(),
        vintedOrderId: order.id,
        batchId,
        type: 'individual',
        quantity: 1,
        salePrice: parseFloat(order.price || 0),
        platform: 'Vinted',
        buyer: order.buyer_name || order.buyer || '',
        fees: 0,
        shippingCost: 0,
        notes: order.transaction_id ? `Vinted #${order.transaction_id}` : '',
        date: order.sale_date || order.synced_at?.split('T')[0] || new Date().toISOString().split('T')[0],
        fromLive: false,
        photo,
        links: [],
        shipped: false,
        shippedDate: null,
        isFree: false,
        saleTime: order.sold_at ? order.sold_at.split('T')[1]?.slice(0, 5) : null,
      }
    })
    // toReconcile-orders hebben al een data.sales-entry maar kunnen ook nog
    // een niet-herleide sku_ref hebben (bv. handmatig "+ Empl." geklikt vóór
    // de batch gekoppeld was) — ook daarvoor proberen we de batch te vinden,
    // en de bestaande sales-entry bijwerken zodat COGS/profit meteen kloppen.
    toReconcile.forEach(resolveBatch)

    // Achteraf-herkoppeling — niet beperkt tot toReconcile (registered_in_
    // vault=false): een sales-entry kan ook blijvend op batchId:null blijven
    // staan als de gekoppelde vinted_orders-rij PAS NA de auto-registratie
    // alsnog een sku_ref/batch_id kreeg (bv. de eerder kapotte SKU-detectie in
    // de extensie — zie detectSkuForOrder — of een latere handmatige koppeling
    // rechtstreeks op de order). Zo'n order komt nooit meer in toRegister/
    // toReconcile terecht zodra registered_in_vault=true, dus zonder deze
    // aparte pas bleef die sales-entry voorgoed buiten "X verkocht" voor de
    // juiste batch tellen — dit was de structurele oorzaak van een te lage
    // verkocht-telling naast het al gefixte geval in resolveBatch hierboven.
    const vtById = new Map(vtOrders.map(o => [o.id, o]))
    sales.forEach(s => {
      if (s.batchId || !s.vintedOrderId) return
      const order = vtById.get(s.vintedOrderId)
      if (order) resolveBatch(order)
    })

    const idsToFlag = [...toRegister, ...toReconcile].map(o => o.id)
    const updates = {}
    if (newSales.length || Object.keys(vtOrderPatches).length) {
      const patchedSales = sales.map(s =>
        s.vintedOrderId && vtOrderPatches[s.vintedOrderId] && !s.batchId
          ? { ...s, batchId: vtOrderPatches[s.vintedOrderId].batch_id }
          : s
      )
      updates.sales = newSales.length ? [...patchedSales, ...newSales] : patchedSales
    }
    if (Object.keys(updates).length) updateData(updates)

    supabase.from('vinted_orders').update({ registered_in_vault: true }).in('id', idsToFlag)
      .then(({ error }) => { if (error) console.warn('[Vault] registered_in_vault wegschrijven mislukt:', error.message, idsToFlag) })
    Object.entries(vtOrderPatches).forEach(([orderId, patch]) => {
      supabase.from('vinted_orders').update(patch).eq('id', orderId)
        .then(({ error }) => { if (error) console.warn('[Vault] batch_id/cost_price wegschrijven mislukt voor order', orderId, ':', error.message) })
    })
    setVtOrders(prev => prev.map(o => {
      if (!idsToFlag.includes(o.id) && !vtOrderPatches[o.id]) return o
      return { ...o, ...(idsToFlag.includes(o.id) ? { registered_in_vault: true } : {}), ...(vtOrderPatches[o.id] || {}) }
    }))
  }, [data, vtOrders, sales, batches, updateData])

  return { vtOrders, setVtOrders, vtLoading, vtError }
}
