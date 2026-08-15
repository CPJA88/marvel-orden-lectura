const MARVEL_ORIGIN = 'https://www.marvel.com';

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&amp;/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalTitle(value = '') {
  let text = String(value).trim();
  const trailingArticle = text.match(/^(.*),\s*(The|A|An)$/i);
  if (trailingArticle) text = `${trailingArticle[2]} ${trailingArticle[1]}`;
  return normalize(text);
}

function canonicalIssue(value = '') {
  const raw = String(value)
    .replace(/^#\s*/, '')
    .replace(/\s+/g, '')
    .toUpperCase();
  if (/^\d+$/.test(raw)) return String(Number(raw));
  return raw;
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
      'User-Agent': 'Mozilla/5.0 (compatible; MarvelLectura/1.1)',
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

function parseMarvelHeading(heading = '') {
  // Formato habitual oficial: "The Amazing Spider-Man (2014) #9"
  const match = String(heading).trim().match(/^(.*?)\s*\((\d{4})(?:\s*-\s*\d{4})?\)\s*#\s*(.+?)\s*$/i);
  if (!match) return null;
  return {
    title: match[1].trim(),
    year: match[2],
    issue: match[3].trim(),
  };
}

function extractPublishedDate(html) {
  const clean = unescapeMarvelHtml(html);
  const patterns = [
    /["']published["']\s*:\s*["'](\d{4}-\d{2}-\d{2})["']/i,
    /["']datePublished["']\s*:\s*["'](\d{4}-\d{2}-\d{2})["']/i,
    /["']publishDate["']\s*:\s*["'](\d{4}-\d{2}-\d{2})["']/i,
  ];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match) return match[1];
  }
  return '';
}

function titleSimilarity(a, b) {
  const left = canonicalTitle(a);
  const right = canonicalTitle(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.9;
  const A = new Set(left.split(' '));
  const B = new Set(right.split(' '));
  let common = 0;
  for (const token of A) if (B.has(token)) common++;
  return common / new Set([...A, ...B]).size;
}

function inspectCandidate(html, requested) {
  const heading = extractHeading(html);
  const parsed = parseMarvelHeading(heading);
  if (!parsed) return { valid: false, reason: 'heading-unparseable', heading };

  const requestedIssue = canonicalIssue(requested.issue);
  const candidateIssue = canonicalIssue(parsed.issue);
  if (requestedIssue && candidateIssue !== requestedIssue) {
    return { valid: false, reason: 'issue-mismatch', heading, parsed };
  }
  if (requested.year && String(parsed.year) !== String(requested.year)) {
    return { valid: false, reason: 'year-mismatch', heading, parsed };
  }

  const similarity = titleSimilarity(requested.title, parsed.title);
  if (similarity < 0.72) {
    return { valid: false, reason: 'title-mismatch', heading, parsed, similarity };
  }

  const published = extractPublishedDate(html);
  let score = Math.round(similarity * 100);
  if (canonicalTitle(requested.title) === canonicalTitle(parsed.title)) score += 40;
  if (requested.date && published && requested.date === published) score += 80;
  else if (requested.date && published && requested.date.slice(0, 7) === published.slice(0, 7)) score += 15;

  return { valid: true, heading, parsed, published, similarity, score };
}

function extractDigitalLinks(html, issueUrl) {
  const clean = unescapeMarvelHtml(html);
  const readerMatch = clean.match(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/i);
  const legacyMobileMatch = clean.match(/https:\/\/applink\.marvel\.com\/issue\/(\d+)/i);
  const readerId = readerMatch?.[1] || '';
  const mobileId = legacyMobileMatch?.[1] || readerId;
  const digitalId = readerId || mobileId;
  return {
    found: true,
    issueUrl,
    digitalId,
    readerId,
    mobileId,
    webUrl: readerId ? `https://read.marvel.com/#/book/${readerId}` : issueUrl,
    iosUrl: mobileId ? `marvelunlimited://reader/${mobileId}` : issueUrl,
    androidUrl: mobileId
      ? `intent://reader/${mobileId}#Intent;scheme=marvelunlimited;package=com.marvel.unlimited;S.browser_fallback_url=${encodeURIComponent(readerId ? `https://read.marvel.com/#/book/${readerId}` : issueUrl)};end`
      : issueUrl,
  };
}

function notFoundResult(fallback, reason = 'no-exact-match') {
  return {
    found: false,
    reason,
    issueUrl: fallback,
    webUrl: fallback,
    iosUrl: fallback,
    androidUrl: fallback,
    digitalId: '',
    readerId: '',
    mobileId: '',
  };
}

async function resolveMarvelComic(title, issue, year, date = '') {
  const requested = { title, issue, year, date };
  const queryUrl = searchUrl(title, issue, year);
  const searchHtml = await getText(queryUrl);
  const candidates = extractIssueUrls(searchHtml).slice(0, 12);
  if (!candidates.length) return notFoundResult(queryUrl, 'no-candidates');

  const checked = await Promise.allSettled(candidates.map(async (url) => {
    const html = await getText(url);
    const inspection = inspectCandidate(html, requested);
    return { url, html, ...inspection };
  }));

  const valid = checked
    .filter(x => x.status === 'fulfilled' && x.value.valid)
    .map(x => x.value)
    .sort((a, b) => b.score - a.score);

  if (!valid.length) return notFoundResult(queryUrl, 'no-exact-match');

  // Si dos candidatos empatan con distinta ficha, no arriesgamos a abrir uno incorrecto.
  if (valid.length > 1 && valid[0].score === valid[1].score && valid[0].url !== valid[1].url) {
    return notFoundResult(queryUrl, 'ambiguous-match');
  }

  const best = valid[0];
  return {
    ...extractDigitalLinks(best.html, best.url),
    matchedHeading: best.heading,
    matchedPublished: best.published,
    matchScore: best.score,
  };
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
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Abriendo Marvel Unlimited…</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:white;padding:5px 8px;font-weight:900;font-size:22px;letter-spacing:-1px}.spinner{width:30px;height:30px;margin:24px auto;border:3px solid #ddd8cf;border-top-color:#e62429;border-radius:50%;animation:s .8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}a{display:block;margin-top:14px;padding:14px;border-radius:14px;text-decoration:none;font-weight:800}.app{background:#e62429;color:#fff}.web{background:#fff;color:#333;border:1px solid #ddd8cf}p{color:#74747b;font-size:13px;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><div class="spinner"></div><h2>Abriendo Marvel Unlimited</h2><p>Coincidencia exacta verificada. Si la aplicación no se abre automáticamente, pulsa el botón.</p><a class="app" id="openApp" href="${target.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">${label}</a><a class="web" href="${fallback.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">Abrir este número en la web</a></div><script>const target=${safeTarget};let left=false;document.addEventListener('visibilitychange',()=>{if(document.hidden)left=true});setTimeout(()=>{location.href=target},80);setTimeout(()=>{if(!left)document.querySelector('.spinner').style.display='none'},1600);</script></body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function exactMatchMissing(fallback) {
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Número no localizado</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px}.search{display:block;margin-top:20px;padding:14px;border-radius:14px;background:#fff;color:#333;border:1px solid #ddd8cf;text-decoration:none;font-weight:800}p{color:#74747b;font-size:13px;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><h2>No he localizado una coincidencia exacta</h2><p>Para evitar abrir un número distinto, la app no continuará automáticamente.</p><a class="search" href="${fallback.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">Buscar manualmente en Marvel</a></div></body></html>`, {
    status: 404,
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
    const date = (url.searchParams.get('date') || '').trim();
    if (!title) return new Response('Falta el título del cómic.', { status: 400 });

    const fallback = searchUrl(title, issue, year);
    try {
      const comic = await resolveMarvelComic(title, issue, year, date);

      if (url.pathname === '/api/marvel/resolve') return json(comic);

      if (url.pathname === '/api/marvel/open') {
        if (!comic.found) return exactMatchMissing(fallback);
        const mode = (url.searchParams.get('mode') || 'web').toLowerCase();
        if (mode === 'ios' && comic.mobileId) {
          return mobileLauncher(comic.iosUrl, comic.webUrl, 'Abrir Marvel Unlimited en iOS');
        }
        if (mode === 'android' && comic.mobileId) {
          return mobileLauncher(comic.androidUrl, comic.webUrl, 'Abrir Marvel Unlimited en Android');
        }
        return redirect(comic.webUrl || comic.issueUrl || fallback);
      }

      return new Response('Ruta no encontrada.', { status: 404 });
    } catch (error) {
      console.error('Marvel resolver:', error);
      if (url.pathname === '/api/marvel/resolve') return json(notFoundResult(fallback, 'resolver-error'));
      return exactMatchMissing(fallback);
    }
  },
};
