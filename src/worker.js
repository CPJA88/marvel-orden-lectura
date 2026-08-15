const MARVEL_ORIGIN = 'https://www.marvel.com';

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&amp;/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function unescapeMarvelHtml(value = '') {
  return value
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');
}

async function getText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MarvelLectura/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`Marvel respondió ${response.status}`);
  return response.text();
}

function searchUrl(title, issue, year) {
  const query = `${title}${year ? ` (${year})` : ''}${issue ? ` #${issue}` : ''}`.trim();
  return `${MARVEL_ORIGIN}/search?content_type=comics&query=${encodeURIComponent(query)}`;
}

function extractIssueUrls(html) {
  const clean = unescapeMarvelHtml(html);
  const matches = clean.match(/(?:https:\/\/www\.marvel\.com)?\/comics\/issue\/\d+\/[a-z0-9_()%.\-]+/gi) || [];
  const unique = [];
  const seen = new Set();
  for (const match of matches) {
    const url = match.startsWith('http') ? match : `${MARVEL_ORIGIN}${match}`;
    const canonical = url.split('?')[0];
    if (!seen.has(canonical)) {
      seen.add(canonical);
      unique.push(canonical);
    }
  }
  return unique;
}

function extractHeading(html) {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) return '';
  return match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function scoreCandidate(html, title, issue, year) {
  const heading = normalize(extractHeading(html));
  const wantedTitle = normalize(title);
  let score = 0;
  if (wantedTitle && heading.includes(wantedTitle)) score += 8;
  if (issue && heading.includes(normalize(`#${issue}`))) score += 4;
  if (year && heading.includes(String(year))) score += 3;
  return score;
}

function extractDigitalLinks(html, issueUrl) {
  const clean = unescapeMarvelHtml(html);
  // Marvel sigue publicando reader_url en sus datos, mientras que el antiguo
  // applink.marvel.com ya no resuelve. El ID del lector es suficiente para
  // construir los enlaces nativos de Marvel Unlimited.
  const readerMatch = clean.match(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/i);
  const digitalId = readerMatch?.[1] || '';
  return {
    issueUrl,
    digitalId,
    webUrl: digitalId ? `https://read.marvel.com/#/book/${digitalId}` : issueUrl,
    iosUrl: digitalId ? `marvelunlimited://reader/${digitalId}` : issueUrl,
    androidUrl: digitalId
      ? `intent://reader/${digitalId}#Intent;scheme=marvelunlimited;package=com.marvel.unlimited;S.browser_fallback_url=${encodeURIComponent(`https://read.marvel.com/#/book/${digitalId}`)};end`
      : issueUrl,
  };
}

async function resolveMarvelComic(title, issue, year) {
  const queryUrl = searchUrl(title, issue, year);
  const searchHtml = await getText(queryUrl);
  const candidates = extractIssueUrls(searchHtml).slice(0, 8);
  if (!candidates.length) {
    return { issueUrl: queryUrl, webUrl: queryUrl, iosUrl: queryUrl, androidUrl: queryUrl, digitalId: '' };
  }

  const checked = await Promise.allSettled(candidates.map(async (url) => {
    const html = await getText(url);
    return { url, html, score: scoreCandidate(html, title, issue, year) };
  }));
  const usable = checked.filter(x => x.status === 'fulfilled').map(x => x.value);
  if (!usable.length) {
    return { issueUrl: candidates[0], webUrl: candidates[0], iosUrl: candidates[0], androidUrl: candidates[0], digitalId: '' };
  }
  usable.sort((a, b) => b.score - a.score);
  const best = usable[0];
  return extractDigitalLinks(best.html, best.url);
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

function mobileLauncher(target, fallback, label) {
  const safeTarget = JSON.stringify(target).replace(/</g, '\\u003c');
  const safeFallback = JSON.stringify(fallback).replace(/</g, '\\u003c');
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Abriendo Marvel Unlimited…</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:white;padding:5px 8px;font-weight:900;font-size:22px;letter-spacing:-1px}.spinner{width:30px;height:30px;margin:24px auto;border:3px solid #ddd8cf;border-top-color:#e62429;border-radius:50%;animation:s .8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}a{display:block;margin-top:14px;padding:14px;border-radius:14px;text-decoration:none;font-weight:800}.app{background:#e62429;color:#fff}.web{background:#fff;color:#333;border:1px solid #ddd8cf}p{color:#74747b;font-size:13px;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><div class="spinner"></div><h2>Abriendo Marvel Unlimited</h2><p>Si la aplicación no se abre automáticamente, pulsa el botón.</p><a class="app" id="openApp" href="${target.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">${label}</a><a class="web" href="${fallback.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">Abrir en la web</a></div><script>const target=${safeTarget},fallback=${safeFallback};let left=false;document.addEventListener('visibilitychange',()=>{if(document.hidden)left=true});setTimeout(()=>{location.href=target},80);setTimeout(()=>{if(!left)document.querySelector('.spinner').style.display='none'},1600);</script></body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/marvel/')) return env.ASSETS.fetch(request);

    const title = (url.searchParams.get('title') || '').trim();
    const issue = (url.searchParams.get('issue') || '').trim();
    const year = (url.searchParams.get('year') || '').trim();
    if (!title) return new Response('Falta el título del cómic.', { status: 400 });

    const fallback = searchUrl(title, issue, year);
    try {
      const comic = await resolveMarvelComic(title, issue, year);

      if (url.pathname === '/api/marvel/resolve') return json(comic);

      if (url.pathname === '/api/marvel/open') {
        const mode = (url.searchParams.get('mode') || 'web').toLowerCase();
        if (mode === 'ios' && comic.digitalId) {
          return mobileLauncher(comic.iosUrl, comic.webUrl, 'Abrir Marvel Unlimited en iOS');
        }
        if (mode === 'android' && comic.digitalId) {
          return mobileLauncher(comic.androidUrl, comic.webUrl, 'Abrir Marvel Unlimited en Android');
        }
        return redirect(comic.webUrl || comic.issueUrl || fallback);
      }

      return new Response('Ruta no encontrada.', { status: 404 });
    } catch (error) {
      console.error('Marvel resolver:', error);
      if (url.pathname === '/api/marvel/resolve') {
        return json({ issueUrl: fallback, webUrl: fallback, iosUrl: fallback, androidUrl: fallback, digitalId: '' }, 200);
      }
      return redirect(fallback);
    }
  },
};
