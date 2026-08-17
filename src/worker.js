const MARVEL_ORIGIN = 'https://www.marvel.com';
const GOOGLE_ORIGIN = 'https://www.google.com';
const MARVEL_SHARE_ORIGIN = 'https://share.marvel.com';

function unescapeHtml(value = '') {
  return String(value)
    .replace(/\\u002F/gi, '/')
    .replace(/\\u003A/gi, ':')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#58;/g, ':');
}

function exactGoogleQuery(title, issue, year) {
  return `site:marvel.com/comics/issue/ "${title}" "${issue ? `#${issue}` : ''}" ${year} Marvel Unlimited`;
}

function luckyUrl(title, issue, year) {
  return `${GOOGLE_ORIGIN}/search?btnI=1&q=${encodeURIComponent(exactGoogleQuery(title, issue, year))}`;
}

function normalGoogleUrl(title, issue, year) {
  return `${GOOGLE_ORIGIN}/search?q=${encodeURIComponent(exactGoogleQuery(title, issue, year))}`;
}

function isMarvelIssueUrl(value = '') {
  try {
    const url = new URL(value, GOOGLE_ORIGIN);
    return /(^|\.)marvel\.com$/i.test(url.hostname) && /^\/comics\/issue\/\d+\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function cleanMarvelIssueUrl(value = '') {
  try {
    const url = new URL(value, GOOGLE_ORIGIN);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '';
  }
}

function unwrapGoogleLocation(location = '') {
  try {
    const absolute = new URL(location, GOOGLE_ORIGIN);
    if (isMarvelIssueUrl(absolute.href)) return cleanMarvelIssueUrl(absolute.href);
    if (/google\./i.test(absolute.hostname) && absolute.pathname === '/url') {
      const target = absolute.searchParams.get('q') || absolute.searchParams.get('url') || '';
      if (isMarvelIssueUrl(target)) return cleanMarvelIssueUrl(target);
    }
  } catch {}
  return '';
}

function extractMarvelIssueFromGoogleHtml(html = '') {
  const clean = unescapeHtml(html).replace(/%2F/gi, '/').replace(/%3A/gi, ':');
  const candidates = clean.match(/https?:\/\/(?:www\.)?marvel\.com\/comics\/issue\/\d+\/[A-Za-z0-9_()%.,+\-]+/gi) || [];
  for (const candidate of candidates) {
    if (isMarvelIssueUrl(candidate)) return cleanMarvelIssueUrl(candidate);
  }

  const googleLinks = clean.match(/\/url\?[^"'<>\s]+/gi) || [];
  for (const link of googleLinks) {
    try {
      const parsed = new URL(link.replace(/&amp;/g, '&'), GOOGLE_ORIGIN);
      const target = parsed.searchParams.get('q') || parsed.searchParams.get('url') || '';
      if (isMarvelIssueUrl(target)) return cleanMarvelIssueUrl(target);
    } catch {}
  }
  return '';
}

async function fetchGoogle(url, redirect = 'manual') {
  return fetch(url, {
    redirect,
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.6',
    },
  });
}

// No se modifica: este es el identificador estable que vuelve a encontrar
// correctamente la ficha de Marvel del número seleccionado.
async function resolveExactIssueWithGoogle(title, issue, year) {
  const lucky = luckyUrl(title, issue, year);
  try {
    const response = await fetchGoogle(lucky, 'manual');
    const fromLocation = unwrapGoogleLocation(response.headers.get('Location') || '');
    if (fromLocation) return fromLocation;
    if (isMarvelIssueUrl(response.url)) return cleanMarvelIssueUrl(response.url);
    const html = await response.text();
    const fromHtml = extractMarvelIssueFromGoogleHtml(html);
    if (fromHtml) return fromHtml;
  } catch (error) {
    console.error('Google lucky resolver:', error);
  }

  try {
    const response = await fetchGoogle(normalGoogleUrl(title, issue, year), 'follow');
    const html = await response.text();
    const fromHtml = extractMarvelIssueFromGoogleHtml(html);
    if (fromHtml) return fromHtml;
  } catch (error) {
    console.error('Google normal resolver:', error);
  }
  return '';
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MarvelLectura/1.8)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!response.ok) throw new Error(`${url} respondió ${response.status}`);
  return response.text();
}

function extractReaderUrl(html, issueUrl) {
  const clean = unescapeHtml(html);
  const reader = clean.match(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/i)?.[0];
  return reader || issueUrl;
}

function extractIssueDrn(value = '') {
  const clean = unescapeHtml(value).replace(/%3A/gi, ':');
  return clean.match(/drn:src:marvel:unison::prod:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || '';
}

function shareSearchUrl(title, issue, year) {
  const label = `${title}${year ? ` (${year})` : ''}${issue ? ` #${issue}` : ''}`;
  const query = `site:share.marvel.com/sharing/issue "${label}" Marvel Unlimited`;
  return `${GOOGLE_ORIGIN}/search?q=${encodeURIComponent(query)}`;
}

function extractDrnFromShareSearch(html = '') {
  const clean = unescapeHtml(html)
    .replace(/%2F/gi, '/')
    .replace(/%3A/gi, ':');
  const direct = extractIssueDrn(clean);
  if (direct) return direct;

  const urls = clean.match(/https?:\/\/share\.marvel\.com\/sharing\/issue\/[^"'<>\s&]+/gi) || [];
  for (const url of urls) {
    const drn = extractIssueDrn(url);
    if (drn) return drn;
  }
  return '';
}

// La app moderna comparte números mediante DRN Unison. Primero intentamos
// obtener ese ID directamente de la ficha exacta de Marvel; si no está en el
// HTML, usamos la búsqueda oficial indexada en share.marvel.com.
async function resolveUnisonDrn(title, issue, year, marvelHtml) {
  const direct = extractIssueDrn(marvelHtml);
  if (direct) return direct;

  try {
    const response = await fetchGoogle(shareSearchUrl(title, issue, year), 'follow');
    const html = await response.text();
    return extractDrnFromShareSearch(html);
  } catch (error) {
    console.error('Marvel DRN resolver:', error);
    return '';
  }
}

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'private, no-store' },
  });
}

function escAttr(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function appLauncher(target, fallback, title = 'Abriendo Marvel Unlimited') {
  const targetAttr = escAttr(target);
  const fallbackAttr = escAttr(fallback);
  const targetJs = JSON.stringify(target).replace(/</g, '\\u003c');
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${title}</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px}a{display:block;margin-top:14px;padding:14px;border-radius:14px;text-decoration:none;font-weight:800}.app{background:#e62429;color:#fff}.web{background:#fff;color:#333;border:1px solid #ddd8cf}p{color:#74747b;font-size:13px;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><h2>${title}</h2><p>El número está identificado. Si la app no se abre automáticamente, pulsa el botón rojo.</p><a class="app" href="${targetAttr}">Abrir Marvel Unlimited</a><a class="web" href="${fallbackAttr}">Abrir este mismo número en la web</a></div><script>const target=${targetJs};setTimeout(()=>{location.href=target},80);</script></body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}

function unresolvedPage(fallback) {
  const safe = escAttr(fallback);
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marvel Unlimited</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px}a{display:block;margin-top:20px;padding:14px;border-radius:14px;background:#fff;color:#333;border:1px solid #ddd8cf;text-decoration:none;font-weight:800}p{color:#74747b;font-size:13px;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><h2>Número localizado, pero sin ID móvil</h2><p>No voy a mandar otro cómic a Marvel Unlimited.</p><a href="${safe}">Abrir este número en la web</a></div></body></html>`, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/marvel/open') return env.ASSETS.fetch(request);

    const title = (url.searchParams.get('title') || '').trim();
    const issue = (url.searchParams.get('issue') || '').trim();
    const year = (url.searchParams.get('year') || '').trim();
    const mode = (url.searchParams.get('mode') || 'web').toLowerCase();
    if (!title) return new Response('Falta el título del cómic.', { status: 400 });

    const lucky = luckyUrl(title, issue, year);
    if (mode === 'web') return redirect(lucky);

    try {
      const issueUrl = await resolveExactIssueWithGoogle(title, issue, year);
      if (!issueUrl) return unresolvedPage(lucky);

      const marvelHtml = await fetchHtml(issueUrl);
      const webUrl = extractReaderUrl(marvelHtml, issueUrl);

      if (mode === 'ios') {
        const drn = await resolveUnisonDrn(title, issue, year, marvelHtml);
        if (!drn) return unresolvedPage(webUrl);

        // Restauramos el deeplink que YA abría la aplicación. Lo único que
        // cambia es el payload: se envía el identificador Unison actual del
        // número, no el ID numérico del lector web antiguo.
        const target = `marvelunlimited://reader/${encodeURIComponent(drn)}`;
        return appLauncher(target, webUrl);
      }

      if (mode === 'android') {
        const drn = await resolveUnisonDrn(title, issue, year, marvelHtml);
        if (!drn) return unresolvedPage(webUrl);
        const target = `intent://reader/${encodeURIComponent(drn)}#Intent;scheme=marvelunlimited;package=com.marvel.unlimited;S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
        return appLauncher(target, webUrl);
      }

      return redirect(webUrl);
    } catch (error) {
      console.error('Marvel resolver:', error);
      return unresolvedPage(lucky);
    }
  },
};
