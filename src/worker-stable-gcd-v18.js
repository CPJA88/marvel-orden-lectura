import stableWorker from './worker-stable.js';
import gcdWorker from './worker-neighbor-gcd-v16.js';

const RESOLVER_VERSION=10;

function jsonUnknown(title,issue,year){
  return Response.json({
    title,issue,year,
    resolverVersion:RESOLVER_VERSION,
    resolverSource:'stable-interactive-only',
    available:false,
    issueUrl:'',sourceId:'',readerId:'',drn:'',smartLink:'',coverUrl:'',pageTitle:'',
    reason:'not-verified',
    diagnosticCode:'LOOKUP_UNRESOLVED'
  },{headers:{'Cache-Control':'no-store'}});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);

    if(url.pathname==='/api/gcd/cover'){
      return gcdWorker.fetch(request,env,ctx);
    }

    if(url.pathname==='/api/marvel/open'){
      const mode=(url.searchParams.get('mode')||'web').toLowerCase();
      const title=(url.searchParams.get('title')||'').trim();
      const issue=(url.searchParams.get('issue')||'').trim();
      const year=(url.searchParams.get('year')||'').trim();

      // El botón interactivo conserva exactamente el resolver estable que ya
      // fue comprobado abriendo Marvel Unlimited correctamente.
      if(mode==='app'||mode==='ios'||mode==='android'||mode==='web'){
        return stableWorker.fetch(request,env,ctx);
      }

      // No hacemos búsquedas masivas desde Cloudflare: Google/Marvel terminan
      // bloqueando la IP compartida. La disponibilidad queda como desconocida
      // hasta que exista una ficha positiva ya cacheada o el usuario abra el número.
      if(mode==='meta'||mode==='debug'||mode==='diagnostic'){
        return jsonUnknown(title,issue,year);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
