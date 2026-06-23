import { PDFDocument } from 'pdf-lib';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-vinted-cookie');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const transaction_id = req.body?.transaction_id || req.query?.transaction_id;
  const label_url      = req.body?.label_url      || req.query?.label_url;
  const cookie         = req.headers['x-vinted-cookie'];

  // Two paths:
  // A) label_url provided (presigned) — no cookie needed
  // B) transaction_id + cookie — proxy fetches from Vinted with cookie auth
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

  const pdfBytes = await response.arrayBuffer();
  const src = await PDFDocument.load(pdfBytes);
  const out = await PDFDocument.create();
  const [page] = src.getPages();
  const { width: w, height: h } = page.getSize();
  console.log('[label] src size', Math.round(w), 'x', Math.round(h));

  // Crop top half of A4 → 4×6 thermal (288×432pt)
  const embedded = await out.embedPage(page, { left: 0, bottom: h * 0.5, right: w, top: h });
  const newPage  = out.addPage([288, 432]);
  newPage.drawPage(embedded, { x: 0, y: 0, width: 288, height: 432 });

  const cropped = await out.save();
  const ref = transaction_id || 'label';
  console.log('[label] cropped', cropped.length, 'bytes, ref:', ref);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="label-${ref}-4x6.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(Buffer.from(cropped));
}
