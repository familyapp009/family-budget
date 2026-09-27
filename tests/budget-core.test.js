import test from "node:test";
import assert from "node:assert/strict";
import {parseAmount, usdCents, shiftMonth, overview, sameMonth} from "../budget-core.js";
test("currency and invalid amounts", () => {
  assert.equal(parseAmount("75"), 7500);
  assert.equal(parseAmount("75.05"), 7505);
  assert.equal(usdCents(7500, "EUR", 1.14), 8550);
  assert.equal(usdCents(7500, "USD", 1.14), 7500);
  assert.throws(() => parseAmount("12.345"));
  assert.throws(() => parseAmount("-12"));
});
test("months move across year boundaries and validate expense date", () => {
  assert.equal(shiftMonth("2026-12",1),"2027-01");
  assert.equal(shiftMonth("2026-01",-1),"2025-12");
  assert.equal(sameMonth("2026-02-30","2026-02"), false);
  assert.equal(sameMonth("2026-02-28","2026-02"), true);
  assert.equal(sameMonth("2026-03-01","2026-02"), false);
});
test("guidelines can go negative and do not alter overall remaining", () => {
  const plan = {net_income_cents:800000, fixed_costs_cents:300000};
  const g = [{category:"Groceries",target_cents:10000},{category:"Dining",target_cents:5000}];
  const purchases = [{category:"Groceries",usd_cents:13000},{category:"Dining",usd_cents:2000}];
  const result = overview(plan,g,purchases);
  assert.equal(result.starting,500000);
  assert.equal(result.remaining,485000);
  assert.equal(result.categories[0].remaining,-3000);
  assert.equal(result.categories[1].remaining,3000);
});
