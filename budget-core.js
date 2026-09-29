// All amounts are integer US cents unless explicitly marked as native currency.
// No savings calculation: remaining = normal two-paycheck net - automatic obligations - recorded purchases.
export function parseAmount(value) {
  const input = String(value).trim();
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(input)) throw new Error("Enter a valid amount with up to two decimals.");
  const [whole, fractional = ""] = input.split(".");
  return Number(whole) * 100 + Number(fractional.padEnd(2, "0"));
}
export function usdCents(nativeCents, currency, euroToUsd) {
  if (!Number.isSafeInteger(nativeCents) || nativeCents <= 0) throw new Error("Amount must be greater than zero.");
  if (currency === "USD") return nativeCents;
  if (currency !== "EUR" || !(Number(euroToUsd) > 0 && Number(euroToUsd) < 10)) throw new Error("Invalid exchange rate.");
  return Math.round(nativeCents * Number(euroToUsd));
}
export function formatUsd(amount) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount / 100);
}
export function monthNow(date = new Date()) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
}
export function shiftMonth(month, delta) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid month.");
  const [year, m] = month.split("-").map(Number);
  return monthNow(new Date(year, m - 1 + delta, 1));
}
export function usagePercent(spentCents, targetCents) {
  const spent = Number(spentCents);
  const target = Number(targetCents);
  if (target <= 0) return null; // No guideline set; never suggest that spending is 100% used.
  return Math.round((spent / target) * 100);
}
export function overview(plan, guidelines, purchases) {
  const starting = Number(plan.net_income_cents) - Number(plan.fixed_costs_cents);
  const spent = purchases.reduce((sum, item) => sum + Number(item.usd_cents), 0);
  const byGuidelineId = new Map();
  for (const item of purchases) {
    const key = item.guideline_id;
    if (key) byGuidelineId.set(key, (byGuidelineId.get(key) || 0) + Number(item.usd_cents));
  }
  const categoryRows = guidelines.map(g => {
    // Transactions store guideline_id, not a category name.
    const categorySpent = byGuidelineId.get(g.id) || 0;
    return {
      ...g,
      spent: categorySpent,
      remaining: Number(g.target_cents) - categorySpent,
      percent: usagePercent(categorySpent, g.target_cents)
    };
  });
  return {
    starting,
    spent,
    remaining: starting - spent,
    percent: usagePercent(spent, starting),
    categories: categoryRows
  };
}
export function sameMonth(isoDate, month) {
  return /^\d{4}-\d\d-\d\d$/.test(isoDate) && isoDate.startsWith(month + "-") &&
    !Number.isNaN(new Date(isoDate + "T12:00:00Z").valueOf()) &&
    new Date(isoDate + "T12:00:00Z").toISOString().slice(0,10) === isoDate;
}

// New repeat purchases retain the native price and memo, not the old date, ID,
// converted USD value, or audit timestamp. The database timestamps each new insert.
export function repeatPurchaseValues(purchase, guidelineId, spentOn, month) {
  if (!sameMonth(spentOn, month)) throw new Error("The repeated purchase must be dated in the destination month.");
  if (!guidelineId) throw new Error("Choose a category in the destination month.");
  const amount = Number(purchase.original_amount_cents);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Invalid original purchase amount.");
  if (purchase.currency !== "USD" && purchase.currency !== "EUR") throw new Error("Unsupported original purchase currency.");
  const note = String(purchase.note ?? "");
  if (note.length > 280) throw new Error("The original purchase note is too long.");
  return {original_amount_cents:amount,currency:purchase.currency,guideline_id:guidelineId,spent_on:spentOn,note};
}

export function totalFixedObligations(items, euroToUsd) {
  if (!(Number(euroToUsd) > 0 && Number(euroToUsd) < 10)) throw new Error("Invalid exchange rate.");
  return items.reduce((sum, item) => {
    if (!item.enabled) return sum;
    const amount = Number(item.original_amount_cents);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid fixed obligation.");
    if (item.currency === "USD") return sum + amount;
    if (item.currency === "EUR") return sum + Math.round(amount * Number(euroToUsd));
    throw new Error("Unsupported fixed obligation currency.");
  }, 0);
}
