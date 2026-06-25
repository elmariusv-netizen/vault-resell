export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-vinted-cookie');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const cookie = req.headers['x-vinted-cookie'];
  if (!cookie) {
    return res.status(401).json({ error: 'x-vinted-cookie header ontbreekt. Koppel eerst je Vinted account in Instellingen.' });
  }

  // Extract CSRF token from the cookie string if present
  const csrfToken = cookie.match(/_vinted_csrf_token=([^;]+)/)?.[1] || '';

  try {
    const vintedRes = await fetch(
      'https://www.vinted.be/api/v2/my_orders?type=sold&status=all&per_page=50',
      {
        headers: {
          'Cookie': cookie,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'nl-BE,nl;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': 'https://www.vinted.be/my_orders',
          'x-csrf-token': csrfToken,
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
        },
      }
    );

    if (!vintedRes.ok) {
      const rawBody = await vintedRes.text();
      console.error('[vinted-orders] status:', vintedRes.status);
      console.error('[vinted-orders] response headers:', JSON.stringify(Object.fromEntries(vintedRes.headers)));
      console.error('[vinted-orders] response body:', rawBody.slice(0, 500));
      console.error('[vinted-orders] cookie preview:', cookie.slice(0, 80));
      console.error('[vinted-orders] csrf found:', !!csrfToken);

      if (vintedRes.status === 401 || vintedRes.status === 403) {
        return res.status(401).json({
          error: 'Sessie verlopen. Kopieer je cookie opnieuw in Instellingen.',
          debug: { status: vintedRes.status, body: rawBody.slice(0, 200) },
        });
      }
      return res.status(vintedRes.status).json({
        error: `Vinted API fout: ${vintedRes.status}`,
        debug: { body: rawBody.slice(0, 200) },
      });
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
