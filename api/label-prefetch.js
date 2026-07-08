import { cropToLabel } from './label.js';

// Vercel bodyParser kan gewoon aan blijven — dit endpoint ontvangt enkel
// kleine JSON (transaction_id + presigned label_url), geen binaire upload.

// Haalt het ruwe label op, cropt het naar 4×6 (dezelfde logica als /api/label)
// en slaat het resultaat op in Supabase Storage + op het vinted_orders-record,
// zodat het label al klaarstaat voordat de gebruiker naar de Labels-pagina
// gaat i.p.v. pas te croppen op het moment van downloaden.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const { transaction_id, label_url } = req.body || {};
  if (!transaction_id) return res.status(400).json({ error: 'missing transaction_id' });
  if (!label_url)      return res.status(400).json({ error: 'missing label_url' });

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'server misconfigured' });

  try {
    const labelResp = await fetch(label_url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!labelResp.ok) {
      return res.status(labelResp.status).json({ error: `Label fetch mislukt: ${labelResp.status}` });
    }
    const rawBytes = Buffer.from(await labelResp.arrayBuffer());

    // Content-type-header alleen is niet betrouwbaar genoeg — sommige
    // presigned URLs geven bv. gewoon application/octet-stream terug, ook
    // voor een geldige PDF. Controleer daarom ook de magic bytes: dit vangt
    // zowel foute content-types als een 200-OK met een HTML-foutpagina i.p.v.
    // een echt label (bv. een niet-bestaand/nog-niet-klaar label).
    const contentType = labelResp.headers.get('content-type') || '';
    const looksLikePdf = rawBytes.slice(0, 5).toString('latin1') === '%PDF-';
    // Sommige orders (bv. Vinted Go "digitaal label, geen printer nodig")
    // hebben HELEMAAL geen PDF — de presigned URL geeft rechtstreeks een
    // PNG-QR-code terug (live bevestigd op txn 20793680722: de Vinted-inbox
    // toont voor zo'n order geen "Verzendlabel aanmaken"-knop, enkel
    // "Digitaal verzendlabel openen" → een QR-code om te scannen bij het
    // afhaalpunt). Dat is geen fout, geen ontbrekend label — het is het
    // echte, volledige label voor die verzendmethode. Zonder deze tak bleef
    // zo'n order voor altijd "niet beschikbaar" (422) en probeerde de
    // aanroeper zinloos een niet-bestaande knop te klikken.
    const looksLikePng = rawBytes.slice(0, 8).toString('latin1') === '\x89PNG\r\n\x1a\n';
    const looksLikeJpg = rawBytes[0] === 0xff && rawBytes[1] === 0xd8;
    if (!looksLikePdf && !looksLikePng && !looksLikeJpg) {
      console.warn(`[label-prefetch] geen geldige PDF/afbeelding voor txn ${transaction_id} — content-type: "${contentType}", eerste bytes: ${rawBytes.slice(0, 20).toString('latin1')}`);
      return res.status(422).json({ error: `Response is geen geldig label (content-type: ${contentType || 'onbekend'})` });
    }

    const isQrImage = !looksLikePdf;
    const outBytes = isQrImage ? rawBytes : await cropToLabel(rawBytes);
    const ext = isQrImage ? (looksLikePng ? 'png' : 'jpg') : 'pdf';
    const uploadContentType = isQrImage ? (looksLikePng ? 'image/png' : 'image/jpeg') : 'application/pdf';

    // Extensie in het pad (i.p.v. een aparte kolom) is bewust: Labels.jsx
    // herkent een QR-label puur aan de .png/.jpg-extensie van label_pdf_url
    // en toont dan "QR-code tonen" i.p.v. "Download 4×6 label" — geen
    // schema-migratie nodig voor dit onderscheid.
    const path = `${transaction_id}-${isQrImage ? 'qr' : '4x6'}.${ext}`;
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/labels/${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Content-Type': uploadContentType,
        'x-upsert': 'true',
      },
      body: outBytes,
    });
    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      console.error('[label-prefetch] storage upload fout:', uploadRes.status, err);
      return res.status(500).json({ error: `Storage upload mislukt: ${err.slice(0, 200)}` });
    }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/labels/${path}`;

    const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/vinted_orders?id=eq.${encodeURIComponent(transaction_id)}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ label_available: true, label_pdf_url: publicUrl }),
    });
    if (!dbRes.ok) {
      const err = await dbRes.text();
      console.error('[label-prefetch] db update fout:', dbRes.status, err);
      return res.status(500).json({ error: `DB update mislukt: ${err.slice(0, 200)}` });
    }

    return res.status(200).json({ success: true, url: publicUrl });
  } catch (e) {
    console.error('[label-prefetch] fout:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
