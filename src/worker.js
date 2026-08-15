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

// IMPORTANTE: este es deliberadamente el algoritmo de selección de v1.1.4,
// la última versión que el usuario confirmó que resolvía correctamente los números.
function scoreCandidate(html, title, issue, year) {
  const heading = normalize(extractHeading(html));
  const wantedTitle = normalize(title);
  let score = 0;
  if (wantedTitle && heading.includes(wantedTitle)) score += 8;
  const issueToken = normalize(`#${issue}`);
  if (issue && heading.includes(issueToken)) score += 4;
  if (year && heading.includes(String(year))) score += 3;
  return score;
}

function extractDigitalLinks(html, issueUrl) {
  const clean = unescapeMarvelHtml(html);
  const mobileMatch = clean.match(/https:\/\/applink\.marvel\.com\/issue\/(\d+)/i);
  const readerMatch = clean.match(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/i);

  // NO se transforman ni intercambian IDs: cada plataforma conserva el ID que
  // Marvel publicó para ese mismo cómic.
  const mobileId = mobileMatch?.[1] || '';
  const readerId = readerMatch?.[1] || '';

  return {
    issueUrl,
    mobileId,
    readerId,
    digitalId: mobileId || readerId,
    webUrl: readerMatch?.[0] || issueUrl,
    iosUrl: mobileId ? `marvelunlimited://reader/${mobileId}` : issueUrl,
    androidUrl: mobileId
      ? `intent://reader/${mobileId}#Intent;scheme=marvelunlimited;package=com.marvel.unlimited;S.browser_fallback_url=${encodeURIComponent(readerMatch?.[0] || issueUrl)};end`
      : issueUrl,
  };
}

async function resolveMarvelComic(title, issue, year) {
  const queryUrl = searchUrl(title, issue, year);
  const searchHtml = await getText(queryUrl);
  const candidates = extractIssueUrls(searchHtml).slice(0, 8);
  if (!candidates.length) {
    return { issueUrl: queryUrl, mobileId: '', readerId: '', webUrl: queryUrl, iosUrl: queryUrl, androidUrl: queryUrl, digitalId: '' };
  }

  const checked = await Promise.allSettled(candidates.map(async (url) => {
    const html = await getText(url);
    return { url, html, score: scoreCandidate(html, title, issue, year) };
  }));

  const usable = checked.filter(x => x.status === 'fulfilled').map(x => x.value);
  if (!usable.length) {
    return { issueUrl: candidates[0], mobileId: '', readerId: '', webUrl: candidates[0], iosUrl: candidates[0], androidUrl: candidates[0], digitalId: '' };
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

function mobileLauncher(target, fallback, label) {
  const targetAttr = String(target).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const fallbackAttr = String(fallback).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const targetJs = JSON.stringify(target).replace(/</g, '\\u003c');

  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Marvel Unlimited</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px}.spinner{width:30px;height:30px;margin:24px auto;border:3px solid #ddd8cf;border-top-color:#e62429;border-radius:50%;animation:s .8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}a{display:block;margin-top:14px;padding:14px;border-radius:14px;text-decoration:none;font-weight:800}.app{background:#e62429;color:#fff}.web{background:#fff;color:#333;border:1px solid #ddd8cf}p{color:#74747b;font-size:13px;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><div class="spinner"></div><h2>Abriendo Marvel Unlimited</h2><p>El número ha sido resuelto con el identificador original de Marvel.</p><a class="app" href="${targetAttr}">${label}</a><a class="web" href="${fallbackAttr}">Abrir este mismo número en la web</a></div><script>const target=${targetJs};let left=false;document.addEventListener('visibilitychange',()=>{if(document.hidden)left=true});setTimeout(()=>{location.href=target},100);setTimeout(()=>{if(!left)document.querySelector('.spinner').style.display='none'},1700);</script></body></html>`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
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

    const fallback = searchUrl(title, issue, year);
    try {
      const comic = await resolveMarvelComic(title, issue, year);

      if (mode === 'ios' && comic.mobileId) {
        return mobileLauncher(comic.iosUrl, comic.webUrl || comic.issueUrl || fallback, 'Abrir Marvel Unlimited en iOS');
      }
      if (mode === 'android' && comic.mobileId) {
        return mobileLauncher(comic.androidUrl, comic.webUrl || comic.issueUrl || fallback, 'Abrir Marvel Unlimited en Android');
      }
      return redirect(comic.webUrl || comic.issueUrl || fallback);
    } catch (error) {
      console.error('Marvel resolver:', error);
      return redirect(fallback);
    }
  },
};
