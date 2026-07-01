import { PDFDocument, PDFName } from 'pdf-lib';
import { inflateSync } from 'zlib';

// Vercel's standaard body parser verminkt ruwe binary PDF-bytes bij een POST met
// Content-Type: application/pdf. We lezen de body daarom altijd zelf in via de stream.
export const config = {
  api: {
    bodyParser: false,
  },
};

const LABEL_W = 288;  // 4 inch × 72 pt/inch
const LABEL_H = 432;  // 6 inch × 72 pt/inch

// Decompress a PDF stream object (handles FlateDecode)
function decodeStreamObj(obj) {
  try {
    if (!obj || !(obj.contents instanceof Uint8Array)) return null;
    const filter = obj.dict?.get(PDFName.of('Filter'));
    if (!filter) return obj.contents;
    const fname = filter.toString?.() ?? '';
    if (fname === '/FlateDecode' || fname === 'FlateDecode') {
      return inflateSync(Buffer.from(obj.contents));
    }
    // Uncompressed or unknown filter — return raw
    return obj.contents;
  } catch { return null; }
}

// Extract all 're' (rectangle) operators from decoded content stream bytes
// PDF syntax: x y w h re
function parseRects(bytes, pageW, pageH) {
  if (!bytes) return [];
  try {
    const text = Buffer.from(bytes).toString('binary');
    const re = /(-?[\d]+(?:\.[\d]+)?)\s+(-?[\d]+(?:\.[\d]+)?)\s+(-?[\d]+(?:\.[\d]+)?)\s+(-?[\d]+(?:\.[\d]+)?)\s+re\b/g;
    const rects = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      const x = +m[1], y = +m[2], rw = +m[3], rh = +m[4];
      const aw = Math.abs(rw), ah = Math.abs(rh);
      // Alleen kandidaten > 200x200pt en < 98% van de pagina (negeer barcodes, lijnen, volledige pagina)
      if (aw > 200 && ah > 200 && aw < pageW * 0.98 && ah < pageH * 0.98) {
        rects.push({
          left:   rw >= 0 ? x : x + rw,
          bottom: rh >= 0 ? y : y + rh,
          right:  rw >= 0 ? x + rw : x,
          top:    rh >= 0 ? y + rh : y,
        });
      }
    }
    return rects;
  } catch { return []; }
}

// Zoek de grootste rechthoek-operator (`re`) in de content streams van de pagina.
// Retourneert null als er geen bruikbare kandidaat gevonden wordt.
function findLargestContentRect(src, page, pageW, pageH) {
  try {
    const pageNode = page.node;
    const context  = src.context;
    const contentsRef = pageNode.get(PDFName.of('Contents'));
    if (!contentsRef) return null;

    const contentsObj = context.lookup(contentsRef);
    const streamObjs = [];

    // Contents can be a single stream or an array of streams
    if (contentsObj && typeof contentsObj.asArray === 'function') {
      for (const ref of contentsObj.asArray()) {
        const s = context.lookup(ref);
        if (s) streamObjs.push(s);
      }
    } else if (contentsObj) {
      streamObjs.push(contentsObj);
    }

    let allRects = [];
    for (const streamObj of streamObjs) {
      const bytes = decodeStreamObj(streamObj);
      allRects = allRects.concat(parseRects(bytes, pageW, pageH));
    }
    if (!allRects.length) return null;

    // Pick de grootste rechthoek — meest waarschijnlijk het labelkader
    allRects.sort((a, b) => {
      const aA = (a.right - a.left) * (a.top - a.bottom);
      const aB = (b.right - b.left) * (b.top - b.bottom);
      return aB - aA;
    });
    return allRects[0];
  } catch (e) {
    console.warn('[label] content stream parse error:', e.message);
    return null;
  }
}

// Detect the label crop region within a PDF page
// Returns { left, bottom, right, top, rotate } in PDF points (origin bottom-left).
// `rotate` is true ONLY when the label content itself is physically rotated 90°
// within the source page (confirmed on a real Mondial Relay label) — it must NOT
// be derived from the crop box's own aspect ratio, since e.g. Bpost's crop box is
// landscape-shaped too even though that content is already upright.
//
// Carrier-specifieke aanpak (gebaseerd op geanalyseerde echte labels):
//  - Mondial Relay: A4 portrait, label (gedraaid) in de onderste helft
//  - Vinted Go:     klein formaat (geen A4), label + zwarte header bovenaan
//  - Bpost:         A4 landscape, label linksboven kwadrant (niet gedraaid)
//  - PostNL:        A4 portrait, label met kader bovenaan
export async function detectLabelBounds(src, page) {
  const media  = page.getMediaBox();
  const pageW  = media.width;
  const pageH  = media.height;

  console.log('[label] mediaBox:', Math.round(pageW), 'x', Math.round(pageH));

  // Stap 1: zoek de grootste rechthoek in de content streams (labelkader)
  const rect = findLargestContentRect(src, page, pageW, pageH);

  if (rect) {
    const margin = 3;
    const bounds = {
      left:   Math.max(0, rect.left - margin),
      bottom: Math.max(0, rect.bottom - margin),
      right:  Math.min(pageW, rect.right + margin),
      top:    Math.min(pageH, rect.top + margin),
    };
    const rw = bounds.right - bounds.left, rh = bounds.top - bounds.bottom;
    const centerY = (bounds.top + bounds.bottom) / 2;

    if (centerY < pageH / 2) {
      bounds.rotate = true;
      console.log(`[label] content-rect in onderste helft → Mondial Relay (gedraaid): left=${bounds.left.toFixed(0)} bottom=${bounds.bottom.toFixed(0)} right=${bounds.right.toFixed(0)} top=${bounds.top.toFixed(0)} (${rw.toFixed(0)}x${rh.toFixed(0)})`);
    } else {
      bounds.rotate = false;
      console.log(`[label] content-rect in bovenste helft → PostNL: left=${bounds.left.toFixed(0)} bottom=${bounds.bottom.toFixed(0)} right=${bounds.right.toFixed(0)} top=${bounds.top.toFixed(0)} (${rw.toFixed(0)}x${rh.toFixed(0)})`);
    }
    return bounds;
  }

  console.log('[label] geen bruikbare content-rechthoek gevonden — val terug op pagina-heuristiek');

  // Stap 2a: Bpost — A4 landscape (breder dan hoog), label linksboven kwadrant.
  // Moet vóór de Vinted Go-check komen: A4 landscape (842x595) heeft ook hoogte < 700.
  // De inhoud zelf staat rechtop (niet gedraaid) — enkel de crop-box is landscape-vormig.
  if (pageW > pageH) {
    const bounds = { left: 0, bottom: pageH * 0.45, right: pageW * 0.55, top: pageH, rotate: false };
    console.log(`[label] heuristic Bpost (landscape ${Math.round(pageW)}x${Math.round(pageH)}, niet gedraaid): left=0 bottom=${bounds.bottom.toFixed(0)} right=${bounds.right.toFixed(0)} top=${bounds.top.toFixed(0)}`);
    return bounds;
  }

  // Stap 2b: Vinted Go — klein formaat (geen A4), label + zwarte header bovenaan.
  // Het label neemt maar ~35-40% van de paginahoogte in, dus bovenste 40% behouden
  // (bottom=0 is onderaan in PDF-coördinaten, dus bottom = pageH * 0.6 → bovenste 40%).
  if (pageH < 700) {
    const bottom = pageH * 0.6;
    console.log(`[label] heuristic Vinted Go (${Math.round(pageW)}x${Math.round(pageH)}): bovenste 40% → bottom=${bottom.toFixed(0)}`);
    return { left: 0, bottom, right: pageW, top: pageH, rotate: false };
  }

  // Onbekend formaat — geen enkele carrier-heuristiek matcht, gebruik de volledige pagina
  console.log('[label] geen carrier-match — volledige pagina als crop');
  return { left: 0, bottom: 0, right: pageW, top: pageH, rotate: false };
}

// Crop ruwe PDF-bytes (welke bron dan ook) naar een exacte 4×6 (288×432pt) label-PDF.
//
// Aanpak: embed de VOLLEDIGE bronpagina (geen crop-parameters aan embedPage),
// en vergroot/verschuif die dan via drawPage() zodat enkel de gedetecteerde
// label-zone wordt uitvergroot naar de volledige 288×432 doelpagina. Alles
// buiten de doelpagina wordt door de output-pagina zelf niet weergegeven —
// er is dus geen aparte clip/crop-stap nodig.
export async function cropToLabel(pdfBytes) {
  const src  = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const page = src.getPages()[0];

  const { width: pageW, height: pageH } = page.getSize();
  const rotation = page.getRotation().angle;
  console.log('[label] page size:', Math.round(pageW), 'x', Math.round(pageH), 'rotation:', rotation);

  const out = await PDFDocument.create();

  // Let op: een pagina die toevallig al 288×432pt groot is, betekent niet dat de
  // inhoud ook al de volledige pagina vult (bv. een echt Vinted Go-label dat al op
  // 4×6 geëxporteerd is, maar waarvan de content maar de bovenste ~40% inneemt).
  // Daarom draait ALLE input door dezelfde detectie + overscale-pipeline.

  // Detecteer de label-zone (left,bottom,right,top) in bron-coördinaten
  const bounds = await detectLabelBounds(src, page);
  const cropW = bounds.right - bounds.left;
  const cropH = bounds.top  - bounds.bottom;
  console.log(`[label] FINAL BOUNDS gebruikt: left=${bounds.left.toFixed(1)} bottom=${bounds.bottom.toFixed(1)} right=${bounds.right.toFixed(1)} top=${bounds.top.toFixed(1)} → crop ${cropW.toFixed(1)}x${cropH.toFixed(1)}`);

  // Embed de VOLLEDIGE pagina zonder crop-parameters
  const embedded = await out.embedPage(page);
  const newPage  = out.addPage([LABEL_W, LABEL_H]);

  // Rotatie is een carrier-beslissing (Mondial Relay), NIET afgeleid van de
  // vorm van de crop-box — Bpost's crop-box is bv. ook landscape-vormig terwijl
  // die inhoud al rechtop staat.
  if (bounds.rotate) {
    // Roteer +90° en vergroot de (landscape) label-zone naar de volledige 4×6.
    // Na rotatie wisselen breedte/hoogte: de bron-breedte-as wordt de visuele
    // hoogte (LABEL_H) en de bron-hoogte-as wordt de visuele breedte (LABEL_W).
    // (Met -90° stond de inhoud 180° op zijn kop — geverifieerd op een echt
    // Mondial Relay-label; +90° is de juiste, rechtopstaande richting.)
    const xScale = LABEL_H / cropW;
    const yScale = LABEL_W / cropH;
    const x      = bounds.top  * yScale;
    const y      = -bounds.left * xScale;
    const width  = xScale * pageW;
    const height = yScale * pageH;
    console.log(`[label] rotate +90° + overscale: xScale=${xScale.toFixed(3)} yScale=${yScale.toFixed(3)} x=${x.toFixed(1)} y=${y.toFixed(1)} width=${width.toFixed(1)} height=${height.toFixed(1)}`);
    newPage.drawPage(embedded, { x, y, width, height, rotate: { type: 'degrees', angle: 90 } });
  } else {
    // Vergroot de (portrait) label-zone naar de volledige 4×6, geen rotatie.
    const scaleX = LABEL_W / cropW;
    const scaleY = LABEL_H / cropH;
    const x      = -bounds.left   * scaleX;
    const y      = -bounds.bottom * scaleY;
    const width  = scaleX * pageW;
    const height = scaleY * pageH;
    console.log(`[label] overscale: scaleX=${scaleX.toFixed(3)} scaleY=${scaleY.toFixed(3)} x=${x.toFixed(1)} y=${y.toFixed(1)} width=${width.toFixed(1)} height=${height.toFixed(1)}`);
    newPage.drawPage(embedded, { x, y, width, height });
  }

  const cropped = await out.save();
  console.log('[label] output', cropped.length, 'bytes');
  return Buffer.from(cropped);
}

// Lees de ruwe request body zelf in — nodig omdat bodyParser hierboven is uitgeschakeld
async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Zoek de opgeslagen Vinted-cookie op via de owner van de order (vinted_orders.owner_id → user_settings.vinted_cookie)
async function lookupVintedCookie(transactionId) {
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY || !transactionId) return null;

  const hdrs = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  try {
    const orderRes = await fetch(
      `${SUPABASE_URL}/rest/v1/vinted_orders?transaction_id=eq.${encodeURIComponent(transactionId)}&select=owner_id&limit=1`,
      { headers: hdrs }
    );
    if (!orderRes.ok) return null;
    const [orderRow] = await orderRes.json();
    if (!orderRow?.owner_id) return null;

    const settingsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${encodeURIComponent(orderRow.owner_id)}&select=vinted_cookie&limit=1`,
      { headers: hdrs }
    );
    if (!settingsRes.ok) return null;
    const [settingsRow] = await settingsRes.json();
    return settingsRow?.vinted_cookie || null;
  } catch (e) {
    console.warn('[label] lookupVintedCookie fout:', e.message);
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-vinted-cookie');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const contentType = req.headers['content-type'] || '';

  // bodyParser staat uit, dus we lezen de raw body zelf in (leeg voor GET-requests
  // die enkel query-params gebruiken). req.query blijft door Vercel zelf gevuld.
  const rawBody = req.method === 'POST' ? await readRawBody(req) : null;

  // Pad 3: handmatig geüploade PDF — binary body, geen transaction_id/label_url
  if (contentType.includes('application/pdf')) {
    try {
      if (!rawBody?.length) {
        return res.status(400).json({ error: 'lege PDF-body' });
      }
      console.log('[label] handmatige upload:', rawBody.length, 'bytes');
      const cropped = await cropToLabel(rawBody);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="label-manual-4x6.pdf"');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(cropped);
    } catch (e) {
      console.error('[label] handmatige upload fout:', e.message);
      return res.status(500).json({ error: `Croppen mislukt: ${e.message}` });
    }
  }

  // JSON-body handmatig parsen (bodyParser staat uit voor alle content-types)
  let jsonBody = {};
  if (rawBody?.length && contentType.includes('application/json')) {
    try { jsonBody = JSON.parse(rawBody.toString('utf8')); } catch (e) {
      console.warn('[label] JSON body parse fout:', e.message);
    }
  }

  const transaction_id = jsonBody.transaction_id || req.query?.transaction_id;
  const label_url      = jsonBody.label_url      || req.query?.label_url;
  let cookie            = req.headers['x-vinted-cookie'];

  if (!cookie && transaction_id && !label_url) {
    cookie = await lookupVintedCookie(transaction_id);
    if (cookie) console.log('[label] cookie automatisch opgehaald uit user_settings voor txn', transaction_id);
  }

  let pdfFetchUrl, fetchOptions;

  if (label_url) {
    pdfFetchUrl  = label_url;
    fetchOptions = { headers: { 'User-Agent': 'Mozilla/5.0' } };
    console.log('[label] presigned URL path:', label_url.slice(0, 80));
  } else if (transaction_id && cookie) {
    pdfFetchUrl  = `https://www.vinted.be/api/v2/transactions/${transaction_id}/shipment/pdf_label`;
    fetchOptions = { headers: { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0' } };
    console.log('[label] cookie path, txn:', transaction_id);
  } else {
    return res.status(400).json({ error: 'label_url of (transaction_id + x-vinted-cookie) vereist' });
  }

  const response = await fetch(pdfFetchUrl, fetchOptions);
  if (!response.ok) {
    console.error('[label] fetch status', response.status, 'url:', pdfFetchUrl.slice(0, 80));
    return res.status(response.status).json({ error: `Label fetch mislukt: ${response.status}` });
  }

  const pdfBytes = Buffer.from(await response.arrayBuffer());
  const cropped  = await cropToLabel(pdfBytes);
  const ref = transaction_id || 'label';

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="label-${ref}-4x6.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(cropped);
}
