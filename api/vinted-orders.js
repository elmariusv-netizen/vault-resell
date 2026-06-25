export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-vinted-cookie');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const cookie = req.headers['x-vinted-cookie'];
  if (!cookie) {
    return res.status(401).json({ error: 'x-vinted-cookie header ontbreekt. Koppel eerst je Vinted account in Instellingen.' });
  }

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  try {
    const vintedRes = await fetch(
      'https://www.vinted.be/api/v2/my_orders?type=sold&status=all&per_page=50',
      {
        headers: {
          'Cookie': cookie,
          'User-Agent': ua,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'nl-BE,nl;q=0.9,en;q=0.8',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://www.vinted.be/',
        },
      }
    );

    if (!vintedRes.ok) {
      console.error('[vinted-orders] Vinted status:', vintedRes.status);
      if (vintedRes.status === 401 || vintedRes.status === 403) {
        return res.status(401).json({ error: 'Sessie verlopen. Kopieer je cookie opnieuw in Instellingen.' });
      }
      return res.status(vintedRes.status).json({ error: `Vinted API fout: ${vintedRes.status}` });
    }

    const data = await vintedRes.json();
    const raw = data.orders || data.my_orders || [];

    if (raw[0]) {
      console.log('[vinted-orders] eerste order keys:', Object.keys(raw[0]).join(', '));
      console.log('[vinted-orders] transaction_user_status:', raw[0].transaction_user_status);
      console.log('[vinted-orders] status:', raw[0].status);
    }

    // needs_action = koper heeft betaald, verkoper moet label printen & verzenden
    const pending = raw.filter((o) => {
      const txStatus  = (o.transaction_user_status || '').toLowerCase();
      const statusStr = (o.status || '').toLowerCase();
      return (
        txStatus === 'needs_action' ||
        statusStr.includes('verzendlabel') ||
        statusStr.includes('label') ||
        statusStr.includes('ship')
      );
    });

    const orders = pending.map((o) => ({
      id:                      String(o.id),
      transaction_id:          String(o.transaction_id || o.id),
      title:                   o.title || 'Onbekend item',
      price:                   parseFloat(o.price || 0),
      currency:                o.currency || 'EUR',
      photo_url:               o.photo?.url || o.photo?.thumbnail_url || o.image?.url || null,
      buyer:                   o.buyer?.login || o.buyer || '',
      date:                    o.created_at || o.updated_at || null,
      label_url:               o.label_url
                                 || o.shipment?.label_url
                                 || o.transaction?.shipment?.label_url
                                 || null,
      status:                  o.status || '',
      transaction_user_status: o.transaction_user_status || '',
    }));

    console.log(`[vinted-orders] totaal: ${raw.length}, openstaand: ${orders.length}`);
    return res.status(200).json({ orders, total: orders.length });

  } catch (err) {
    console.error('[vinted-orders] fout:', err);
    return res.status(500).json({ error: err.message });
  }
}
