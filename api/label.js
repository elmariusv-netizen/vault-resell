import { PDFDocument } from 'pdf-lib';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-vinted-cookie');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const transaction_id = req.body?.transaction_id || req.query?.transaction_id;
  const cookie = req.headers['x-vinted-cookie'];

  if (!transaction_id) return res.status(400).json({ error: 'transaction_id vereist' });
  if (!cookie)         return res.status(401).json({ error: 'x-vinted-cookie header vereist' });

  const response = await fetch(
    `https://www.vinted.be/api/v2/transactions/${transaction_id}/shipment/pdf_label`,
    { headers: { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0' } }
  );

  if (!response.ok) {
    console.error('[label] Vinted status', response.status, 'txn', transaction_id);
    return res.status(response.status).json({ error: 'Label fetch failed' });
  }

  const pdfBytes = await response.arrayBuffer();

  const src = await PDFDocument.load(pdfBytes);
  const out = await PDFDocument.create();
  const [page] = src.getPages();
  const { width: w, height: h } = page.getSize();
  console.log('[label] src size', Math.round(w), 'x', Math.round(h), 'txn', transaction_id);

  const embedded = await out.embedPage(page, { left: 0, bottom: h * 0.5, right: w, top: h });
  const newPage = out.addPage([288, 432]);
  newPage.drawPage(embedded, { x: 0, y: 0, width: 288, height: 432 });

  const cropped = await out.save();
  console.log('[label] cropped', cropped.length, 'bytes, txn', transaction_id);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="label-${transaction_id}-4x6.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(Buffer.from(cropped));
}
