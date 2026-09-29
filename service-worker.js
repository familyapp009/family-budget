// Family Budget must not start from an obsolete Home Screen snapshot.
// This is intentionally network-only. The app cannot safely edit its shared
// Supabase budget offline, and displaying stale application code is worse.
self.addEventListener("install",event=>{ event.waitUntil(self.skipWaiting()); });
self.addEventListener("activate",event=>{ event.waitUntil(self.clients.claim()); });

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  const scope=new URL(self.registration.scope);
  if(url.origin!==scope.origin || !url.pathname.startsWith(scope.pathname))return;
  if(request.mode!=="navigate" && !/\.(?:html|js|css)$/.test(url.pathname))return;

  // A different URL on each load bypasses old iOS and CDN cached copies,
  // even if the Home Screen icon retains its original bookmark URL.
  url.searchParams.set("_swfresh",String(Date.now()));
  event.respondWith(fetch(url.href,{cache:"no-store",credentials:"same-origin"}));
});
