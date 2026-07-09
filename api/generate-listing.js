// Genereert een Vinted-stijl titel + beschrijving op basis van 1-2 productfoto's,
// via Gemini (gratis tier, zie GEMINI_API_KEY hieronder). Draait server-side
// zodat de API-key nooit client-zichtbaar is — zelfde patroon als de andere
// api/*.js-bestanden hier.
//
// Flash-Lite eerst (ruimste gratis quotum), met één fallback naar Flash bij
// een 503 "model overladen" — dat bleek bij live testen af en toe voor te
// komen op Flash-Lite; Flash valt ook onder de gratis tier, dus geen kosten.
const MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash']
const MAX_IMAGES = 2
const MAX_IMAGE_BYTES = 4 * 1024 * 1024 // ruwe geschatte grootte na base64-decode

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title:       { type: 'string', description: 'Korte, pakkende Vinted-advertentietitel in het Nederlands: merk + type kledingstuk (+ evt. kenmerk), max ~60 tekens.' },
    description: { type: 'string', description: 'Vinted-omschrijving in het Nederlands, 2-4 zinnen: merk (indien zichtbaar), kleur, materiaal (indien zichtbaar), staat.' },
    brand:       { type: 'string', description: 'Merknaam indien duidelijk herkenbaar op de foto (bv. een logo/label), anders lege string. Nooit gokken.' },
    category:    { type: 'string', description: 'Type kledingstuk, bv. Trui, Jas, Broek, Jurk.' },
    color:       { type: 'string', description: 'Belangrijkste kleur van het artikel.' },
    condition:   { type: 'string', description: 'Ingeschatte staat, bv. "Nieuw met prijskaartje", "Zeer goed", "Goed", "Redelijk".' },
  },
  required: ['title', 'description'],
}

const PROMPT = `Je bent een assistent die tweedehands kledingadvertenties voor Vinted opstelt.
Analyseer de bijgevoegde foto('s) van één artikel en genereer een titel en beschrijving
in dezelfde beknopte, feitelijke stijl als typische Vinted-advertenties.

Regels:
- Schrijf in het Nederlands.
- Verzin nooit een merk dat je niet kan lezen op een label/logo — laat "brand" dan leeg.
- Verzin geen maten, materialen of gebreken die je niet met zekerheid op de foto ziet.
- Houd de titel kort en concreet (merk + type kledingstuk, evt. kleur of bijzonderheid).
- De beschrijving is 2-4 zinnen, geen opsomming, geen emoji, geen prijsvermelding.`

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const API_KEY = process.env.GEMINI_API_KEY
  if (!API_KEY) {
    return res.status(500).json({ error: 'server misconfigured', detail: 'GEMINI_API_KEY ontbreekt' })
  }

  const images = Array.isArray(req.body?.images) ? req.body.images.slice(0, MAX_IMAGES) : []
  if (!images.length) {
    return res.status(400).json({ error: 'geen foto\'s meegestuurd' })
  }
  for (const img of images) {
    if (!img?.data || !img?.mimeType) {
      return res.status(400).json({ error: 'ongeldige foto-data' })
    }
    if (img.data.length > MAX_IMAGE_BYTES * 1.4) { // base64 opslag ~1.37x ruwe bytes
      return res.status(400).json({ error: 'foto te groot' })
    }
  }

  const parts = [
    { text: PROMPT },
    ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
  ]

  try {
    let geminiRes, lastErrText = ''
    for (let i = 0; i < MODELS.length; i++) {
      geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODELS[i]}:generateContent?key=${encodeURIComponent(API_KEY)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: RESPONSE_SCHEMA,
            },
          }),
        }
      )
      if (geminiRes.status === 429) {
        return res.status(429).json({ error: 'quota_exceeded', message: 'Gratis AI-quotum voor vandaag is bereikt. Probeer later opnieuw of vul handmatig in.' })
      }
      if (geminiRes.ok) break
      lastErrText = await geminiRes.text().catch(() => '')
      const isOverloaded = geminiRes.status === 503
      if (!isOverloaded || i === MODELS.length - 1) {
        console.error('[generate-listing] Gemini-fout:', geminiRes.status, lastErrText.slice(0, 300))
        return res.status(502).json({ error: 'ai_failed', message: 'Genereren via AI is mislukt. Probeer opnieuw of vul handmatig in.' })
      }
      // model overladen (503) — probeer de volgende, betrouwbaardere fallback
    }

    const body = await geminiRes.json()
    const finishReason = body?.candidates?.[0]?.finishReason
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      console.error('[generate-listing] leeg antwoord, finishReason:', finishReason)
      return res.status(502).json({ error: 'ai_empty', message: 'AI gaf geen bruikbaar resultaat terug. Probeer opnieuw of vul handmatig in.' })
    }

    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      console.error('[generate-listing] kon AI-antwoord niet parsen:', text.slice(0, 300))
      return res.status(502).json({ error: 'ai_parse_failed', message: 'AI-antwoord kon niet verwerkt worden. Probeer opnieuw of vul handmatig in.' })
    }

    return res.status(200).json({
      title: parsed.title || '',
      description: parsed.description || '',
      brand: parsed.brand || '',
      category: parsed.category || '',
      color: parsed.color || '',
      condition: parsed.condition || '',
    })
  } catch (e) {
    console.error('[generate-listing] exception:', e.message)
    return res.status(500).json({ error: 'exception', message: 'Genereren mislukt door een serverfout. Probeer opnieuw of vul handmatig in.' })
  }
}
