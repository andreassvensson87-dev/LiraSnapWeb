const VERSION="74493011f08cfd87";
const FILES=["index.html","src/app.js","src/core.js","src/editing.js","src/export.js","src/icons.js","src/pwa.js","src/render.js","src/storage.js","src/style.css","src/tool-menu.js","src/tracking.js","public/apple-touch-icon.png","public/favicon-32.png","public/icon-192.png","public/icon-512.png","public/lira-icon.svg","public/manifest.webmanifest"];
const PREFIX='lirasnap-'+encodeURIComponent(self.registration.scope)+'-';
const CACHE=PREFIX+VERSION;
const URLS=FILES.map(file=>new URL(file,self.registration.scope).href);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(URLS))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith(PREFIX)&&name!==CACHE)await caches.delete(name);
 await self.clients.claim();
})()));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')event.waitUntil(self.skipWaiting());});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const requestUrl=new URL(event.request.url);
 if(!requestUrl.href.startsWith(self.registration.scope))return;
 const url=event.request.mode==='navigate'?new URL('index.html',self.registration.scope).href:requestUrl.href;
 if(!URLS.includes(url))return;
 const fresh=requestUrl.pathname.endsWith('.webmanifest')||['localhost','127.0.0.1'].includes(requestUrl.hostname);
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  if(fresh){try{const response=await fetch(event.request);if(response.ok){await cache.put(url,response.clone());return response;}}catch{}}
  const cached=await cache.match(url);if(cached)return cached;
  return fetch(event.request);
 })());
});
