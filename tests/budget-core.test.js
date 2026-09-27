import test from "node:test";
import assert from "node:assert/strict";
import {parseAmount, usdCents, shiftMonth, overview, sameMonth, totalFixedObligations, usagePercent} from "../budget-core.js";
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
  const g = [{id:"grocery-id",category:"Groceries",target_cents:10000},{id:"dining-id",category:"Dining",target_cents:5000}];
  const purchases = [{guideline_id:"grocery-id",usd_cents:13000},{guideline_id:"dining-id",usd_cents:2000}];
  const result = overview(plan,g,purchases);
  assert.equal(result.starting,500000);
  assert.equal(result.remaining,485000);
  assert.equal(result.categories[0].spent,13000);
  assert.equal(result.categories[0].remaining,-3000);
  assert.equal(result.categories[0].percent,130);
  assert.equal(result.categories[1].spent,2000);
  assert.equal(result.categories[1].remaining,3000);
  assert.equal(result.categories[1].percent,40);
  assert.equal(result.spent,15000);
  assert.equal(result.percent,3);
});

test("recurring defaults respect currencies and disabled obligations", () => {
  const obligations = [
    {original_amount_cents:10000,currency:"EUR",enabled:true},
    {original_amount_cents:8000,currency:"USD",enabled:true},
    {original_amount_cents:99999,currency:"USD",enabled:false}
  ];
  assert.equal(totalFixedObligations(obligations,1.14),19400);
  assert.equal(totalFixedObligations(obligations,1.2),20000);
  assert.equal(totalFixedObligations([],1.14),0);
  assert.throws(()=>totalFixedObligations(obligations,0));
});

test("category progress follows guideline ID, not a name absent from saved purchases", () => {
  const result=overview({net_income_cents:20000,fixed_costs_cents:0}, [
    {id:"a",category:"Groceries",target_cents:10000},
    {id:"b",category:"Shopping",target_cents:0}
  ],[{guideline_id:"a",usd_cents:5000},{guideline_id:"b",usd_cents:2500}]);
  assert.equal(result.categories[0].spent,5000);
  assert.equal(result.categories[0].percent,50);
  assert.equal(result.categories[1].spent,2500);
  assert.equal(result.categories[1].percent,null);
  assert.equal(result.categories[1].remaining,-2500);
  assert.equal(result.percent,38);
  assert.equal(result.remaining,12500);
});
test("progress reports over-budget percentage without overflowing the visual bar", () => {
  assert.equal(usagePercent(0,10000),0);
  assert.equal(usagePercent(10000,10000),100);
  assert.equal(usagePercent(13500,10000),135);
  assert.equal(usagePercent(500,0),null);
  assert.equal(usagePercent(0,0),null);
});
