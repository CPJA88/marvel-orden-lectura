const GOOGLE_ORIGIN = 'https://www.google.com';
const MARVEL_LEGACY_SHARE = 'https://share.marvel.com/sharing/legacy/';
const MARVEL_SMART_LINK = 'https://marvel.smart.link/fiir7ec77';

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

function sourceIdFromIssueUrl(issueUrl = '') {
  try {
    return new URL(issueUrl).pathname.match(/^\/comics\/issue\/(\d+)/i)?.[1] || '';
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

// Se conserva el identificador que ya funciona: Google restringido a la ficha
// oficial de Marvel. Esta parte no participa en el deep link móvil.
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
      'User-Agent': 'Mozilla/5.0 (compatible; MarvelLectura/2.0)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!response.ok) throw new Error(`${url} respondió ${response.status}`);
  return response.text();
}

function extractReaderData(html, issueUrl) {
  const clean = unescapeHtml(html);
  const match = clean.match(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/i);
  return {
    readerId: match?.[1] || '',
    webUrl: match?.[0] || issueUrl,
  };
}

// Método probado por Marvelous Links: el readerId se convierte al DRN real
// consultando share.marvel.com/sharing/legacy/<readerId>.
async function resolveLegacyDrn(readerId) {
  if (!readerId) return '';
  const html = await fetchHtml(`${MARVEL_LEGACY_SHARE}${encodeURIComponent(readerId)}`);
  const clean = unescapeHtml(html).replace(/%3A/gi, ':');

  const explicit = clean.match(/(?:[?&]|\b)drn=([^&"'<>\s]+)/i)?.[1] || '';
  if (explicit) return decodeURIComponent(explicit);

  return clean.match(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i)?.[0] || '';
}

function buildSmartLink(drn, sourceId) {
  if (!drn || !sourceId) return '';
  const url = new URL(MARVEL_SMART_LINK);
  url.searchParams.set('type', 'issue');
  url.searchParams.set('drn', drn);
  url.searchParams.set('sourceId', sourceId);
  return url.toString();
}

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'private, no-store',
    },
  });
}

function escAttr(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unresolvedPage(fallback, reason = 'No he podido obtener el enlace móvil de Marvel.') {
  const safe = escAttr(fallback);
  const text = escAttr(reason);
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marvel Unlimited</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px}a{display:block;margin-top:20px;padding:14px;border-radius:14px;background:#fff;color:#333;border:1px solid #ddd8cf;text-decoration:none;font-weight:800}p{color:#74747b;font-size:13px;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><h2>El número está localizado</h2><p>${text}</p><a href="${safe}">Abrir este número en la web</a></div></body></html>`, {
    status: 502,
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
      if (!issueUrl) return unresolvedPage(lucky, 'No he podido localizar la ficha oficial exacta.');

      const sourceId = sourceIdFromIssueUrl(issueUrl);
      const marvelHtml = await fetchHtml(issueUrl);
      const { readerId, webUrl } = extractReaderData(marvelHtml, issueUrl);
      if (!readerId) return unresolvedPage(webUrl, 'Marvel no publica readerId para este número.');

      const drn = await resolveLegacyDrn(readerId);
      if (!drn) return unresolvedPage(webUrl, 'Marvel no ha devuelto el DRN asociado a este número.');

      const smartLink = buildSmartLink(drn, sourceId);
      if (!smartLink) return unresolvedPage(webUrl, 'Falta el identificador necesario para construir el Smart Link.');

      if (mode === 'debug') {
        return Response.json({ title, issue, year, issueUrl, sourceId, readerId, drn, smartLink, webUrl }, { headers: { 'Cache-Control': 'no-store' } });
      }

      // iOS y Android usan el mismo Smart Link oficial de Marvel. El servicio
      // decide la app/plataforma y conserva el número mediante DRN + sourceId.
      if (mode === 'ios' || mode === 'android') return redirect(smartLink);

      return redirect(webUrl);
    } catch (error) {
      console.error('Marvel resolver:', error);
      return unresolvedPage(lucky, 'Se ha producido un error al construir el enlace de Marvel Unlimited.');
    }
  },
};
