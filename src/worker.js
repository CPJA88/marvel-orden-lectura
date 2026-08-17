const MARVEL_ORIGIN = 'https://www.marvel.com';
const GOOGLE_ORIGIN = 'https://www.google.com';
const MARVEL_SHARE_ORIGIN = 'https://share.marvel.com';

function unescapeHtml(value = '') {
  return String(value)
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
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

function issueReadUrl(issueUrl = '') {
  try {
    const url = new URL(issueUrl);
    const match = url.pathname.match(/^\/comics\/issue\/(\d+)/i);
    if (!match) return issueUrl;
    return `${MARVEL_ORIGIN}/comics/issue/${match[1]}/read`;
  } catch {
    return issueUrl;
  }
}

function shareCatalogUrl(issueUrl = '') {
  try {
    const url = new URL(issueUrl);
    if (!/^\/comics\/issue\/\d+\//i.test(url.pathname)) return '';
    return `${MARVEL_SHARE_ORIGIN}${url.pathname}`;
  } catch {
    return '';
  }
}

function extractIssueDrn(html = '') {
  const normalized = unescapeHtml(html)
    .replace(/\\u003A/gi, ':')
    .replace(/%3A/gi, ':')
    .replace(/&#58;/gi, ':');
  const match = normalized.match(/drn:src:marvel:unison::prod:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match?.[0] || '';
}

async function fetchHtml(url, userAgent = 'Mozilla/5.0 (compatible; MarvelLectura/1.7)') {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!response.ok) throw new Error(`${url} respondió ${response.status}`);
  return response.text();
}

async function resolveCurrentMarvelShareLink(issueUrl = '') {
  const catalogUrl = shareCatalogUrl(issueUrl);
  if (!catalogUrl) return { catalogUrl: '', shareUrl: '', drn: '' };

  const sources = [catalogUrl, issueUrl];
  for (const source of sources) {
    try {
      const html = await fetchHtml(source, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1');
      const drn = extractIssueDrn(html);
      if (drn) {
        return {
          catalogUrl,
          drn,
          shareUrl: `${MARVEL_SHARE_ORIGIN}/sharing/issue/${encodeURIComponent(drn)}`,
        };
      }
    } catch (error) {
      console.error('Marvel share resolver:', source, error);
    }
  }

  // No mandamos al usuario a /comics/issue de share.marvel.com: esa ruta puede
  // romperse en Safari. Sin DRN no se inventa un deep link.
  return { catalogUrl, shareUrl: '', drn: '' };
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
  const clean = unescapeHtml(html);
  const decoded = clean.replace(/%2F/gi, '/').replace(/%3A/gi, ':');
  const candidates = [];
  const direct = decoded.match(/https?:\/\/(?:www\.)?marvel\.com\/comics\/issue\/\d+\/[A-Za-z0-9_()%.,+\-]+/gi) || [];
  candidates.push(...direct);

  const googleLinks = decoded.match(/\/url\?[^"'<>\s]+/gi) || [];
  for (const link of googleLinks) {
    try {
      const parsed = new URL(link.replace(/&amp;/g, '&'), GOOGLE_ORIGIN);
      const target = parsed.searchParams.get('q') || parsed.searchParams.get('url') || '';
      if (target) candidates.push(target);
    } catch {}
  }

  for (const candidate of candidates) {
    if (isMarvelIssueUrl(candidate)) return cleanMarvelIssueUrl(candidate);
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

// La identificación del número conserva el método estable de v1.1.3.
async function resolveExactIssueWithGoogle(title, issue, year) {
  const lucky = luckyUrl(title, issue, year);
  try {
    const response = await fetchGoogle(lucky, 'manual');
    const fromLocation = unwrapGoogleLocation(response.headers.get('Location') || '');
    if (fromLocation) return { issueUrl: fromLocation, source: 'google-lucky-location' };
    if (isMarvelIssueUrl(response.url)) return { issueUrl: cleanMarvelIssueUrl(response.url), source: 'google-lucky-final-url' };
    const html = await response.text();
    const fromHtml = extractMarvelIssueFromGoogleHtml(html);
    if (fromHtml) return { issueUrl: fromHtml, source: 'google-lucky-html' };
  } catch (error) {
    console.error('Google lucky resolver:', error);
  }

  try {
    const response = await fetchGoogle(normalGoogleUrl(title, issue, year), 'follow');
    const html = await response.text();
    const fromHtml = extractMarvelIssueFromGoogleHtml(html);
    if (fromHtml) return { issueUrl: fromHtml, source: 'google-search-html' };
  } catch (error) {
    console.error('Google normal resolver:', error);
  }
  return { issueUrl: '', source: 'unresolved' };
}

async function getMarvelHtml(url) {
  return fetchHtml(url);
}

function extractDigitalLinks(html, issueUrl) {
  const clean = unescapeHtml(html);
  const readerMatch = clean.match(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/i);
  const readerId = readerMatch?.[1] || '';
  const webUrl = readerMatch?.[0] || issueReadUrl(issueUrl);
  return {
    issueUrl,
    readerId,
    webUrl,
    androidUrl: readerId
      ? `intent://reader/${readerId}#Intent;scheme=marvelunlimited;package=com.marvel.unlimited;S.browser_fallback_url=${encodeURIComponent(webUrl)};end`
      : '',
  };
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

function iosUniversalLinkLauncher(target, fallback) {
  const targetAttr = escAttr(target);
  const fallbackAttr = escAttr(fallback);
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Abrir Marvel Unlimited</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px;letter-spacing:-1px}h2{margin:24px 0 8px;font-size:25px}p{color:#74747b;font-size:13px;line-height:1.5;margin:0 0 22px}a{display:block;margin-top:12px;padding:15px;border-radius:14px;text-decoration:none;font-weight:850}.app{background:#e62429;color:#fff}.web{background:#fff;color:#333;border:1px solid #ddd8cf}.note{margin-top:18px;font-size:11px;color:#999}</style></head><body><div class="box"><span class="logo">MARVEL</span><h2>Cómic localizado</h2><p>iOS necesita que pulses directamente el enlace oficial de Marvel para entregarlo a Marvel Unlimited.</p><a class="app" href="${targetAttr}">Abrir este cómic en Marvel Unlimited</a><a class="web" href="${fallbackAttr}">Abrir este mismo cómic en la web</a><div class="note">No se usa ninguna redirección automática ni el esquema privado reader.</div></div></body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}

function mobileLauncher(target, fallback, label) {
  const targetAttr = escAttr(target);
  const fallbackAttr = escAttr(fallback);
  const targetJs = JSON.stringify(target).replace(/</g, '\\u003c');
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Marvel Unlimited</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px}a{display:block;margin-top:14px;padding:14px;border-radius:14px;text-decoration:none;font-weight:800}.app{background:#e62429;color:#fff}.web{background:#fff;color:#333;border:1px solid #ddd8cf}p{color:#74747b;font-size:13px;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><h2>Abriendo Marvel Unlimited</h2><p>La ficha exacta se ha localizado.</p><a class="app" href="${targetAttr}">${label}</a><a class="web" href="${fallbackAttr}">Abrir este mismo número en la web</a></div><script>const target=${targetJs};setTimeout(()=>{location.href=target},100);</script></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });
}

function unresolvedPage(lucky) {
  const safe = escAttr(lucky);
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marvel Unlimited</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px}a{display:block;margin-top:20px;padding:14px;border-radius:14px;background:#fff;color:#333;border:1px solid #ddd8cf;text-decoration:none;font-weight:800}p{color:#74747b;font-size:13px;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><h2>No he podido resolver el enlace de la app</h2><p>No voy a sustituirlo por otro cómic.</p><a href="${safe}">Abrir búsqueda exacta</a></div></body></html>`, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
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
      const resolved = await resolveExactIssueWithGoogle(title, issue, year);
      if (!resolved.issueUrl) return unresolvedPage(lucky);

      const html = await getMarvelHtml(resolved.issueUrl);
      const comic = extractDigitalLinks(html, resolved.issueUrl);

      if (mode === 'ios') {
        const currentShare = await resolveCurrentMarvelShareLink(resolved.issueUrl);
        if (!currentShare.drn || !currentShare.shareUrl) {
          return iosUniversalLinkLauncher(comic.webUrl || resolved.issueUrl, comic.webUrl || resolved.issueUrl);
        }
        // CLAVE: no hacemos 302 hacia share.marvel.com. El usuario pulsa el
        // Universal Link directamente desde esta página para que iOS pueda
        // entregárselo a Marvel Unlimited.
        return iosUniversalLinkLauncher(currentShare.shareUrl, comic.webUrl || resolved.issueUrl);
      }

      if (mode === 'android' && comic.androidUrl) {
        return mobileLauncher(comic.androidUrl, comic.webUrl, 'Abrir Marvel Unlimited en Android');
      }

      return redirect(comic.webUrl || comic.issueUrl);
    } catch (error) {
      console.error('Marvel mobile resolver:', error);
      return unresolvedPage(lucky);
    }
  },
};
