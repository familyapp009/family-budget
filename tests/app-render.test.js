import test from "node:test";
import assert from "node:assert/strict";

// Real render smoke test, not merely a syntax check: catches deleted UI bindings
// referenced from template expressions (e.g., the former undoNotice regression).
test("sample dashboard renders complete purchase history with swipe actions", async () => {
  const app={innerHTML:""}, header={innerHTML:""};
  const elements={"#app":app,"#header-tools":header};
  const originalDocument=globalThis.document;
  const originalLocation=globalThis.location;
  const originalLocalStorage=globalThis.localStorage;
  const month=new Date().getFullYear()+"-"+String(new Date().getMonth()+1).padStart(2,"0");
  const store=new Map([[
    "family-budget:expense-draft:demo:"+month,
    JSON.stringify({month,saved_at:Date.now(),amount:"5.49",currency:"USD",category:"",date:month+"-01",note:"Subway"})
  ]]);
  try {
    globalThis.location={search:"?demo=1"};
    globalThis.localStorage={
      getItem:key=>store.has(key)?store.get(key):null,
      setItem:(key,value)=>store.set(key,String(value)),
      removeItem:key=>store.delete(key)
    };
    globalThis.document={
      documentElement:{dataset:{}},
      querySelector(selector){return elements[selector] ?? null;},
      addEventListener(){}
    };
    await import("../app.js");
    assert.match(app.innerHTML,/Family Budget|Household spending/);
    assert.match(app.innerHTML,/data-action="repeat-expense"/);
    assert.match(app.innerHTML,/data-action="toggle-purchase-actions"/);
    assert.match(app.innerHTML,/data-action="delete-expense"/);
    assert.match(app.innerHTML,/data-action="edit-expense"/);
    assert.doesNotMatch(app.innerHTML,/Can't find variable|undoNotice/);
    assert.match(header.innerHTML,/data-action="reload-app"/);
    assert.match(app.innerHTML,/id="purchase-form"/);
    assert.match(app.innerHTML,/value="5\.49"/);
    assert.match(app.innerHTML,/value="Subway"/);
    assert.match(app.innerHTML,/Draft stays on this device if you switch to another app/);
  } finally {
    globalThis.document=originalDocument;
    globalThis.location=originalLocation;
    globalThis.localStorage=originalLocalStorage;
  }
});
