/* Marvel Lector v1.3.0 — apertura directa de Marvel Unlimited en Android */
((root)=>{
  const SMART_HOST='marvel.smart.link';
  const SMART_PATH='/fiir7ec77';
  const ANDROID_PACKAGE='com.marvel.unlimited';

  function isAndroid(userAgent){
    const ua=userAgent??root.navigator?.userAgent??'';
    return /Android/i.test(String(ua))||String(root.navigator?.userAgentData?.platform||'').toLowerCase()==='android';
  }
  function verifiedSmartLink(value){
    try{const url=new URL(String(value));return url.protocol==='https:'&&url.hostname===SMART_HOST&&url.pathname===SMART_PATH?url:null}catch{return null}
  }
  function smartLinkFromMeta(meta){
    const drn=String(meta?.drn||'').trim(),sourceId=String(meta?.sourceId||'').replace(/\D/g,'');
    if(!/^drn:src:marvel:unison::prod:[0-9a-f-]{36}$/i.test(drn)||!sourceId)return'';
    const url=new URL(`https://${SMART_HOST}${SMART_PATH}`);
    url.searchParams.set('type','issue');url.searchParams.set('drn',drn);url.searchParams.set('sourceId',sourceId);
    return url.toString();
  }
  function browserFallback(meta){
    const readerId=String(meta?.readerId||'').replace(/\D/g,''),sourceId=String(meta?.sourceId||'').replace(/\D/g,'');
    if(readerId)return`https://read.marvel.com/#/book/${readerId}`;
    const web=String(meta?.webUrl||'');
    try{const url=new URL(web);if(url.protocol==='https:'&&(url.hostname==='read.marvel.com'||url.hostname==='www.marvel.com'))return url.toString()}catch{}
    if(sourceId)return`https://www.marvel.com/comics/issue/${sourceId}`;
    return'https://www.marvel.com/unlimited';
  }
  function androidIntent(smartLink,fallback){
    const url=verifiedSmartLink(smartLink);if(!url)return String(smartLink||'');
    const target=`${url.host}${url.pathname}${url.search}`;
    return`intent://${target}#Intent;scheme=https;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
  }
  function launchHref(baseHref,meta,userAgent){
    if(!isAndroid(userAgent))return baseHref;
    const smart=verifiedSmartLink(baseHref)?.toString()||smartLinkFromMeta(meta);
    return smart?androidIntent(smart,browserFallback(meta)):baseHref;
  }

  root.MarvelAndroidUnlimited={isAndroid,verifiedSmartLink,smartLinkFromMeta,browserFallback,androidIntent,launchHref};
  if(typeof stableAppHref==='function'){
    const base=stableAppHref;
    stableAppHref=function(issue,series){
      const href=base(issue,series),meta=typeof state!=='undefined'&&state?.marvel?state.marvel.get(Number(issue?.id)):null;
      return launchHref(href,meta);
    };
  }
})(globalThis);

