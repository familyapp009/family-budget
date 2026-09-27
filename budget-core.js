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
export function overview(plan, guidelines, purchases) {
  const starting = Number(plan.net_income_cents) - Number(plan.fixed_costs_cents);
  const spent = purchases.reduce((sum, item) => sum + Number(item.usd_cents), 0);
  const byCategory = new Map();
  for (const item of purchases) byCategory.set(item.category, (byCategory.get(item.category) || 0) + Number(item.usd_cents));
  return {
    starting,
    spent,
    remaining: starting - spent,
    categories: guidelines.map(g => ({
      ...g,
      spent: byCategory.get(g.category) || 0,
      remaining: Number(g.target_cents) - (byCategory.get(g.category) || 0)
    }))
  };
}
export function sameMonth(isoDate, month) {
  return /^\d{4}-\d\d-\d\d$/.test(isoDate) && isoDate.startsWith(month + "-") &&
    !Number.isNaN(new Date(isoDate + "T12:00:00Z").valueOf()) &&
    new Date(isoDate + "T12:00:00Z").toISOString().slice(0,10) === isoDate;
}
