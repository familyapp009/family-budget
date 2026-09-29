import test from "node:test";
import assert from "node:assert/strict";

// Real render smoke test, not merely a syntax check: catches deleted UI bindings
// referenced from template expressions (e.g., the former undoNotice regression).
test("sample dashboard renders complete purchase history with swipe actions", async () => {
  const app={innerHTML:""}, header={innerHTML:""};
  const elements={"#app":app,"#header-tools":header};
  const originalDocument=globalThis.document;
  const originalLocation=globalThis.location;
  try {
    globalThis.location={search:"?demo=1"};
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
  } finally {
    globalThis.document=originalDocument;
    globalThis.location=originalLocation;
  }
});
