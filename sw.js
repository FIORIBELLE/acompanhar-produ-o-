"use strict";
const CACHE="acompanhar-producao-shell-v17";
const SHELL=["./","./index.html","./manifest.webmanifest","./inventory-guard.js"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE&&(key.startsWith("producao-semanal-")||key.startsWith("acompanhar-producao-"))).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  const scopePath=new URL(self.registration.scope).pathname;
  const relative=url.pathname.slice(scopePath.length);
  const isAppNavigation=request.mode==="navigate"&&(relative===""||relative==="index.html");
  const isShellFile=SHELL.some(item=>new URL(item,self.registration.scope).pathname===url.pathname);
  if(isAppNavigation){
    event.respondWith(fetch(request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put("./index.html",copy));return response}).catch(()=>caches.match("./index.html")));
    return;
  }
  if(isShellFile)event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));return response})));
});
