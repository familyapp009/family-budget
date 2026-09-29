import { parseAmount, usdCents, formatUsd, monthNow, shiftMonth, overview, sameMonth, totalFixedObligations, repeatPurchaseValues } from "./budget-core.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const $ = (selector) => document.querySelector(selector);
const clean = (value) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]);
const moneyInput = cents => (Number(cents ?? 0) / 100).toFixed(2);
const today = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-"); };
const monthLabel = month => new Intl.DateTimeFormat("en-US", {month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(month+"-01T12:00:00Z"));
const defaults = ["Groceries","Restaurants","Shopping","Household / kids","Entertainment","Other"];
const uid = () => typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+Math.random();
const state = {
  demo: new URLSearchParams(location.search).get("demo") === "1",
  month: monthNow(), client: null, user: null, member: null, plan: null,
  previous: null, previousGuidelines: [], guidelines: [], purchases: [], householdDefaults: null, obligations: [], budgetDefaultsPage: new URLSearchParams(location.search).has("defaults"),
  editingExpense: null, editingCategory: null, expenseComposerOpen: false, settings: false,
  loading: true, error: "", feedback: "", channel: null, theme: "light", themeAccount: undefined, accountSettings: new URLSearchParams(location.search).has("account")
};
const demoMonths = new Map();
let toastTimer;
let themeChangeVersion = 0;
const themeKey = account => "family-budget:theme:" + (account ?? "guest");
function readTheme(account) {
  try {
    const theme = localStorage.getItem(themeKey(account));
    return theme === "dark" || theme === "light" ? theme : null;
  } catch { return null; }
}
function applyTheme(theme, remember = false) {
  state.theme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = state.theme === "dark" ? "#101a17" : "#16352d";
  if (remember) {
    try { localStorage.setItem(themeKey(state.themeAccount), state.theme); } catch { /* Storage can be disabled. */ }
  }
  header();
}
function selectThemeForAccount() {
  const account = state.demo ? "demo" : state.user?.id ?? null;
  if (account === state.themeAccount) return;
  state.themeAccount = account;
  const local = readTheme(account);
  applyTheme(local ?? "light");
  if (!state.demo && account && state.client) {
    const version = themeChangeVersion;
    void (async () => {
      const {data,error} = await state.client.from("user_theme_preferences")
        .select("theme").eq("user_id",account).maybeSingle();
      if (error || state.themeAccount !== account || themeChangeVersion !== version) return;
      if (data?.theme === "dark" || data?.theme === "light") applyTheme(data.theme,true);
    })();
  }
}

function toast(message) {
  const el = $("#toast");
  el.textContent = String(message);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 5500);
}
function assertDb({data,error}) {
  if (error) throw new Error(error.message || "Database operation failed.");
  return data;
}
function header() {
  const controls = $("#header-tools");
  const dark = state.theme === "dark";
  const toggle = '<button class="mini theme-toggle" type="button" data-action="toggle-theme" aria-pressed="'+dark+
    '" aria-label="Switch to '+(dark?"light":"dark")+' mode">'+(dark?"☀ Light mode":"☾ Dark mode")+'</button>'+
    '<button class="mini header-refresh" type="button" data-action="reload-app" aria-label="Refresh app and sync budget" title="Reload app and sync">↻ Refresh</button>';
  if (state.demo) {
    controls.innerHTML = toggle+'<span class="pill demo">Sample data</span><a class="button" href="./">Sign in</a>';
  } else if (state.user) {
    controls.innerHTML = toggle+'<button class="quiet mini" data-action="account-settings">Account settings</button><button class="quiet mini" data-action="signout">Sign out</button>';
  } else controls.innerHTML = toggle+'<a class="button" href="./?demo=1">View sample demo</a>';
}
function demoSeed() {
  const month = state.month;
  const categories = [
    ["Groceries",100000],["Restaurants",50000],["Shopping",35000],
    ["Household / kids",60000],["Entertainment",25000],["Other",0]
  ].map(([category,target_cents],display_order)=>({id:uid(),category,target_cents,display_order}));
  const find = name => categories.find(c=>c.category===name).id;
  const purchases = [
    ["Groceries", "2026-09-05", 9600,"USD","Food shopping"],
    ["Restaurants", "2026-09-09", 3800,"USD","Lunch"],
    ["Shopping", "2026-09-11", 4200,"EUR","Household order"],
    ["Groceries", "2026-09-13", 7600,"EUR","Groceries"]
  ].map(([name,date,original_amount_cents,currency,note])=>({
    id:uid(), guideline_id:find(name), household_id:"demo",month,
    spent_on: month === "2026-09" ? date : month+"-01",
    original_amount_cents,currency,usd_cents:usdCents(original_amount_cents,currency,1.14),note,created_at:new Date().toISOString()
  }));
  state.householdDefaults = { household_id:"demo",net_income_cents:800000,euro_to_usd:1.14 };
  state.obligations = [{id:"demo-bill",household_id:"demo",label:"Sample automatic expenses",original_amount_cents:300000,currency:"USD",enabled:true,display_order:0}];
  demoMonths.set(month,{plan:{household_id:"demo",month,net_income_cents:800000,fixed_costs_cents:300000,euro_to_usd:1.14},guidelines:categories,purchases});
}
function loadDemo() {
  const item = demoMonths.get(state.month);
  state.plan = item?.plan ?? null;
  state.guidelines = item?.guidelines ?? [];
  state.purchases = item?.purchases ?? [];
  const prior = demoMonths.get(shiftMonth(state.month,-1));
  state.previous = prior?.plan ?? null;
  state.previousGuidelines = prior?.guidelines ?? [];
  state.loading = false;
  render();
}
async function loadMember() {
  if (!state.client || !state.user) return;
  const {data,error} = await state.client.from("household_members")
    .select("household_id,role").eq("user_id",state.user.id).maybeSingle();
  if (error) throw new Error(error.message);
  const last = state.member?.household_id;
  state.member = data ?? null;
  if (data && last !== data.household_id) connectRealtime(data.household_id);
  if (!data && state.channel) { await state.client.removeChannel(state.channel); state.channel = null; }
}
function connectRealtime(householdId) {
  if (state.channel) void state.client.removeChannel(state.channel);
  let channel = state.client.channel("family-budget-" + householdId);
  for (const table of ["monthly_plans","monthly_guidelines","purchases","household_budget_defaults","fixed_obligation_defaults"]) {
    channel = channel.on("postgres_changes",{
      event:"*",schema:"public",table,filter:"household_id=eq."+householdId
    }, () => {
      if (document.visibilityState !== "visible") return;
      if (document.activeElement?.closest("form")) {
        state.feedback = "The budget changed. Press Refresh when you finish editing.";
        const banner = $("#live-update-note");
        if (banner) banner.textContent = state.feedback;
      } else void loadMonth();
    });
  }
  state.channel = channel.subscribe();
}
async function loadMonth() {
  selectThemeForAccount();
  if (state.demo) { loadDemo(); return; }
  if (!state.user) { state.loading = false; render(); return; }
  state.loading = true; render();
  try {
    await loadMember();
    if (!state.member) { state.plan = null; state.loading = false; render(); return; }
    const db = state.client, household_id = state.member.household_id, month = state.month;
    const [planResult, catResult, purchasesResult, previousResult, defaultsResult, obligationsResult] = await Promise.all([
      db.from("monthly_plans").select("*").eq("household_id",household_id).eq("month",month).maybeSingle(),
      db.from("monthly_guidelines").select("*").eq("household_id",household_id).eq("month",month).order("display_order").order("category"),
      db.from("purchases").select("*").eq("household_id",household_id).eq("month",month).order("spent_on",{ascending:false}).order("created_at",{ascending:false}),
      db.from("monthly_plans").select("*").eq("household_id",household_id).lt("month",month).order("month",{ascending:false}).limit(1).maybeSingle(),
      db.from("household_budget_defaults").select("*").eq("household_id",household_id).maybeSingle(),
      db.from("fixed_obligation_defaults").select("*").eq("household_id",household_id).order("display_order").order("label")
    ]);
    if (state.month !== month) return;
    state.plan = assertDb(planResult);
    state.guidelines = assertDb(catResult) ?? [];
    state.purchases = assertDb(purchasesResult) ?? [];
    state.previous = assertDb(previousResult);
    state.householdDefaults = assertDb(defaultsResult);
    state.obligations = assertDb(obligationsResult) ?? [];
    state.previousGuidelines = [];
    if (!state.plan && state.previous) {
      const prev = await db.from("monthly_guidelines").select("*").eq("household_id",household_id)
        .eq("month",state.previous.month).order("display_order");
      state.previousGuidelines = assertDb(prev) ?? [];
    }
    state.error = "";
  } catch (e) { state.error = e.message; }
  state.loading = false;
  render();
}
function monthPicker() {
  return '<div class="month-control" aria-label="Choose month">' +
    '<button data-action="prev-month" aria-label="Previous month">‹</button>' +
    '<input id="month-picker" type="month" value="'+clean(state.month)+'" aria-label="Budget month">' +
    '<button data-action="next-month" aria-label="Next month">›</button></div>';
}
function render() {
  header();
  if (state.loading) { $("#app").innerHTML='<div class="loading">Loading budget…</div>'; return; }
  if (state.error) {
    $("#app").innerHTML='<div class="notice warn">'+clean(state.error)+'</div><button data-action="refresh">Retry</button>';
    return;
  }
  if (!state.demo && !state.user) { renderAuth(); return; }
  if (!state.demo && !state.member) { renderPending(); return; }
  if (state.budgetDefaultsPage) { renderBudgetDefaults(); return; }
  if (state.accountSettings) {
    $("#app").innerHTML = '<div class="page-head"><div><p class="eyebrow">Family Budget</p><h1>Account settings</h1><p class="muted">Your personal login, available before or after setting up a monthly budget.</p></div><button data-action="account-settings">Back to budget</button></div>'+
      '<section class="card" style="max-width:570px"><h2>Your login</h2><p class="muted">'+clean(state.user?.email ?? "")+'</p><h3>Set or change password</h3>'+passwordForm()+'</section>';
    return;
  }
  const intro = '<div class="page-head"><div><p class="eyebrow">Household spending</p><h1>'+clean(monthLabel(state.month))+
    '</h1><p class="muted">One balance. Flexible guidelines. No savings calculations.</p></div>'+monthPicker()+'</div>';
  if (!state.plan) {
    $("#app").innerHTML=intro+'<div class="row spread" style="margin-bottom:14px"><button class="mini" data-action="budget-defaults">Edit recurring defaults</button><button class="quiet mini" data-action="account-settings">Account settings / Set password</button></div><div class="card"><h2>Set up this month</h2><p class="muted">Confirm the normal two-paycheck income and total automatic obligations. They will stay out of the main dashboard.</p>'+monthForm()+'</div>';
    return;
  }
  const o = overview(state.plan, state.guidelines, state.purchases);
  const expenses = state.purchases;
  const totalHasBudget = o.starting > 0;
  const totalBarWidth = totalHasBudget ? Math.max(0, Math.min(100, o.percent)) : 0;
  const totalOver = totalHasBudget && o.remaining < 0;
  const totalStatus = totalHasBudget ? o.percent+'% of starting balance used' : 'No positive starting balance';
  const totalProgress = '<div class="total-progress"><div class="total-progress-label"><span>Overall spending progress</span><strong>'+clean(totalStatus)+'</strong></div>'+
    '<div class="progress-track overall'+(totalOver?' is-over':'')+'" '+(totalHasBudget?
      'role="progressbar" aria-label="Overall monthly spending" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+totalBarWidth+'" aria-valuetext="'+clean(totalStatus)+'"':
      'aria-hidden="true"')+'><div class="progress-fill" style="width:'+totalBarWidth+'%"></div></div></div>';
  const sum = '<section class="summary"><p class="eyebrow">Available this month</p><div class="balance '+(o.remaining < 0?'negative':'')+'">'+formatUsd(o.remaining)+'</div><div class="summary-grid"><div><small>Starting balance</small><strong>'+formatUsd(o.starting)+'</strong></div><div><small>Purchases recorded</small><strong>−'+formatUsd(o.spent)+'</strong></div></div>'+totalProgress+'</section>';
  const rows = o.categories.map(c => {
    const hasTarget = Number(c.target_cents) > 0;
    const ratio = hasTarget ? c.percent : null;
    const width = hasTarget ? Math.max(0, Math.min(100, ratio)) : 0;
    const over = hasTarget && c.remaining < 0;
    const tone = over ? 'is-over' : hasTarget && ratio >= 80 ? 'is-near' : 'is-good';
    const detail = hasTarget
      ? formatUsd(c.spent)+' spent of '+formatUsd(c.target_cents)
      : formatUsd(c.spent)+' spent · No target set';
    const status = !hasTarget ? 'No target' : over ? formatUsd(-c.remaining)+' over' : formatUsd(c.remaining)+' left';
    const statusText = hasTarget ? ratio+'% used' : 'Set target in Settings';
    return '<div class="category-progress '+tone+'"><div class="category-progress-heading"><h3>'+clean(c.category)+'</h3><strong class="category-status '+(over?'negative':'')+'">'+clean(status)+'</strong></div>'+
      '<div class="category-progress-metrics"><span>'+clean(detail)+'</span><strong>'+clean(statusText)+'</strong></div>'+
      '<div class="progress-track" '+(hasTarget?
        'role="progressbar" aria-label="'+clean(c.category)+' spending" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+width+'" aria-valuetext="'+clean(ratio+'% of the category target used')+'"':
        'aria-hidden="true"')+'><div class="progress-fill" style="width:'+width+'%"></div></div></div>';
  }).join("");
  const goals = '<section class="card"><div class="card-header"><div><h2>Spending progress</h2><p class="muted">Actual purchases against your monthly guidelines. Exceeding a target does not alter other categories.</p></div></div>'+
    '<div class="category-progress-list">'+(rows||'<div class="empty">No categories yet. Open Settings to add spending guidelines.</div>')+'</div>'+
    (o.categories.some(c=>Number(c.target_cents)===0)?'<p class="muted progress-help">Categories with a $0 target show spending but no progress percentage. Set their guidelines in Settings.</p>':'')+'</section>';
  const items = expenses.map(p => {
    const cat = state.guidelines.find(g=>g.id===p.guideline_id)?.category ?? "Category";
    const native = p.currency === "EUR" ? " · €"+moneyInput(p.original_amount_cents) : "";
    const txId = clean(p.id), actionsId = "transaction-actions-"+txId;
    return '<div class="transaction" data-purchase-id="'+txId+'">'+
      '<div class="transaction-actions" id="'+actionsId+'" inert aria-hidden="true">'+
        '<button type="button" class="transaction-action-edit" data-action="edit-expense" data-id="'+txId+'" aria-label="Edit '+clean(cat)+' purchase">Edit</button>'+
        '<button type="button" class="transaction-action-delete" data-action="delete-expense" data-id="'+txId+'" aria-label="Delete '+clean(cat)+' purchase">Delete</button></div>'+
      '<div class="transaction-surface">'+
        '<div class="transaction-details"><strong>'+clean(cat)+(p.note?' · '+clean(p.note):'')+'</strong><span>'+clean(p.spent_on)+native+'</span></div>'+
        '<div class="transaction-end"><strong>'+formatUsd(p.usd_cents)+'</strong>'+
          '<button type="button" class="mini repeat-expense" data-action="repeat-expense" data-id="'+txId+'" aria-label="Repeat '+clean(cat)+' purchase today" title="Add another purchase for today using this amount and note">＋ Repeat</button>'+
          '<button type="button" class="mini purchase-options-toggle" data-action="toggle-purchase-actions" data-id="'+txId+'" aria-controls="'+actionsId+'" aria-expanded="false" aria-label="Show Edit and Delete for '+clean(cat)+' purchase">Options</button>'+
        '</div></div></div>';
  }).join("");
  const recent = '<section class="card"><div class="card-header"><div><h2>Purchases</h2><p class="muted">Shared across both phones. Swipe left on a purchase for Edit and Delete, or tap Options.</p></div><button class="mini" data-action="export">Export CSV</button></div><div class="transactions">'+(items||'<div class="empty">No purchases recorded this month.</div>')+'</div></section>';
  const composerOpen = state.expenseComposerOpen || Boolean(state.editingExpense);
  const composer = '<section class="card quick-expense '+(composerOpen?'is-open':'')+'" id="quick-expense">'+
    '<div class="card-header"><div><h2>Quick expense</h2><p class="muted">Record a purchase as you make it.</p></div>'+
    '<button class="primary quick-expense-toggle" type="button" data-action="toggle-expense" aria-expanded="'+composerOpen+'" aria-controls="quick-expense-entry">'+
    (composerOpen?'Close':'＋ Add expense')+'</button></div>'+
    (composerOpen?'<div id="quick-expense-entry">'+expenseForm()+'</div>':'')+'</section>';
  const controls='<div class="row spread" style="margin-bottom:14px"><span class="muted" id="live-update-note">'+clean(state.feedback)+'</span><div class="row"><button class="quiet mini" data-action="refresh">↻ Refresh</button><button class="mini" data-action="budget-defaults">Budget defaults</button><button class="mini" data-action="settings">'+(state.settings?'Close settings':'Settings')+'</button></div></div>';
  $("#app").innerHTML=intro+sum+composer+controls+(state.settings?'<div class="card" style="margin-bottom:20px"><h2>Monthly settings</h2><p class="muted">Only the total automatic obligations belong here. No savings field. These values belong to the selected month.</p>'+monthForm()+'<div class="row" style="margin-top:12px"><button class="mini" data-action="prefill-month-defaults">Load current household defaults into these fields</button></div>'+
    '<div class="settings-categories"><div class="sec-head"><h2>Category guidelines</h2><button class="mini" data-action="new-category">+ Category</button></div><p class="muted">Adjust the targets here; the everyday dashboard shows progress only.</p>'+
    state.guidelines.map(c=>'<div class="settings-category-row"><div><strong>'+clean(c.category)+'</strong><span>'+formatUsd(c.target_cents)+' target</span></div><button class="mini" data-action="edit-category" data-id="'+clean(c.id)+'">Edit</button></div>').join('')+
    (state.editingCategory ? categoryForm() : '')+'</div></div>':'')+
    '<div class="two-col"><div class="stack">'+goals+'</div><div class="stack">'+recent+'</div></div>';
}
function renderBudgetDefaults() {
  const base = state.householdDefaults ?? {net_income_cents:0,euro_to_usd:1.14};
  const total = totalFixedObligations(state.obligations,base.euro_to_usd);
  const bills = state.obligations.map((bill,i)=>'<div class="bill-item" data-id="'+clean(bill.id)+'">'+
    '<div class="row spread"><strong>Automatic bill '+(i+1)+'</strong><button type="button" class="danger mini" data-action="delete-bill" data-id="'+clean(bill.id)+'">Remove</button></div>'+
    '<label>Expense name<input data-field="label" maxlength="80" required value="'+clean(bill.label)+'"></label>'+
    '<div class="fields"><label>Amount<input data-field="amount" type="number" min="0" max="999999999" step=".01" required value="'+moneyInput(bill.original_amount_cents)+'"></label>'+
    '<label>Currency<select data-field="currency"><option value="USD" '+(bill.currency==="USD"?"selected":"")+'>USD $</option><option value="EUR" '+(bill.currency==="EUR"?"selected":"")+'>EUR €</option></select></label></div>'+
    '<label class="checkline"><input type="checkbox" data-field="enabled" '+(bill.enabled?"checked":"")+'> Include in recurring total</label></div>').join("");
  $("#app").innerHTML='<div class="page-head"><div><p class="eyebrow">Behind the scenes</p><h1>Household defaults</h1>'+
    '<p class="muted">Edit these only when pay or an automatic bill changes. Neither the bills nor savings appear on your main dashboard.</p></div>'+
    '<button data-action="budget-defaults">Back to budget</button></div>'+
    '<div class="card" style="max-width:760px"><div class="notice">These values prefill every <strong>new</strong> month. An existing monthly budget keeps its previous amounts unless you explicitly update it in Monthly settings.</div>'+
    '<form id="defaults-form"><h2>Normal income and exchange rate</h2>'+
    '<div class="fields" style="margin-top:15px"><label>Normal two-paycheck net income (USD)<input name="net" type="number" min="0" max="999999999" step=".01" required value="'+moneyInput(base.net_income_cents)+'"></label>'+
    '<label>EUR → USD rate<input name="rate" type="number" min=".000001" max="9.999999" step=".000001" required value="'+clean(base.euro_to_usd)+'"></label></div>'+
    '<div class="sec-head"><h2>Automatic monthly obligations</h2><span class="pill">'+state.obligations.filter(b=>b.enabled).length+' included</span></div>'+
    '<p class="muted">Each enabled item is subtracted once when a new month is created. Do not include payroll deductions or individual credit-card repayments.</p>'+
    '<div class="bill-editor">'+(bills||'<p class="muted">No recurring bills saved. Add one below.</p>')+'</div>'+
    '<h3 style="margin-top:16px">Add another automatic bill (optional)</h3>'+
    '<div class="fields"><label>Name<input name="newLabel" maxlength="80" placeholder="e.g. Subscription"></label><label>Amount<input name="newAmount" type="number" min="0" max="999999999" step=".01" placeholder="0.00"></label></div>'+
    '<label>Currency<select name="newCurrency"><option value="USD">USD $</option><option value="EUR">EUR €</option></select></label>'+
    '<div class="notice" style="margin-top:16px"><div class="detail-list"><span>Recurring monthly total</span><span id="defaults-fixed-preview">'+formatUsd(total)+'</span>'+
    '<span>Starting monthly spending allowance</span><span id="defaults-pool-preview">'+formatUsd(Number(base.net_income_cents)-total)+'</span></div></div>'+
    '<div class="row"><button class="primary" type="submit">Save household defaults</button><button type="button" data-action="budget-defaults">Cancel</button></div></form>'+
    '</div>';
}
function readDefaultBillDraft(form) {
  const net = parseAmount(form.elements.net.value);
  const rate = Number(form.elements.rate.value);
  if (!(rate > 0 && rate < 10)) throw new Error("Enter a valid EUR to USD rate.");
  const rows=[...form.querySelectorAll(".bill-item")].map(el=>{
    const field = name => el.querySelector('[data-field="'+name+'"]');
    const label=field("label").value.trim();
    if(!label || label.length>80)throw new Error("Each automatic bill needs a name.");
    return {
      id:el.dataset.id,label,original_amount_cents:parseAmount(field("amount").value),
      currency:field("currency").value,enabled:field("enabled").checked
    };
  });
  const newLabel=form.elements.newLabel.value.trim();
  if(newLabel) {
    if(newLabel.length>80 || !form.elements.newAmount.value) throw new Error("Complete the new bill's name and amount.");
    rows.push({id:null,label:newLabel,original_amount_cents:parseAmount(form.elements.newAmount.value),
      currency:form.elements.newCurrency.value,enabled:true});
  } else if(form.elements.newAmount.value) throw new Error("Enter a name for the new bill.");
  if(new Set(rows.map(x=>x.label.toLocaleLowerCase())).size!==rows.length)throw new Error("Each automatic bill needs a distinct name.");
  const total=totalFixedObligations(rows,rate);
  return {net,rate,rows,total};
}
function updateDefaultsPreview() {
  const form=$("#defaults-form");
  if(!form)return;
  try {
    const draft=readDefaultBillDraft(form);
    $("#defaults-fixed-preview").textContent=formatUsd(draft.total);
    $("#defaults-pool-preview").textContent=formatUsd(draft.net-draft.total);
  }catch{
    $("#defaults-fixed-preview").textContent="Complete all amounts";
    $("#defaults-pool-preview").textContent="—";
  }
}
async function saveBudgetDefaults(form) {
  const {net,rate,rows}=readDefaultBillDraft(form);
  if(state.demo) {
    state.householdDefaults={household_id:"demo",net_income_cents:net,euro_to_usd:rate};
    state.obligations=rows.map((r,i)=>({...r,id:r.id??uid(),household_id:"demo",display_order:i}));
  } else {
    const db=state.client,h=state.member.household_id;
    assertDb(await db.from("household_budget_defaults").upsert({
      household_id:h,net_income_cents:net,euro_to_usd:rate
    },{onConflict:"household_id"}).select("household_id").single());
    const existing=rows.filter(r=>r.id).map((r,i)=>({...r,household_id:h,display_order:i}));
    if(existing.length) assertDb(await db.from("fixed_obligation_defaults").upsert(existing,{onConflict:"id"}).select("id"));
    const newItem=rows.find(r=>!r.id);
    if(newItem) {
      const {id,...data}=newItem;
      assertDb(await db.from("fixed_obligation_defaults").insert({...data,household_id:h,display_order:rows.length-1}).select("id").single());
    }
  }
  await loadMonth();
  toast("Recurring household defaults saved. Existing monthly budgets are unchanged.");
}
async function deleteBill(id) {
  if(!confirm("Remove this recurring bill from future monthly defaults? Existing months will not change."))return;
  if(state.demo)state.obligations=state.obligations.filter(b=>b.id!==id);
  else assertDb(await state.client.from("fixed_obligation_defaults").delete().eq("id",id)
    .eq("household_id",state.member.household_id).select("id").single());
  await loadMonth();
  toast("Recurring bill removed. Existing months are unchanged.");
}
function renderAuth() {
  $("#app").innerHTML='<div class="auth-box"><p class="eyebrow">Private household access</p><h1>Welcome home.</h1><p class="muted">Sign in using an account that has been invited and added to the family household.</p><div class="card">'+
    '<form id="login-form"><label>Email<input type="email" name="email" autocomplete="email" required placeholder="name@example.com"></label>'+
    '<label>Password <span class="helper">(for password sign-in)</span><input type="password" name="password" autocomplete="current-password"></label>'+
    '<button class="primary" type="submit" name="mode" value="password">Sign in</button>'+
    '<button type="submit" name="mode" value="link" formnovalidate>Send email sign-in link</button></form></div>'+
    '<p class="muted" style="margin-top:16px">Want to explore first? <a href="./?demo=1">View the sample dashboard</a>. Its entries are fictitious and are not saved.</p></div>';
}
function renderPending() {
  $("#app").innerHTML='<div class="auth-box"><div class="notice warn"><h2>Account awaiting access</h2><p>Your account is authenticated, but has not been added to this household. No budget records are accessible yet.</p>'+
    '<p class="muted">Supabase user ID (share with the project administrator):</p><code style="font-size:11px;overflow-wrap:anywhere">'+clean(state.user.id)+'</code></div><button data-action="refresh">Check again</button></div>';
}
function monthForm() {
  const plan = state.plan;
  const base = state.householdDefaults;
  const fromPrevious = !plan && !!state.previous;
  const rate = plan?.euro_to_usd ?? base?.euro_to_usd ?? 1.14;
  const income = moneyInput(plan?.net_income_cents ?? base?.net_income_cents ?? 0);
  const fixed = moneyInput(plan?.fixed_costs_cents ?? totalFixedObligations(state.obligations, rate));
  return '<form id="month-form"><div class="fields"><label>Two-paycheck net income (USD)<input type="number" min="0" max="999999999" step=".01" name="net" required placeholder="0.00" value="'+clean(income)+'"></label>'+
    '<label>Automatic monthly obligations (USD)<input type="number" min="0" max="999999999" step=".01" name="fixed" required placeholder="0.00" value="'+clean(fixed)+'"></label></div>'+
    '<label>EUR → USD planning rate<input name="rate" type="number" step="0.000001" min="0.000001" max="9.999999" required value="'+clean(rate)+'"><span class="helper">Used for new EUR purchase entries. Existing transactions keep their recorded USD equivalent.</span></label>'+
    (fromPrevious?'<div class="notice">Income and fixed costs use the saved household defaults. Category guidelines are copied from your most recent saved earlier month.</div>':'')+
    '<div class="row"><button class="primary" type="submit">'+(state.plan?"Save settings":"Create month")+'</button>'+(state.plan?'<button type="button" data-action="settings">Cancel</button>':'')+'</div></form>';
}
function categoryForm() {
  const existing = state.guidelines.find(g=>g.id===state.editingCategory);
  return '<form id="category-form" style="margin-top:17px;border-top:1px solid #e7ebe6;padding-top:15px"><h3>'+(existing?'Edit guideline':'New guideline')+'</h3>'+
    '<label>Category<input name="category" maxlength="60" required value="'+clean(existing?.category ?? "")+'" placeholder="e.g. Groceries"></label>'+
    '<label>Monthly target (USD)<input name="target" type="number" min="0" max="999999999" step=".01" required value="'+clean(existing?moneyInput(existing.target_cents):"0.00")+'"></label>'+
    '<div class="row"><button class="primary" type="submit">Save guideline</button><button type="button" data-action="cancel-edit">Cancel</button>'+
    (existing && !state.purchases.some(p=>p.guideline_id===existing.id)?'<button type="button" class="danger" data-action="delete-category" data-id="'+clean(existing.id)+'">Remove category</button>':'')+'</div></form>';
}
function expenseForm() {
  const purchase = state.purchases.find(p=>p.id===state.editingExpense);
  const date = purchase?.spent_on ?? (today().startsWith(state.month+"-")?today():state.month+"-01");
  const amount = purchase ? moneyInput(purchase.original_amount_cents) : "";
  const choices=state.guidelines.map(c=>'<option value="'+clean(c.id)+'" '+(purchase?.guideline_id===c.id?'selected':'')+'>'+clean(c.category)+'</option>').join("");
  return '<form id="purchase-form">'+
    '<div class="fields"><label>Amount<input name="amount" type="number" min=".01" max="999999999" step=".01" required inputmode="decimal" placeholder="0.00" value="'+clean(amount)+'"></label>'+
    '<label>Currency<select name="currency"><option value="USD" '+(purchase?.currency!=="EUR"?'selected':'')+'>USD $</option><option value="EUR" '+(purchase?.currency==="EUR"?'selected':'')+'>EUR €</option></select></label></div>'+
    '<label>Category<select name="category" required '+(!choices?'disabled':'')+'>'+ (choices||'<option value="">Add a category first</option>')+'</select></label>'+
    '<label>Date<input name="date" type="date" required value="'+clean(date)+'"></label>'+
    '<label>Note (optional)<input name="note" maxlength="280" value="'+clean(purchase?.note??"")+'" placeholder="What was it?"></label>'+
    '<div class="row"><button class="primary" type="submit" '+(!choices?'disabled':'')+'>'+(purchase?'Save changes':'Add purchase')+'</button>'+
    '<button type="button" data-action="close-expense">Cancel</button></div></form>';
}
function passwordForm() {
  if (state.demo) return '<p class="muted">Passwords are not used in sample mode.</p>';
  return '<form id="password-form"><label>New password<input type="password" name="password" autocomplete="new-password" minlength="12" required placeholder="At least 12 characters"></label><div><button type="submit">Set / change password</button></div></form>';
}
async function saveMonth(form) {
  const net_income_cents = parseAmount(form.elements.net.value);
  const fixed_costs_cents = parseAmount(form.elements.fixed.value);
  const euro_to_usd = Number(form.elements.rate.value);
  if (!(euro_to_usd > 0 && euro_to_usd < 10)) throw new Error("Enter a valid EUR to USD rate.");
  const month = state.month, creating = !state.plan;
  const row={household_id:state.demo?"demo":state.member.household_id,month,net_income_cents,fixed_costs_cents,euro_to_usd};
  const copied = state.previousGuidelines.length ? state.previousGuidelines : defaults.map((category,display_order)=>({category,display_order,target_cents:0}));
  if (state.demo) {
    const d=demoMonths.get(month)??{guidelines:[],purchases:[]};
    d.plan=row;
    if (creating) d.guidelines=copied.map(c=>({id:uid(),category:c.category,target_cents:c.target_cents,display_order:c.display_order}));
    demoMonths.set(month,d);
  } else {
    assertDb(await state.client.from("monthly_plans").upsert(row,{onConflict:"household_id,month"}).select("month").single());
    if (creating && copied.length) {
      const entries=copied.map(c=>({household_id:row.household_id,month,category:c.category,target_cents:c.target_cents,display_order:c.display_order}));
      assertDb(await state.client.from("monthly_guidelines").upsert(entries,{onConflict:"household_id,month,category"}));
    }
  }
  state.settings=false;
  await loadMonth();
  toast("Monthly settings saved.");
}
async function saveCategory(form) {
  if (!state.plan) throw new Error("Create the month first.");
  const category=form.elements.category.value.trim();
  const target_cents=parseAmount(form.elements.target.value);
  if (!category || category.length > 60) throw new Error("Enter a category name up to 60 characters.");
  const existing=state.guidelines.find(c=>c.id===state.editingCategory);
  if (state.demo) {
    const d=demoMonths.get(state.month);
    if (d.guidelines.some(c=>c.category.toLowerCase()===category.toLowerCase()&&c.id!==existing?.id)) throw new Error("Category already exists.");
    if (existing) Object.assign(existing,{category,target_cents});
    else d.guidelines.push({id:uid(),category,target_cents,display_order:d.guidelines.length});
  } else if (existing) {
    assertDb(await state.client.from("monthly_guidelines").update({category,target_cents})
      .eq("id",existing.id).eq("household_id",state.member.household_id).select("id").single());
  } else {
    assertDb(await state.client.from("monthly_guidelines").insert({household_id:state.member.household_id,month:state.month,category,target_cents,display_order:state.guidelines.length}).select("id").single());
  }
  state.editingCategory=null;
  await loadMonth();
  toast("Guideline saved.");
}
async function savePurchase(form) {
  if (!state.plan) throw new Error("Set up the month first.");
  const original_amount_cents=parseAmount(form.elements.amount.value);
  if (original_amount_cents <= 0) throw new Error("Enter an amount above zero.");
  const currency=form.elements.currency.value, guideline_id=form.elements.category.value;
  const spent_on=form.elements.date.value, note=form.elements.note.value.trim();
  if (!sameMonth(spent_on,state.month)) throw new Error("Choose a date within the selected month.");
  if (!state.guidelines.some(g=>g.id===guideline_id)) throw new Error("Select an existing guideline.");
  if (note.length>280) throw new Error("Notes can be up to 280 characters.");
  const values={original_amount_cents,currency,guideline_id,spent_on,note};
  const existing=state.purchases.find(p=>p.id===state.editingExpense);
  let insertedId = null;
  if (state.demo) {
    const d=demoMonths.get(state.month),usd_cents=usdCents(original_amount_cents,currency,d.plan.euro_to_usd);
    if (existing) Object.assign(existing,{...values,usd_cents});
    else {
      insertedId=uid();
      d.purchases.unshift({id:insertedId,...values,usd_cents,household_id:"demo",month:state.month,created_at:new Date().toISOString()});
    }
  } else if (existing) {
    assertDb(await state.client.from("purchases").update(values).eq("id",existing.id)
      .eq("household_id",state.member.household_id).select("id").single());
  } else {
    const saved=assertDb(await state.client.from("purchases").insert({...values,household_id:state.member.household_id,month:state.month})
      .select("id").single());
    insertedId=saved.id;
  }
  state.editingExpense=null;
  state.expenseComposerOpen=false;
  await loadMonth();
  toast(existing?"Purchase updated.":"Purchase recorded. Use Edit or Delete in purchase history to correct it.");
}
async function repeatExpense(id) {
  const source = state.purchases.find(p=>p.id===id);
  if (!source) throw new Error("This purchase is no longer available. Refresh and try again.");
  const sourceCategory = state.guidelines.find(g=>g.id===source.guideline_id);
  if (!sourceCategory) throw new Error("Could not find the original purchase category.");

  const currentDate = today();
  const currentMonth = currentDate.slice(0,7);
  let destinationPlan = state.plan;
  let destinationCategories = state.guidelines;
  if (currentMonth !== state.month) {
    if (state.demo) {
      const destination = demoMonths.get(currentMonth);
      destinationPlan = destination?.plan ?? null;
      destinationCategories = destination?.guidelines ?? [];
    } else {
      const householdId = state.member.household_id;
      const [planResult, categoriesResult] = await Promise.all([
        state.client.from("monthly_plans").select("*").eq("household_id",householdId)
          .eq("month",currentMonth).maybeSingle(),
        state.client.from("monthly_guidelines").select("*").eq("household_id",householdId)
          .eq("month",currentMonth)
      ]);
      destinationPlan = assertDb(planResult);
      destinationCategories = assertDb(categoriesResult) ?? [];
    }
  }
  if (!destinationPlan) throw new Error("Set up the current month before repeating purchases.");
  const destinationCategory = currentMonth === state.month
    ? destinationCategories.find(g=>g.id===source.guideline_id)
    : destinationCategories.find(g=>g.category.trim().toLowerCase()===sourceCategory.category.trim().toLowerCase());
  if (!destinationCategory) throw new Error(
    'The "'+sourceCategory.category+'" category is not in the current month. Add it under this month’s Settings before repeating.'
  );
  const values = repeatPurchaseValues(source,destinationCategory.id,currentDate,currentMonth);
  let insertedId;
  if (state.demo) {
    const destination=demoMonths.get(currentMonth);
    insertedId=uid();
    destination.purchases.unshift({
      id:insertedId,...values,household_id:"demo",month:currentMonth,
      usd_cents:usdCents(values.original_amount_cents,values.currency,destinationPlan.euro_to_usd),
      created_at:new Date().toISOString()
    });
  } else {
    const row=assertDb(await state.client.from("purchases").insert({
      ...values,household_id:state.member.household_id,month:currentMonth
    }).select("id").single());
    insertedId=row.id;
  }
  state.month=currentMonth;
  state.settings=false;
  state.editingExpense=null;
  state.editingCategory=null;
  state.expenseComposerOpen=false;
  await loadMonth();
  toast("Purchase repeated for today. Use Edit or Delete in purchase history to correct it.");
}
async function deleteExpense(id) {
  const purchase=state.purchases.find(p=>p.id===id);
  if (!purchase) throw new Error("Purchase not found. Refresh your history and try again.");
  const category=state.guidelines.find(g=>g.id===purchase.guideline_id)?.category ?? "purchase";
  const amount=purchase.currency==="EUR" ? "€"+moneyInput(purchase.original_amount_cents) : formatUsd(purchase.original_amount_cents);
  if (!confirm("Delete "+category+" ("+amount+") dated "+purchase.spent_on+"?\n\nThis permanently removes the purchase from the shared household budget.")) return;
  if (state.demo) {
    const d=demoMonths.get(state.month);
    if (!d?.purchases.some(p=>p.id===id)) throw new Error("Purchase no longer exists.");
    d.purchases=d.purchases.filter(p=>p.id!==id);
  } else {
    assertDb(await state.client.from("purchases").delete().eq("id",id)
      .eq("month",state.month).eq("household_id",state.member.household_id).select("id").single());
  }
  if(state.editingExpense===id) state.editingExpense=null;
  await loadMonth();
  toast("Purchase deleted. Your balance and category totals have been updated.");
}
async function deleteCategory(id) {
  if (state.purchases.some(p=>p.guideline_id===id)) throw new Error("This category has purchases. Move or remove them before deleting it.");
  if (!confirm("Remove this empty category?")) return;
  if (state.demo) {
    const d=demoMonths.get(state.month);d.guidelines=d.guidelines.filter(g=>g.id!==id);
  } else assertDb(await state.client.from("monthly_guidelines").delete().eq("id",id).eq("household_id",state.member.household_id).select("id").single());
  state.editingCategory=null;
  await loadMonth();toast("Category removed.");
}
function exportCsv() {
  const cols=["Date","Category","Amount","Currency","USD amount","Note"];
  const protect = value => {const s=String(value ?? "");return /^[=+\-@\t\r]/.test(s)?"'"+s:s;};
  const quote = value => '"'+protect(value).replaceAll('"','""')+'"';
  const rows=state.purchases.map(p=>[p.spent_on,state.guidelines.find(g=>g.id===p.guideline_id)?.category ?? "",moneyInput(p.original_amount_cents),p.currency,moneyInput(p.usd_cents),p.note]);
  const csv="\uFEFF"+[cols,...rows].map(row=>row.map(quote).join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download="family-budget-"+state.month+".csv";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
// Swipe reveals actions; it never deletes a purchase without a separate tap and confirmation.
function setPurchaseActions(row,open) {
  if (open) {
    for (const other of document.querySelectorAll(".transaction.is-open")) {
      if (other!==row) setPurchaseActions(other,false);
    }
  }
  const tray=row.querySelector(".transaction-actions");
  const toggle=row.querySelector(".purchase-options-toggle");
  const surface=row.querySelector(".transaction-surface");
  if (!tray || !toggle || !surface) return;
  row.classList.toggle("is-open",open);
  tray.toggleAttribute("inert",!open);
  tray.setAttribute("aria-hidden",String(!open));
  toggle.setAttribute("aria-expanded",String(open));
  surface.style.removeProperty("transform");
  row.classList.remove("is-dragging");
}
function installPurchaseSwipe() {
  let gesture=null;
  document.addEventListener("touchstart",event=>{
    const surface=event.target.closest?.(".transaction-surface");
    if (event.touches.length!==1 || !surface || state.loading) {gesture=null;return;}
    const row=surface.closest(".transaction"), touch=event.touches[0];
    gesture={row,surface,x:touch.clientX,y:touch.clientY,mode:null,
      startOpen:row.classList.contains("is-open"),width:row.querySelector(".transaction-actions")?.offsetWidth||164,
      delta:0};
  },{passive:true});
  document.addEventListener("touchmove",event=>{
    if(!gesture || event.touches.length!==1)return;
    const touch=event.touches[0], dx=touch.clientX-gesture.x, dy=touch.clientY-gesture.y;
    if(!gesture.mode) {
      if(Math.abs(dy)>12 && Math.abs(dy)>=Math.abs(dx)) gesture.mode="vertical";
      else if(Math.abs(dx)>12 && Math.abs(dx)>Math.abs(dy)*1.25) gesture.mode="horizontal";
    }
    if(gesture.mode!=="horizontal")return;
    if(event.cancelable) event.preventDefault();
    gesture.delta=dx;
    const base=gesture.startOpen?-gesture.width:0;
    const position=Math.max(-gesture.width,Math.min(0,base+dx));
    gesture.row.classList.add("is-dragging");
    gesture.surface.style.transform="translateX("+position+"px)";
  },{passive:false});
  document.addEventListener("touchend",()=>{
    if(!gesture)return;
    const g=gesture;gesture=null;
    if(!g.row.isConnected)return;
    g.row.classList.remove("is-dragging");
    g.surface.style.removeProperty("transform");
    if(g.mode!=="horizontal")return;
    const open=g.delta< -42?true:g.delta>42?false:g.startOpen;
    setPurchaseActions(g.row,open);
  },{passive:true});
  document.addEventListener("touchcancel",()=>{
    if(gesture?.row.isConnected){
      gesture.row.classList.remove("is-dragging");
      gesture.surface.style.removeProperty("transform");
    }
    gesture=null;
  },{passive:true});
}
async function handleAction(button) {
  const action=button.dataset.action, id=button.dataset.id;
  if (action==="reload-app") { refreshApplication(true); return; }
  if (action==="toggle-theme") {
    const next = state.theme === "dark" ? "light" : "dark";
    themeChangeVersion++;
    applyTheme(next,true);
    if (!state.demo && state.user && state.client) {
      const {error} = await state.client.from("user_theme_preferences").upsert({
        user_id:state.user.id, theme:next, updated_at:new Date().toISOString()
      },{onConflict:"user_id"});
      if (error) toast("Theme changed on this device, but cross-device preference could not be saved.");
    }
    return;
  }
  if (action==="prev-month" || action==="next-month") {
    state.month=shiftMonth(state.month,action==="prev-month"?-1:1);
    state.settings=false;state.editingExpense=null;state.editingCategory=null;state.expenseComposerOpen=false;
    await loadMonth();return;
  }
  if (action==="signout") {
    const {error}=await state.client.auth.signOut();
    if(error) throw error;
    state.user=null;state.member=null;state.plan=null;state.householdDefaults=null;state.obligations=[];
    if(state.channel){await state.client.removeChannel(state.channel);state.channel=null;}
    render();return;
  }
  if(action==="refresh"){state.error="";state.feedback="";await loadMonth();return;}
  if(action==="budget-defaults"){state.budgetDefaultsPage=!state.budgetDefaultsPage;state.accountSettings=false;render();return;}
  if(action==="account-settings"){state.accountSettings=!state.accountSettings;state.budgetDefaultsPage=false;render();return;}
  if(action==="settings"){state.settings=!state.settings;if(!state.settings)state.editingCategory=null;render();return;}
  if(action==="prefill-month-defaults"){const form=$("#month-form");if(!form||!state.householdDefaults)throw new Error("No saved defaults found.");form.elements.net.value=moneyInput(state.householdDefaults.net_income_cents);form.elements.rate.value=state.householdDefaults.euro_to_usd;form.elements.fixed.value=moneyInput(totalFixedObligations(state.obligations,state.householdDefaults.euro_to_usd));toast("Household defaults loaded. Press Save settings to apply them to this month.");return;}
  if(action==="delete-bill"){await deleteBill(id);return;}
  if(action==="new-category"){state.settings=true;state.editingCategory="new";render();return;}
  if(action==="manage-categories"){state.editingCategory=state.guidelines[0]?.id ?? "new";render();return;}
  if(action==="edit-category"){state.settings=true;state.editingCategory=id;render();return;}
  if(action==="toggle-expense"){
    const wasOpen=state.expenseComposerOpen || Boolean(state.editingExpense);
    state.expenseComposerOpen=!wasOpen;
    state.editingExpense=null;
    render();
    if(state.expenseComposerOpen) $("#purchase-form input[name=amount]")?.focus({preventScroll:true});
    return;
  }
  if(action==="close-expense"){state.expenseComposerOpen=false;state.editingExpense=null;render();return;}
  if(action==="edit-expense"){
    state.editingExpense=id;state.expenseComposerOpen=true;render();
    $("#quick-expense")?.scrollIntoView({behavior:"smooth",block:"start"});
    return;
  }
  if(action==="toggle-purchase-actions"){const row=button.closest(".transaction");if(row)setPurchaseActions(row,!row.classList.contains("is-open"));return;}
  if(action==="repeat-expense"){await repeatExpense(id);return;}
  if(action==="delete-expense"){await deleteExpense(id);return;}
  if(action==="delete-category"){await deleteCategory(id);return;}
  if(action==="cancel-edit"){state.editingExpense=null;state.editingCategory=null;state.expenseComposerOpen=false;render();return;}
  if(action==="export"){exportCsv();return;}
}
// Re-load the document rather than only querying the database: this also fetches
// the current versioned JS/CSS references after a GitHub Pages deployment.
function refreshApplication(confirmEditing = false) {
  if (confirmEditing && document.querySelector("form") &&
      !confirm("Reload the application? Any unsaved form changes will be lost.")) return;
  const indicator = $("#pull-refresh");
  if (indicator) {
    indicator.textContent = "Refreshing…";
    indicator.style.setProperty("--pull-distance","90px");
    indicator.classList.add("is-refreshing");
    indicator.classList.remove("is-ready");
  }
  const next = new URL(location.href);
  next.searchParams.set("_refresh", String(Date.now()));
  // Same-origin navigation preserves Supabase authentication in browser storage.
  location.replace(next.href);
}
function installPullToRefresh() {
  const indicator = $("#pull-refresh");
  if (!indicator || !("ontouchstart" in window)) return;
  const threshold=88, maximum=132;
  let startY=0, startX=0, distance=0, tracking=false, refreshing=false;
  const blocked = () => !!document.querySelector("form") || state.loading;
  const reset=()=>{
    tracking=false;distance=0;
    indicator.classList.remove("is-pulling","is-ready");
    indicator.style.setProperty("--pull-distance","0px");
    indicator.textContent="↓ Pull to refresh";
  };
  document.addEventListener("touchstart",event=>{
    if(refreshing || event.touches.length!==1 || window.scrollY>0 ||
      document.scrollingElement?.scrollTop>0 || blocked()) return;
    if(event.target.closest("button,a,input,select,textarea,[contenteditable='true']")) return;
    startY=event.touches[0].clientY;
    startX=event.touches[0].clientX;
    distance=0;tracking=true;
  },{passive:true});
  document.addEventListener("touchmove",event=>{
    if(!tracking || event.touches.length!==1)return;
    if(window.scrollY>0 || document.scrollingElement?.scrollTop>0 || blocked()) {reset();return;}
    const dy=event.touches[0].clientY-startY;
    const dx=event.touches[0].clientX-startX;
    if(dy<=0 || Math.abs(dx)>Math.max(16,dy*0.8)) {reset();return;}
    if(dy<7)return;
    // Intercept downward overscroll only. Normal upward/horizontal navigation remains native.
    if(event.cancelable)event.preventDefault();
    distance=Math.min(maximum,dy*0.6);
    const ready=distance>=threshold;
    indicator.style.setProperty("--pull-distance",distance+"px");
    indicator.classList.add("is-pulling");
    indicator.classList.toggle("is-ready",ready);
    indicator.textContent=ready?"↑ Release to refresh":"↓ Pull to refresh";
  },{passive:false});
  document.addEventListener("touchend",()=>{
    if(!tracking)return;
    const ready=distance>=threshold && !blocked();
    reset();
    if(ready){refreshing=true;refreshApplication(false);}
  },{passive:true});
  document.addEventListener("touchcancel",reset,{passive:true});
}
document.addEventListener("click",async event=>{
  if(!event.target.closest(".transaction")) {
    for(const row of document.querySelectorAll(".transaction.is-open")) setPurchaseActions(row,false);
  }
  const button=event.target.closest("button[data-action]");
  if(!button)return;
  event.preventDefault();button.disabled=true;
  try{await handleAction(button);}catch(e){toast(e.message||"Something went wrong.");}
  finally{if(button.isConnected)button.disabled=false;}
});
document.addEventListener("change",async event=>{
  if(event.target.id!=="month-picker")return;
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)){toast("Invalid month.");return;}
  state.month=event.target.value;state.settings=false;state.editingExpense=null;state.editingCategory=null;
  await loadMonth();
});
document.addEventListener("submit",async event=>{
  const form=event.target;if(!(form instanceof HTMLFormElement))return;
  event.preventDefault();
  const submit=event.submitter;
  if(submit)submit.disabled=true;
  try {
    if(form.id==="login-form"){
      const email=form.elements.email.value.trim();
      const mode=submit?.value??"password";
      if(mode==="link") {
        const {error}=await state.client.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:location.origin+location.pathname}});
        if(error)throw error;
        toast("If the account is authorized, a sign-in link has been sent. Check your email.");
      } else {
        const {error}=await state.client.auth.signInWithPassword({email,password:form.elements.password.value});
        if(error)throw error;
      }
    } else if(form.id==="month-form") await saveMonth(form);
    else if(form.id==="defaults-form") await saveBudgetDefaults(form);
    else if(form.id==="category-form") await saveCategory(form);
    else if(form.id==="purchase-form") await savePurchase(form);
    else if(form.id==="password-form"){
      const password=form.elements.password.value;
      if(password.length<12) throw new Error("Choose at least 12 characters.");
      const {error}=await state.client.auth.updateUser({password});
      if(error)throw error;
      form.reset();toast("Password updated.");
    }
  } catch(e){toast(e.message||"Could not save.");}
  finally{if(submit?.isConnected)submit.disabled=false;}
});
document.addEventListener("input",event=>{if(event.target.closest("#defaults-form"))updateDefaultsPreview();});
document.addEventListener("change",event=>{if(event.target.closest("#defaults-form"))updateDefaultsPreview();});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&!state.loading&&state.user&&state.member)void loadMonth();});

async function startup() {
  installPullToRefresh();
  installPurchaseSwipe();
  if(state.demo){selectThemeForAccount();demoSeed();loadDemo();return;}
  try {
    if(!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new Error("The application is not connected to the database yet. Contact the project administrator.");
    const {createClient}=await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/+esm");
    state.client=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:"implicit"}
    });
    const {data,error}=await state.client.auth.getSession();
    if(error)throw error;
    state.user=data.session?.user??null;
    state.client.auth.onAuthStateChange((event,session)=>{
      if(["SIGNED_IN","SIGNED_OUT","INITIAL_SESSION"].includes(event)) {
        state.user=session?.user??null;
        queueMicrotask(()=>{void loadMonth();});
      }
    });
    await loadMonth();
  }catch(e){state.error=e.message;state.loading=false;render();}
}
void startup();
