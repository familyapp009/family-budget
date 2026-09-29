import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

test("entrypoint bypasses cached JS and installs network-only worker",async()=>{
  const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
  assert.match(html,/name="application-version"/);
  assert.match(html,/serviceWorker\.register\("\.\/service-worker\.js"/);
  assert.match(html,/entry\.searchParams\.set\("startup",String\(Date\.now\(\)\)\)/);
  assert.doesNotMatch(html,/<script[^>]+src="\.\/*app\.js/);
});

test("worker fetches fresh app launch and JS without caching private or third-party requests",async()=>{
  const script=await readFile(new URL("../service-worker.js",import.meta.url),"utf8");
  const listeners=new Map(), fetches=[];
  const worker={
    registration:{scope:"https://familyapp009.github.io/family-budget/"},
    addEventListener:(name,callback)=>listeners.set(name,callback),
    skipWaiting:()=>Promise.resolve(),clients:{claim:()=>Promise.resolve()}
  };
  runInNewContext(script,{
    self:worker,URL,Date,
    fetch:(url,opts)=>{fetches.push({url,opts});return Promise.resolve({ok:true});}
  });
  assert.ok(listeners.has("install"));
  assert.ok(listeners.has("activate"));
  const launch={request:{url:"https://familyapp009.github.io/family-budget/?v=old",
    mode:"navigate",method:"GET"},respondWith(value){this.response=value;}};
  listeners.get("fetch")(launch);
  assert.ok(launch.response);
  await launch.response;
  assert.match(fetches[0].url,/_swfresh=/);
  assert.equal(fetches[0].opts.cache,"no-store");
  const source={request:{url:"https://familyapp009.github.io/family-budget/app.js?v=old",
    mode:"cors",method:"GET"},respondWith(value){this.response=value;}};
  listeners.get("fetch")(source);
  await source.response;
  assert.match(fetches[1].url,/app\.js\?.*_swfresh=/);
  const foreign={request:{url:"https://qpnpttoebnyzljdaqgud.supabase.co/rest/v1/purchases",
    mode:"cors",method:"GET"},respondWith(){throw Error("Must not intercept Supabase");}};
  listeners.get("fetch")(foreign);
  assert.equal(fetches.length,2);
});
