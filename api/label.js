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

// Haal de gedecodeerde content-stream tekst van een pagina op (kan uit meerdere
// streams bestaan). Retourneert null als er geen Contents-entry is.
function getPageContentText(src, page) {
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

    let text = '';
    for (const streamObj of streamObjs) {
      const bytes = decodeStreamObj(streamObj);
      if (bytes) text += Buffer.from(bytes).toString('binary');
    }
    return text || null;
  } catch (e) {
    console.warn('[label] content stream parse error:', e.message);
    return null;
  }
}

// Zoek de grootste rechthoek-operator (`re`) in de content streams van de pagina.
// Retourneert null als er geen bruikbare kandidaat gevonden wordt.
function findLargestContentRect(src, page, pageW, pageH) {
  const text = getPageContentText(src, page);
  if (!text) return null;
  const allRects = parseRects(Buffer.from(text, 'binary'), pageW, pageH);
  if (!allRects.length) return null;

  // Pick de grootste rechthoek — meest waarschijnlijk het labelkader
  allRects.sort((a, b) => {
    const aA = (a.right - a.left) * (a.top - a.bottom);
    const aB = (b.right - b.left) * (b.top - b.bottom);
    return aB - aA;
  });
  return allRects[0];
}

// Zoek de bounding box van alle gestreepte lijn-tekeningen (m ... l ... S) in
// de content-stream van de pagina — sommige carriers (bv. DPD) tekenen hun
// label-tabel als losse lijnsegmenten i.p.v. een 're'-rechthoek, dus die
// worden door findLargestContentRect gemist. Enkel bruikbaar op het
// top-level (niet binnen een cm-getransformeerd blok) content-stream, wat
// voor de geanalyseerde echte bestanden klopt.
function extractLineArtBounds(text) {
  if (!text) return null;
  try {
    const tokenRe = /(-?[\d.]+)\s+(-?[\d.]+)\s+m\b|(-?[\d.]+)\s+(-?[\d.]+)\s+l\b|\bS\b/g;
    let points = [];
    let bounds = null;
    let m;
    const flush = () => {
      if (points.length >= 2) {
        const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
        const left = Math.min(...xs), right = Math.max(...xs);
        const bottom = Math.min(...ys), top = Math.max(...ys);
        if (!bounds) {
          bounds = { left, bottom, right, top };
        } else {
          bounds.left   = Math.min(bounds.left, left);
          bounds.right  = Math.max(bounds.right, right);
          bounds.bottom = Math.min(bounds.bottom, bottom);
          bounds.top    = Math.max(bounds.top, top);
        }
      }
      points = [];
    };
    while ((m = tokenRe.exec(text)) !== null) {
      if (m[0] === 'S') { flush(); continue; }
      if (m[1] !== undefined) { points.push([+m[1], +m[2]]); continue; }
      if (m[3] !== undefined) { points.push([+m[3], +m[4]]); continue; }
    }
    return bounds;
  } catch (e) {
    console.warn('[label] extractLineArtBounds fout:', e.message);
    return null;
  }
}

function findLineArtBounds(src, page) {
  const text = getPageContentText(src, page);
  return text ? extractLineArtBounds(text) : null;
}

// Multiply 2D affine PDF matrices: applies `cm` (nieuw) NA `base` (bestaande CTM)
function multiplyMatrix(base, cm) {
  const [a0, b0, c0, d0, e0, f0] = base;
  const [a, b, c, d, e, f] = cm;
  return [
    a * a0 + b * c0, a * b0 + b * d0,
    c * a0 + d * c0, c * b0 + d * d0,
    e * a0 + f * c0 + e0, e * b0 + f * d0 + f0,
  ];
}

// Detecteer of de pagina simpelweg één ingebedde Form XObject tekent (typisch
// resultaat van een eerdere embedPdf/embedPage + drawPage-bewerking zonder
// crop). Retourneert de naam van de XObject en de samengestelde CTM op het
// moment van de `Do`-operator, of null als er geen enkele Form-XObject-oproep
// gevonden wordt.
function findWrappedFormXObjectRef(text) {
  try {
    const tokenRe = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+cm\b|\/(\S+)\s+Do\b|\bq\b|\bQ\b/g;
    let stack = [[1, 0, 0, 1, 0, 0]];
    let m;
    while ((m = tokenRe.exec(text)) !== null) {
      if (m[0] === 'q') { stack.push(stack[stack.length - 1].slice()); continue; }
      if (m[0] === 'Q') { if (stack.length > 1) stack.pop(); continue; }
      if (m[7] !== undefined) return { name: m[7], ctm: stack[stack.length - 1].slice() };
      const cm = [+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]];
      stack[stack.length - 1] = multiplyMatrix(stack[stack.length - 1], cm);
    }
    return null;
  } catch (e) {
    console.warn('[label] findWrappedFormXObjectRef fout:', e.message);
    return null;
  }
}

// Als de pagina niets anders doet dan één ingebedde Form XObject tekenen (een
// "domme" volledige-pagina-embed zonder crop), lever dan diens eigen BBox en
// content-bytes plus de CTM om terug naar pagina-coördinaten te mappen.
function unwrapFormXObject(src, page) {
  try {
    const pageNode = page.node;
    const context  = src.context;
    const contentsRef = pageNode.get(PDFName.of('Contents'));
    if (!contentsRef) return null;
    const contentsObj = context.lookup(contentsRef);
    const streamObjs = [];
    if (contentsObj && typeof contentsObj.asArray === 'function') {
      for (const ref of contentsObj.asArray()) {
        const s = context.lookup(ref);
        if (s) streamObjs.push(s);
      }
    } else if (contentsObj) {
      streamObjs.push(contentsObj);
    }
    if (streamObjs.length !== 1) return null;

    const bytes = decodeStreamObj(streamObjs[0]);
    if (!bytes) return null;
    const text = Buffer.from(bytes).toString('binary');

    const found = findWrappedFormXObjectRef(text);
    if (!found) return null;

    const resourcesRef = pageNode.get(PDFName.of('Resources'));
    const resources    = resourcesRef && context.lookup(resourcesRef);
    const xobjectsRef  = resources?.get(PDFName.of('XObject'));
    const xobjects     = xobjectsRef && context.lookup(xobjectsRef);
    const xref         = xobjects?.get(PDFName.of(found.name));
    const xobj         = xref && context.lookup(xref);
    if (!xobj || xobj.dict?.get(PDFName.of('Subtype'))?.toString() !== '/Form') return null;

    const bboxRef = xobj.dict.get(PDFName.of('BBox'));
    const bboxArr = bboxRef && context.lookup(bboxRef);
    if (!bboxArr) return null;
    const nums = [0, 1, 2, 3].map((i) => {
      const item = bboxArr.get(i);
      return item.asNumber ? item.asNumber() : item.numberValue;
    });
    if (nums.some((n) => n == null || isNaN(n))) return null;
    const [bx1, by1, bx2, by2] = nums;

    return {
      vw: Math.abs(bx2 - bx1),
      vh: Math.abs(by2 - by1),
      ctm: found.ctm,
      xobjBytes: decodeStreamObj(xobj),
    };
  } catch (e) {
    console.warn('[label] unwrapFormXObject fout:', e.message);
    return null;
  }
}

// Map een bounds-object (in de coördinaten van de ingebedde XObject) terug naar
// pagina-coördinaten via de CTM.
function mapBoundsThroughCtm(bounds, ctm, pageW, pageH) {
  const [a, b, c, d, e, f] = ctm;
  const corners = [
    [bounds.left, bounds.bottom],
    [bounds.right, bounds.top],
  ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
  return {
    left:   Math.max(0, Math.min(...xs)),
    right:  Math.min(pageW, Math.max(...xs)),
    bottom: Math.max(0, Math.min(...ys)),
    top:    Math.min(pageH, Math.max(...ys)),
  };
}

// Detect the label crop region within a PDF page
// Returns { left, bottom, right, top, rotate } in PDF points (origin bottom-left).
// `rotate` is 0, 90 or -90 degrees — the exact rotation the CONTENT needs to
// read upright, which is a carrier-specific fact (confirmed per carrier via
// real renders on the RAW, un-rotated source page — only rotate when the raw
// text/barcode is itself printed sideways, e.g. Mondial Relay). It is NOT
// derived from the crop box's own aspect ratio: Bpost's crop box is
// landscape-shaped too, but its content is already horizontal, so rotating
// it (either direction) turns correctly-readable text sideways.
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
  console.log('[label] DETECT START pageW:', pageW.toFixed(1), 'pageH:', pageH.toFixed(1));

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
      bounds.rotate = 90;
      console.log(`[label] content-rect in onderste helft → Mondial Relay (gedraaid): left=${bounds.left.toFixed(0)} bottom=${bounds.bottom.toFixed(0)} right=${bounds.right.toFixed(0)} top=${bounds.top.toFixed(0)} (${rw.toFixed(0)}x${rh.toFixed(0)})`);
    } else {
      // PostNL: roteer 90° naar landscape voor de 4×6 thermische printer als
      // de gevonden rechthoek zelf breder dan hoog is; laat staan als hij al
      // hoger dan breed is.
      bounds.rotate = rw > rh ? 90 : 0;
      console.log(`[label] content-rect in bovenste helft → PostNL: left=${bounds.left.toFixed(0)} bottom=${bounds.bottom.toFixed(0)} right=${bounds.right.toFixed(0)} top=${bounds.top.toFixed(0)} (${rw.toFixed(0)}x${rh.toFixed(0)}), roteer=${bounds.rotate}`);
    }
    return bounds;
  }

  console.log('[label] geen bruikbare content-rechthoek gevonden — val terug op pagina-heuristiek');

  // Stap 2a: portrait A4 (595×842) zonder detecteerbare content-rechthoek —
  // dit dekt zowel Vinted Go (zwarte header + QR bovenaan) als DPD (adres +
  // barcode bovenaan, via lijnen/tabel-structuur getekend i.p.v. een 're'-rect)
  // — in tegenstelling tot PostNL, waar stap 1 hierboven wél een content-
  // rechthoek vindt. Beide labels staan al correct leesbaar (geen rotatie
  // nodig) in de bovenste helft van de pagina, dus we nemen de bovenste 50%.
  //
  // DPD's inhoud vult echter maar de linkerhelft van de paginabreedte (i.p.v.
  // vrijwel de volledige breedte zoals Vinted Go) — als we blind de volledige
  // breedte croppen, blijft er met scale-to-fit te veel wit over, en snijdt
  // scale-to-fill juist het adres/de barcode af omdat die links staan i.p.v.
  // gecentreerd. Oplossing: verfijn left/right met de bounding box van de
  // lijn-tekeningen (DPD's tabelraster) als die significant smaller is dan de
  // volledige paginabreedte — dat geeft een crop-zone waarvan de aspect ratio
  // al dicht bij 4×6 ligt, zodat scale-to-fit vanzelf nauwelijks wit overlaat.
  const isA4Portrait = pageW > 550 && pageW < 640 && pageH > 800 && pageH < 900;
  if (isA4Portrait) {
    let left = 0, bottom = pageH * 0.5, right = pageW, top = pageH;
    let refined = false;

    const lineBounds = findLineArtBounds(src, page);
    if (lineBounds) {
      const lineW = lineBounds.right - lineBounds.left;
      if (lineW > 50 && lineW < pageW * 0.85) {
        const margin = 5;
        left  = Math.max(0, lineBounds.left - margin);
        right = Math.min(pageW, lineBounds.right + margin);
        refined = true;
        console.log(`[label] heuristic portrait A4 (DPD): breedte verfijnd via lijn-tekeningen → left=${left.toFixed(0)} right=${right.toFixed(0)}`);
      }
    }

    if (!refined) {
      // Vinted Go: exacte content-box (zwarte header + QR + trackingnummer),
      // geverifieerd via PyMuPDF get_drawings()/get_text() op een echt 595×842
      // label — sluit strak aan tegen de content zelf i.p.v. de bovenste 50%
      // van de pagina te gokken, wat onnodig witruimte liet staan.
      left = 14; bottom = 530; right = 581; top = 828;
      console.log(`[label] heuristic portrait A4 zonder rect (Vinted Go): exacte content-box left=${left} bottom=${bottom} right=${right} top=${top}, geen rotatie`);
    } else {
      console.log(`[label] heuristic portrait A4 (DPD): bovenste 50%, left=${left.toFixed(0)} right=${right.toFixed(0)}, geen rotatie`);
    }
    return { left, bottom, right, top, rotate: 0 };
  }

  // Stap 2b: Bpost — A4 landscape (breder dan hoog), label linksboven kwadrant.
  // Moet vóór de Vinted Go-check komen: A4 landscape (842x595) heeft ook hoogte < 700.
  // De inhoud zelf staat rechtop (niet gedraaid) — enkel de crop-box is landscape-vormig.
  // Geverifieerd via PyMuPDF (get_drawings() + close-up renders) op een echt
  // bestand: de échte labelinhoud spant left=11 bottom=313 right=409 top=580
  // op een 842x595-pagina. De gestippelde kniplijnen zelf zitten op x=419 en
  // y=300, maar de schaar-icoontjes ernaast steken nog verder het labelgebied
  // in (tot x≈412 en y≈312.5) — net onder/naast de eigen labelrand. De crop
  // moet dus vlak tegen de labelrand zelf aansluiten (niet tegen de kniplijn)
  // om de schaartjes volledig te weren.
  //
  // Rotatie: GEEN rotatie. De rauwe pagina-render toont de tekst/barcode al
  // volledig horizontaal en leesbaar (in tegenstelling tot Mondial Relay, waar
  // de brontekst zelf al zijwaarts staat in de niet-geroteerde pagina — daar
  // corrigeert rotate:90 dat). Een eerdere aanname dat Bpost's landscape-
  // vormige crop-box automatisch rotatie nodig had (eerst +90°, toen -90° na
  // een 180°-op-zijn-kop-rapport) was fout: BEIDE richtingen draaien de al
  // correct leesbare tekst juist ZIJWAARTS. Geverifieerd met een render.
  if (pageW > pageH) {
    const bounds = { left: 0, bottom: pageH * 0.528, right: pageW * 0.487, top: pageH, rotate: 0 };
    console.log(`[label] heuristic Bpost (landscape ${Math.round(pageW)}x${Math.round(pageH)}, geen rotatie): left=0 bottom=${bounds.bottom.toFixed(0)} right=${bounds.right.toFixed(0)} top=${bounds.top.toFixed(0)}`);
    return bounds;
  }

  // Stap 2c: de pagina zelf tekent niets anders dan één ingebedde Form XObject
  // (een "domme" volledige-pagina-embed van een eerdere embedPdf/embedPage +
  // drawPage-bewerking, zonder crop). Kijk naar de ECHTE inhoud daarbinnen i.p.v.
  // de hele ingebedde pagina te vertrouwen — geverifieerd op een echt bestand
  // waarbij de ingebedde XObject een volledige 595×842-pagina bleek (BBox
  // 0,0,595,842) met de daadwerkelijke content maar in de bovenste ~35% ervan.
  const wrapped = unwrapFormXObject(src, page);
  if (wrapped) {
    console.log(`[label] wrapper gedetecteerd: ingebedde XObject ${wrapped.vw.toFixed(0)}x${wrapped.vh.toFixed(0)}`);
    const innerRects = parseRects(wrapped.xobjBytes, wrapped.vw, wrapped.vh);
    let innerBounds, innerRotate = 0;
    if (innerRects.length) {
      innerRects.sort((a, b) => (b.right - b.left) * (b.top - b.bottom) - (a.right - a.left) * (a.top - a.bottom));
      innerBounds = innerRects[0];
      console.log(`[label] wrapper: content-rect binnenin gevonden (${(innerBounds.right - innerBounds.left).toFixed(0)}x${(innerBounds.top - innerBounds.bottom).toFixed(0)})`);
    } else if (wrapped.vw > wrapped.vh) {
      innerBounds = { left: 0, bottom: wrapped.vh * 0.45, right: wrapped.vw * 0.55, top: wrapped.vh };
      innerRotate = 0;
      console.log('[label] wrapper: geen rect binnenin — landscape-heuristiek (Bpost-stijl) op virtuele pagina, geen rotatie');
    } else {
      // Vinted Go/DPD-achtige situatie: verfijn de breedte via lijn-tekeningen
      // als DPD's tabelraster gevonden wordt (zie de analoge stap voor de
      // niet-ingebedde pagina hierboven); anders exacte Vinted Go content-box,
      // proportioneel geschaald t.o.v. de standaard 595×842-referentie.
      const lineBounds = extractLineArtBounds(Buffer.from(wrapped.xobjBytes).toString('binary'));
      let left, bottom, right, top;
      const lineW = lineBounds ? lineBounds.right - lineBounds.left : 0;
      if (lineBounds && lineW > 50 && lineW < wrapped.vw * 0.85) {
        const margin = 5;
        left   = Math.max(0, lineBounds.left - margin);
        right  = Math.min(wrapped.vw, lineBounds.right + margin);
        bottom = wrapped.vh * 0.5;
        top    = wrapped.vh;
        console.log(`[label] wrapper: breedte verfijnd via lijn-tekeningen (DPD) → left=${left.toFixed(0)} right=${right.toFixed(0)}`);
      } else {
        const scaleX = wrapped.vw / 595, scaleY = wrapped.vh / 842;
        left = 14 * scaleX; right = 581 * scaleX; bottom = 530 * scaleY; top = 828 * scaleY;
        console.log(`[label] wrapper: exacte Vinted Go content-box (geschaald) → left=${left.toFixed(0)} bottom=${bottom.toFixed(0)} right=${right.toFixed(0)} top=${top.toFixed(0)}`);
      }
      innerBounds = { left, bottom, right, top };
      innerRotate = 0;
    }
    const mapped = mapBoundsThroughCtm(innerBounds, wrapped.ctm, pageW, pageH);
    mapped.rotate = innerRotate;
    console.log(`[label] wrapper: gemapt naar pagina-coördinaten: left=${mapped.left.toFixed(0)} bottom=${mapped.bottom.toFixed(0)} right=${mapped.right.toFixed(0)} top=${mapped.top.toFixed(0)}`);
    return mapped;
  }

  // Stap 2d: pagina is al ~4×6 groot en GEEN wrapper — waarschijnlijk al een
  // correcte crop (bv. opnieuw geüpload na eerdere verwerking) — vertrouw de
  // volledige pagina i.p.v. een percentage te gokken.
  const isAlready4x6 = Math.abs(pageW - LABEL_W) < 20 && Math.abs(pageH - LABEL_H) < 20;
  if (isAlready4x6) {
    console.log(`[label] pagina is al ~4x6 (${Math.round(pageW)}x${Math.round(pageH)}), geen wrapper — volledige pagina vertrouwen`);
    return { left: 0, bottom: 0, right: pageW, top: pageH, rotate: 0 };
  }

  // Stap 2e: écht klein, niet-A4, niet-4×6 formaat (bv. ~595x490), label +
  // zwarte header bovenaan. Het label neemt in dat geval maar ~35-40% van de
  // paginahoogte in, dus bovenste 40% behouden (bottom=0 is onderaan in
  // PDF-coördinaten, dus bottom = pageH * 0.6 → bovenste 40%). Geen rotatie —
  // net als de Vinted Go A4-variant hierboven staat dit al correct leesbaar.
  if (pageH < 700) {
    const bottom = pageH * 0.6;
    console.log(`[label] heuristic Vinted Go (${Math.round(pageW)}x${Math.round(pageH)}): bovenste 40%, geen rotatie → bottom=${bottom.toFixed(0)}`);
    return { left: 0, bottom, right: pageW, top: pageH, rotate: 0 };
  }

  // Onbekend formaat — geen enkele carrier-heuristiek matcht, gebruik de volledige pagina
  console.log('[label] geen carrier-match — volledige pagina als crop');
  return { left: 0, bottom: 0, right: pageW, top: pageH, rotate: 0 };
}

// Crop ruwe PDF-bytes (welke bron dan ook) naar een exacte 4×6 (288×432pt) label-PDF.
//
// Aanpak: embed ENKEL de gedetecteerde label-zone (embedPage met een bounding
// box, die de inhoud automatisch clipt volgens de PDF-spec voor Form XObject
// BBoxes) en gebruik scale-to-fit (Math.min), gecentreerd op de 4×6 pagina.
// Aspect ratio wordt altijd bewaard — witte randen zijn acceptabel, vervormde
// tekst niet.
export async function cropToLabel(pdfBytes) {
  const src  = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const page = src.getPages()[0];

  const { width: pageW, height: pageH } = page.getSize();
  const rotation = page.getRotation().angle;
  console.log('[label] page size:', Math.round(pageW), 'x', Math.round(pageH), 'rotation:', rotation);

  const out = await PDFDocument.create();

  // Detecteer de label-zone (left,bottom,right,top) in bron-coördinaten
  const bounds = await detectLabelBounds(src, page);
  const cropW = bounds.right - bounds.left;
  const cropH = bounds.top  - bounds.bottom;
  console.log(`[label] FINAL BOUNDS gebruikt: left=${bounds.left.toFixed(1)} bottom=${bounds.bottom.toFixed(1)} right=${bounds.right.toFixed(1)} top=${bounds.top.toFixed(1)} → crop ${cropW.toFixed(1)}x${cropH.toFixed(1)}`);

  // Embed enkel de label-zone — alles buiten deze box wordt geclipt
  const embedded = await out.embedPage(page, {
    left:   bounds.left,
    bottom: bounds.bottom,
    right:  bounds.right,
    top:    bounds.top,
  });
  const newPage = out.addPage([LABEL_W, LABEL_H]);

  // Rotatie is een carrier-beslissing (Mondial Relay, Vinted Go), NIET afgeleid
  // van de vorm van de crop-box — Bpost's crop-box is bv. ook landscape-vormig
  // terwijl die inhoud al rechtop staat. Altijd scale-to-fit (Math.min): een
  // scale-to-fill-poging voor Vinted Go sneed de QR-code en het
  // trackingnummer af (die staan niet gecentreerd in de crop-zone) — voor een
  // landscape-vormige crop-zone lost roteren dat op zonder iets af te snijden.
  const rotateAngle = bounds.rotate || 0;

  if (rotateAngle !== 0) {
    // Roteer ±90° en scale-to-fit (aspect ratio behouden, gecentreerd).
    // Na rotatie wisselen breedte/hoogte: cropW wordt de visuele hoogte,
    // cropH wordt de visuele breedte. De translatie (x,y) hangt af van de
    // draairichting — +90° en -90° verplaatsen de gedraaide inhoud naar
    // tegenovergestelde hoeken, dus zomaar de hoek omdraaien met dezelfde
    // x/y zou het label verkeerd positioneren (180° op zijn kop, zoals bij
    // Bpost met +90° geverifieerd via een render).
    const scale   = Math.min(LABEL_W / cropH, LABEL_H / cropW);
    const drawW   = cropW * scale;
    const drawH   = cropH * scale;
    const visualW = drawH, visualH = drawW;
    const offsetX = (LABEL_W - visualW) / 2;
    const offsetY = (LABEL_H - visualH) / 2;
    const x = rotateAngle === 90 ? offsetX + drawH : offsetX;
    const y = rotateAngle === 90 ? offsetY : offsetY + drawW;
    console.log(`[label] rotate ${rotateAngle}° + scale-to-fit: scale=${scale.toFixed(3)} visual=${Math.round(visualW)}x${Math.round(visualH)} offset=(${Math.round(offsetX)},${Math.round(offsetY)})`);
    newPage.drawPage(embedded, {
      x, y,
      width:  drawW,
      height: drawH,
      rotate: { type: 'degrees', angle: rotateAngle },
    });
  } else {
    // Portrait crop: scale-to-fit, gecentreerd, geen distortie
    const scale   = Math.min(LABEL_W / cropW, LABEL_H / cropH);
    const drawW   = cropW * scale;
    const drawH   = cropH * scale;
    const offsetX = (LABEL_W - drawW) / 2;
    const offsetY = (LABEL_H - drawH) / 2;
    console.log(`[label] scale-to-fit: scale=${scale.toFixed(3)} drawW=${Math.round(drawW)} drawH=${Math.round(drawH)} offset=(${Math.round(offsetX)},${Math.round(offsetY)})`);
    newPage.drawPage(embedded, { x: offsetX, y: offsetY, width: drawW, height: drawH });
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
