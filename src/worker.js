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

function compact(value = '') {
  return normalize(value).replace(/\s+/g, '');
}

function canonicalTitle(value = '') {
  let text = String(value).trim();
  const trailingArticle = text.match(/^(.*),\s*(The|A|An)$/i);
  if (trailingArticle) text = `${trailingArticle[2]} ${trailingArticle[1]}`;
  return normalize(text);
}

function titleVariants(value = '') {
  const base = canonicalTitle(value);
  const variants = new Set([base]);
  variants.add(base.replace(/^(the|a|an)\s+/, ''));
  variants.add(base.replace(/\band\b/g, ''));
  return [...variants].filter(Boolean);
}

function canonicalIssue(value = '') {
  const raw = String(value)
    .replace(/^#\s*/, '')
    .replace(/\s+/g, '')
    .toUpperCase();
  if (/^\d+$/.test(raw)) return String(Number(raw));
  return raw;
}

function issueCompact(value = '') {
  return canonicalIssue(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function unescapeMarvelHtml(value = '') {
  return String(value)
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function getText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MarvelLectura/1.2)',
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
  const seenIds = new Set();
  for (const match of matches) {
    const absolute = match.startsWith('http') ? match : `${MARVEL_ORIGIN}${match}`;
    const canonical = absolute.split('?')[0].replace(/\/$/, '');
    const id = canonical.match(/\/comics\/issue\/(\d+)/i)?.[1] || canonical;
    if (!seenIds.has(id)) {
      seenIds.add(id);
      unique.push(canonical);
    }
  }
  return unique;
}

function slugFromUrl(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
  } catch {
    return '';
  }
}

function titleSimilarity(a, b) {
  const left = canonicalTitle(a);
  const right = canonicalTitle(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.92;
  const A = new Set(left.split(' ').filter(Boolean));
  const B = new Set(right.split(' ').filter(Boolean));
  let common = 0;
  for (const token of A) if (B.has(token)) common++;
  return common / Math.max(1, new Set([...A, ...B]).size);
}

function urlMatchScore(url, title, issue, year) {
  const slug = normalize(slugFromUrl(url));
  const slugCompact = compact(slug);
  const issueKey = issueCompact(issue);
  const yearKey = String(year || '').replace(/\D/g, '');
  if (!slugCompact || !issueKey) return 0;

  const suffix = `${yearKey}${issueKey}`;
  const titleKeys = titleVariants(title).map(compact);
  let best = 0;

  for (const titleKey of titleKeys) {
    if (!titleKey) continue;
    const expected = `${titleKey}${suffix}`;
    if (yearKey && slugCompact === expected) best = Math.max(best, 1200);
    if (yearKey && slugCompact.endsWith(suffix) && slugCompact.includes(titleKey)) best = Math.max(best, 1100);
    if (!yearKey && slugCompact.endsWith(issueKey) && slugCompact.includes(titleKey)) best = Math.max(best, 950);
  }

  // Marvel a veces compacta o abrevia el título en el slug. Exigimos al menos
  // que el sufijo año+número sea exacto y que haya fuerte solapamiento de título.
  if (yearKey && slugCompact.endsWith(suffix)) {
    const slugTitle = slug.replace(new RegExp(`${yearKey}\\s*${issueKey}$`, 'i'), '').trim();
    if (titleSimilarity(title, slugTitle) >= 0.62) best = Math.max(best, 900);
  }

  return best;
}

function extractTextCandidates(html) {
  const clean = unescapeMarvelHtml(html);
  const values = [];

  const h1 = clean.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (h1) values.push(h1.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

  const pageTitle = clean.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (pageTitle) values.push(pageTitle.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

  const jsonTitleRegex = /["']title["']\s*:\s*["']([^"']{1,180})["']/gi;
  let match;
  while ((match = jsonTitleRegex.exec(clean)) && values.length < 40) values.push(match[1]);

  return [...new Set(values.filter(Boolean))];
}

function parseMarvelLabel(value = '') {
  const text = String(value)
    .replace(/\|\s*Comic Issues\s*\|\s*Marvel.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const match = text.match(/^(.*?)\s*\((\d{4})(?:\s*-\s*\d{4})?\)\s*#\s*([^|]+?)\s*$/i);
  if (!match) return null;
  return { title: match[1].trim(), year: match[2], issue: match[3].trim() };
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

function contentMatchScore(html, requested) {
  const labels = extractTextCandidates(html).map(parseMarvelLabel).filter(Boolean);
  if (!labels.length) return { score: 0, label: null, published: extractPublishedDate(html) };

  const wantedIssue = canonicalIssue(requested.issue);
  let best = 0;
  let bestLabel = null;

  for (const label of labels) {
    if (wantedIssue && canonicalIssue(label.issue) !== wantedIssue) continue;
    const similarity = titleSimilarity(requested.title, label.title);
    if (similarity < 0.58) continue;

    let score = 500 + Math.round(similarity * 250);
    if (String(label.year) === String(requested.year)) score += 180;
    if (canonicalTitle(label.title) === canonicalTitle(requested.title)) score += 120;
    if (score > best) {
      best = score;
      bestLabel = label;
    }
  }

  const published = extractPublishedDate(html);
  if (best && requested.date && published) {
    if (requested.date === published) best += 260;
    else if (requested.date.slice(0, 7) === published.slice(0, 7)) best += 35;
  }

  return { score: best, label: bestLabel, published };
}

function extractDigitalLinks(html, issueUrl) {
  const clean = unescapeMarvelHtml(html);
  const readerMatch = clean.match(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/i);
  const legacyMobileMatch = clean.match(/https:\/\/applink\.marvel\.com\/issue\/(\d+)/i);
  const readerId = readerMatch?.[1] || '';
  const mobileId = legacyMobileMatch?.[1] || readerId;
  return {
    found: true,
    issueUrl,
    readerId,
    mobileId,
    digitalId: readerId || mobileId,
    webUrl: readerId ? `https://read.marvel.com/#/book/${readerId}` : issueUrl,
    iosUrl: mobileId ? `marvelunlimited://reader/${mobileId}` : issueUrl,
    androidUrl: mobileId
      ? `intent://reader/${mobileId}#Intent;scheme=marvelunlimited;package=com.marvel.unlimited;S.browser_fallback_url=${encodeURIComponent(readerId ? `https://read.marvel.com/#/book/${readerId}` : issueUrl)};end`
      : issueUrl,
  };
}

function notFoundResult(fallback, reason = 'no-match') {
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
  const candidates = extractIssueUrls(searchHtml).slice(0, 16);
  if (!candidates.length) return notFoundResult(queryUrl, 'no-candidates');

  // Primera vía: la URL oficial de Marvel ya contiene normalmente serie+año+número.
  // Esto fue lo que hacía fiable el identificador original y no depende de interpretar
  // el HTML de la ficha.
  const rankedByUrl = candidates
    .map(url => ({ url, score: urlMatchScore(url, title, issue, year) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (rankedByUrl.length && rankedByUrl[0].score >= 900) {
    const top = rankedByUrl[0];
    try {
      const html = await getText(top.url);
      const content = contentMatchScore(html, requested);
      // El slug exacto manda; el contenido solo sirve para reforzar/registrar la
      // coincidencia y para extraer el ID digital.
      return {
        ...extractDigitalLinks(html, top.url),
        matchMethod: 'url-slug',
        matchScore: top.score + content.score,
        matchedLabel: content.label,
        matchedPublished: content.published,
      };
    } catch {
      return notFoundResult(queryUrl, 'matched-url-unreadable');
    }
  }

  // Segunda vía para slugs históricos/irregulares: leer las fichas candidatas y
  // exigir número exacto. Nunca se usa includes("1") para #1, por lo que #10/#100
  // no pueden confundirse.
  const checked = await Promise.allSettled(candidates.map(async (url) => {
    const html = await getText(url);
    const content = contentMatchScore(html, requested);
    return { url, html, ...content };
  }));

  const valid = checked
    .filter(x => x.status === 'fulfilled' && x.value.score >= 650)
    .map(x => x.value)
    .sort((a, b) => b.score - a.score);

  if (!valid.length) return notFoundResult(queryUrl, 'no-exact-issue');
  if (valid.length > 1 && valid[0].score === valid[1].score) {
    return notFoundResult(queryUrl, 'ambiguous-match');
  }

  const best = valid[0];
  return {
    ...extractDigitalLinks(best.html, best.url),
    matchMethod: 'content',
    matchScore: best.score,
    matchedLabel: best.label,
    matchedPublished: best.published,
  };
}

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'private, no-store' },
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
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Abriendo Marvel Unlimited…</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:white;padding:5px 8px;font-weight:900;font-size:22px;letter-spacing:-1px}.spinner{width:30px;height:30px;margin:24px auto;border:3px solid #ddd8cf;border-top-color:#e62429;border-radius:50%;animation:s .8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}a{display:block;margin-top:14px;padding:14px;border-radius:14px;text-decoration:none;font-weight:800}.app{background:#e62429;color:#fff}.web{background:#fff;color:#333;border:1px solid #ddd8cf}p{color:#74747b;font-size:13px;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><div class="spinner"></div><h2>Abriendo Marvel Unlimited</h2><p>Número localizado. Si la aplicación no se abre automáticamente, pulsa el botón.</p><a class="app" id="openApp" href="${target.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">${label}</a><a class="web" href="${fallback.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">Abrir este número en la web</a></div><script>const target=${safeTarget};let left=false;document.addEventListener('visibilitychange',()=>{if(document.hidden)left=true});setTimeout(()=>{location.href=target},80);setTimeout(()=>{if(!left)document.querySelector('.spinner').style.display='none'},1600);</script></body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function matchMissing(fallback) {
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Número no localizado</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px}.search{display:block;margin-top:20px;padding:14px;border-radius:14px;background:#fff;color:#333;border:1px solid #ddd8cf;text-decoration:none;font-weight:800}p{color:#74747b;font-size:13px;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><h2>No he localizado este número en Marvel</h2><p>La app no abrirá una ficha distinta como sustitución.</p><a class="search" href="${fallback.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">Buscar manualmente en Marvel</a></div></body></html>`, {
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
        if (!comic.found) return matchMissing(fallback);
        const mode = (url.searchParams.get('mode') || 'web').toLowerCase();
        if (mode === 'ios' && comic.mobileId) return mobileLauncher(comic.iosUrl, comic.webUrl, 'Abrir Marvel Unlimited en iOS');
        if (mode === 'android' && comic.mobileId) return mobileLauncher(comic.androidUrl, comic.webUrl, 'Abrir Marvel Unlimited en Android');
        return redirect(comic.webUrl || comic.issueUrl || fallback);
      }

      return new Response('Ruta no encontrada.', { status: 404 });
    } catch (error) {
      console.error('Marvel resolver:', error);
      if (url.pathname === '/api/marvel/resolve') return json(notFoundResult(fallback, 'resolver-error'));
      return matchMissing(fallback);
    }
  },
};
