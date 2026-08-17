const MARVEL_ORIGIN = 'https://www.marvel.com';
const GOOGLE_ORIGIN = 'https://www.google.com';

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

// La identificación conserva exactamente el método de v1.1.3: Google restringido
// a marvel.com/comics/issue. El buscador interno de Marvel NO decide el número.
async function resolveExactIssueWithGoogle(title, issue, year) {
  const lucky = luckyUrl(title, issue, year);

  try {
    const response = await fetchGoogle(lucky, 'manual');
    const fromLocation = unwrapGoogleLocation(response.headers.get('Location') || '');
    if (fromLocation) return { issueUrl: fromLocation, source: 'google-lucky-location' };

    if (isMarvelIssueUrl(response.url)) {
      return { issueUrl: cleanMarvelIssueUrl(response.url), source: 'google-lucky-final-url' };
    }

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
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MarvelLectura/1.5)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!response.ok) throw new Error(`Marvel respondió ${response.status}`);
  return response.text();
}

function extractDigitalLinks(html, issueUrl) {
  const clean = unescapeHtml(html);
  const mobileMatch = clean.match(/https:\/\/applink\.marvel\.com\/issue\/(\d+)/i);
  const readerMatch = clean.match(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/i);
  const mobileId = mobileMatch?.[1] || '';
  const readerId = readerMatch?.[1] || '';
  const webUrl = readerMatch?.[0] || issueReadUrl(issueUrl);

  return {
    issueUrl,
    mobileId,
    readerId,
    webUrl,
    // iOS deja de usar el esquema privado marvelunlimited://reader/... porque
    // la versión actual de la app lo abre pero devuelve LOADING ERROR. Se usa
    // la ruta oficial por ID de catálogo, que puede actuar como Universal Link
    // y, si Marvel no la asocia a la app, mantiene un fallback web correcto.
    iosUrl: issueReadUrl(issueUrl),
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

function mobileLauncher(target, fallback, label) {
  const targetAttr = String(target).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const fallbackAttr = String(fallback).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const targetJs = JSON.stringify(target).replace(/</g, '\\u003c');
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Marvel Unlimited</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px}.spinner{width:30px;height:30px;margin:24px auto;border:3px solid #ddd8cf;border-top-color:#e62429;border-radius:50%;animation:s .8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}a{display:block;margin-top:14px;padding:14px;border-radius:14px;text-decoration:none;font-weight:800}.app{background:#e62429;color:#fff}.web{background:#fff;color:#333;border:1px solid #ddd8cf}p{color:#74747b;font-size:13px;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><div class="spinner"></div><h2>Abriendo Marvel Unlimited</h2><p>La ficha exacta se ha localizado y se está enviando a la aplicación.</p><a class="app" href="${targetAttr}">${label}</a><a class="web" href="${fallbackAttr}">Abrir este mismo número en la web</a></div><script>const target=${targetJs};let left=false;document.addEventListener('visibilitychange',()=>{if(document.hidden)left=true});setTimeout(()=>{location.href=target},100);setTimeout(()=>{if(!left)document.querySelector('.spinner').style.display='none'},1700);</script></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });
}

function unresolvedPage(lucky) {
  const safe = String(lucky).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marvel Unlimited</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px}a{display:block;margin-top:20px;padding:14px;border-radius:14px;background:#fff;color:#333;border:1px solid #ddd8cf;text-decoration:none;font-weight:800}p{color:#74747b;font-size:13px;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><h2>No he podido resolver el enlace de la app</h2><p>No voy a sustituirlo por otro cómic. Puedes abrir la búsqueda exacta que usa la versión estable.</p><a href="${safe}">Abrir búsqueda exacta</a></div></body></html>`, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
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

    // Web conserva literalmente el mecanismo de v1.1.3.
    if (mode === 'web') return redirect(lucky);

    try {
      const resolved = await resolveExactIssueWithGoogle(title, issue, year);
      if (!resolved.issueUrl) return unresolvedPage(lucky);

      const html = await getMarvelHtml(resolved.issueUrl);
      const comic = extractDigitalLinks(html, resolved.issueUrl);

      if (mode === 'ios') {
        // No se fuerza un esquema privado: dejamos a iOS/Marvel gestionar la URL
        // oficial del número. Si no existe asociación con la app, abre el lector web.
        return redirect(comic.iosUrl || comic.webUrl || comic.issueUrl);
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
