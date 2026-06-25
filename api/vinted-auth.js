// Vercel serverless function: email+password login naar Vinted
// Flow (zelfde als Python cloudscraper wrapper, maar in Node.js):
//   1. GET homepage → _vinted_fr_session cookie + XSRF-TOKEN (CSRF)
//   2. POST /api/v2/sessions met credentials + CSRF header
//   3. Geeft de volledige sessie-cookie terug

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Alleen POST toegestaan' });

  const { email, password, domain = 'be' } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email en password zijn verplicht' });
  }

  const base = `https://www.vinted.${domain}`;

  // Browser headers identiek aan de Python wrapper (Chrome 131 op Windows)
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  const homeHeaders = {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'nl-BE,nl;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Cache-Control': 'max-age=0',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };

  try {
    // ── Stap 1: homepage ophalen voor sessie-cookie + CSRF token ────────────
    const homeRes = await fetch(`${base}/`, {
      method: 'GET',
      headers: homeHeaders,
      redirect: 'follow',
    });

    console.log('[vinted-auth] homepage status:', homeRes.status, 'for domain:', domain);

    if (homeRes.status === 403 || homeRes.status === 503) {
      // Cloudflare blokkeert de serverless omgeving
      return res.status(502).json({
        error: 'Cloudflare blokkeert de server-side request. Gebruik je bestaande browsercookie via x-vinted-cookie header.',
        hint: 'Kopieer je _vinted_fr_session cookie uit DevTools → Application → Cookies.',
        cloudflareBlocked: true,
      });
    }

    // ── Cookie jar opbouwen ──────────────────────────────────────────────────
    const jar = parseCookies(homeRes.headers);

    // CSRF token zit in de XSRF-TOKEN cookie (URL-encoded)
    let csrf = jar['XSRF-TOKEN'] ? decodeURIComponent(jar['XSRF-TOKEN']) : '';

    // Fallback: zoek <meta name="csrf-token"> in de HTML
    if (!csrf) {
      try {
        const html = await homeRes.text();
        const m =
          html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i) ??
          html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i);
        if (m) csrf = m[1];
      } catch {}
    }

    console.log('[vinted-auth] csrf gevonden:', !!csrf, '| cookies:', Object.keys(jar).join(', '));

    const cookieStr = jarToString(jar);

    // ── Stap 2: POST /api/v2/sessions ────────────────────────────────────────
    const loginRes = await fetch(`${base}/api/v2/sessions`, {
      method: 'POST',
      headers: {
        'User-Agent': ua,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'nl-BE,nl;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Content-Type': 'application/json',
        'Cookie': cookieStr,
        'X-CSRF-Token': csrf,
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': base,
        'Referer': `${base}/`,
        'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
      body: JSON.stringify({ login: email, password }),
    });

    console.log('[vinted-auth] login status:', loginRes.status);

    let loginData = {};
    try { loginData = await loginRes.json(); } catch {}

    if (!loginRes.ok) {
      const errMsg =
        loginData?.message ??
        loginData?.error ??
        loginData?.errors?.[0]?.message ??
        `HTTP ${loginRes.status}`;
      return res.status(loginRes.status).json({ error: errMsg, details: loginData });
    }

    // ── Sessie-cookies samenvoegen met login-response cookies ────────────────
    const loginCookies = parseCookies(loginRes.headers);
    const merged = { ...jar, ...loginCookies };
    const sessionCookie = jarToString(merged);

    return res.status(200).json({
      success: true,
      cookie: sessionCookie,
      user: loginData.user ?? null,
    });

  } catch (err) {
    console.error('[vinted-auth] onverwachte fout:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── Hulpfuncties ─────────────────────────────────────────────────────────────

function parseCookies(headers) {
  const jar = {};
  // getSetCookie() is beschikbaar in Node.js 18.14+ (WHATWG Fetch / undici)
  const cookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : splitSetCookieFallback(headers.get('set-cookie') ?? '');

  for (const raw of cookies) {
    const semi = raw.indexOf(';');
    const nameVal = semi >= 0 ? raw.slice(0, semi) : raw;
    const eq = nameVal.indexOf('=');
    if (eq < 0) continue;
    const name = nameVal.slice(0, eq).trim();
    const val  = nameVal.slice(eq + 1).trim();
    if (name) jar[name] = val;
  }
  return jar;
}

function jarToString(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

// Noodoplossing: split meerdere Set-Cookie headers die als één string komen
function splitSetCookieFallback(raw) {
  if (!raw) return [];
  // Splits op komma's die niet binnen de expires-datum vallen
  return raw.split(/,(?=\s*[A-Za-z_-]+=)/);
}
