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
  const issueToken = normalize(`#${issue}`);
  if (issue && heading.includes(issueToken)) score += 4;
  if (year && heading.includes(String(year))) score += 3;
  return score;
}

function extractDigitalLinks(html, issueUrl) {
  const clean = unescapeMarvelHtml(html);
  const mobileMatch = clean.match(/https:\/\/applink\.marvel\.com\/issue\/(\d+)/i);
  const readerMatch = clean.match(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/i);
  const digitalId = mobileMatch?.[1] || readerMatch?.[1] || '';
  return {
    issueUrl,
    digitalId,
    mobileUrl: mobileMatch?.[0] || (digitalId ? `https://applink.marvel.com/issue/${digitalId}` : issueUrl),
    webUrl: readerMatch?.[0] || issueUrl,
  };
}

async function resolveMarvelComic(title, issue, year) {
  const queryUrl = searchUrl(title, issue, year);
  const searchHtml = await getText(queryUrl);
  const candidates = extractIssueUrls(searchHtml).slice(0, 8);
  if (!candidates.length) return { issueUrl: queryUrl, mobileUrl: queryUrl, webUrl: queryUrl, digitalId: '' };

  const checked = await Promise.allSettled(candidates.map(async (url) => {
    const html = await getText(url);
    return { url, html, score: scoreCandidate(html, title, issue, year) };
  }));
  const usable = checked.filter(x => x.status === 'fulfilled').map(x => x.value);
  if (!usable.length) return { issueUrl: candidates[0], mobileUrl: candidates[0], webUrl: candidates[0], digitalId: '' };
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
      if (mode === 'android' || mode === 'ios') return redirect(comic.mobileUrl || comic.issueUrl || fallback);
      return redirect(comic.webUrl || comic.issueUrl || fallback);
    } catch (error) {
      console.error('Marvel resolver:', error);
      return redirect(fallback);
    }
  },
};
