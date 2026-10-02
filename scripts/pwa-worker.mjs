import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
export async function writeServiceWorker(root) {
  const assets = ["index.html"];
  for (const dir of ["src", "public"])
    for (const file of await readdir(path.join(root, dir)))
      if (/\.(js|css|svg|png|webmanifest)$/.test(file))
        assets.push(`${dir}/${file}`);
  const hash = createHash("sha256");
  for (const file of assets) hash.update(await readFile(path.join(root, file)));
  const version = hash.digest("hex").slice(0, 16);
  const source = `const VERSION=${JSON.stringify(version)};
const FILES=${JSON.stringify(assets)};
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
`;
  await writeFile(path.join(root, "sw.js"), source);
  return version;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const version = await writeServiceWorker(
    path.resolve(import.meta.dirname, ".."),
  );
  console.log("LiraSnap offlinepaket: " + version);
}
