import { parseAmount, usdCents, formatUsd, monthNow, shiftMonth, overview, sameMonth } from "./budget-core.js";
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
  previous: null, previousGuidelines: [], guidelines: [], purchases: [],
  editingExpense: null, editingCategory: null, settings: false,
  loading: true, error: "", feedback: "", channel: null
};
const demoMonths = new Map();
let toastTimer;

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
  if (state.demo) {
    controls.innerHTML = '<span class="pill demo">Sample data</span><a class="button" href="./">Sign in</a>';
  } else if (state.user) {
    controls.innerHTML = '<button class="quiet mini" data-action="signout">Sign out</button>';
  } else controls.innerHTML = '<a class="button" href="./?demo=1">View sample demo</a>';
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
  for (const table of ["monthly_plans","monthly_guidelines","purchases"]) {
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
  if (state.demo) { loadDemo(); return; }
  if (!state.user) { state.loading = false; render(); return; }
  state.loading = true; render();
  try {
    await loadMember();
    if (!state.member) { state.plan = null; state.loading = false; render(); return; }
    const db = state.client, household_id = state.member.household_id, month = state.month;
    const [planResult, catResult, purchasesResult, previousResult] = await Promise.all([
      db.from("monthly_plans").select("*").eq("household_id",household_id).eq("month",month).maybeSingle(),
      db.from("monthly_guidelines").select("*").eq("household_id",household_id).eq("month",month).order("display_order").order("category"),
      db.from("purchases").select("*").eq("household_id",household_id).eq("month",month).order("spent_on",{ascending:false}).order("created_at",{ascending:false}),
      db.from("monthly_plans").select("*").eq("household_id",household_id).eq("month",shiftMonth(month,-1)).maybeSingle()
    ]);
    if (state.month !== month) return;
    state.plan = assertDb(planResult);
    state.guidelines = assertDb(catResult) ?? [];
    state.purchases = assertDb(purchasesResult) ?? [];
    state.previous = assertDb(previousResult);
    state.previousGuidelines = [];
    if (!state.plan && state.previous) {
      const prev = await db.from("monthly_guidelines").select("*").eq("household_id",household_id)
        .eq("month",shiftMonth(month,-1)).order("display_order");
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
  const intro = '<div class="page-head"><div><p class="eyebrow">Household spending</p><h1>'+clean(monthLabel(state.month))+
    '</h1><p class="muted">One balance. Flexible guidelines. No savings calculations.</p></div>'+monthPicker()+'</div>';
  if (!state.plan) {
    $("#app").innerHTML=intro+'<div class="card"><h2>Set up this month</h2><p class="muted">Confirm the normal two-paycheck income and total automatic obligations. They will stay out of the main dashboard.</p>'+monthForm()+'</div>';
    return;
  }
  const o = overview(state.plan, state.guidelines, state.purchases);
  const expenses = state.purchases;
  const sum = '<section class="summary"><p class="eyebrow">Available this month</p><div class="balance '+(o.remaining < 0?'negative':'')+'">'+formatUsd(o.remaining)+'</div><div class="summary-grid"><div><small>Starting balance</small><strong>'+formatUsd(o.starting)+'</strong></div><div><small>Purchases recorded</small><strong>−'+formatUsd(o.spent)+'</strong></div></div></section>';
  const rows = o.categories.map(c => '<tr><td><div class="name"><span class="dot"></span><span>'+clean(c.category)+'</span><button class="quiet mini" data-action="edit-category" data-id="'+clean(c.id)+'" aria-label="Edit '+clean(c.category)+' guideline">Edit</button></div></td><td>'+formatUsd(c.target_cents)+'</td><td>'+formatUsd(c.spent)+'</td><td class="'+(c.remaining < 0?'negative':'')+'">'+formatUsd(c.remaining)+'</td></tr>').join("");
  const goals = '<section class="card"><div class="card-header"><div><h2>Spending guidelines</h2><p class="muted">These can go negative. Nothing needs to be moved between categories.</p></div><button class="mini" data-action="new-category">+ Category</button></div>'+
    '<div style="overflow-x:auto"><table class="guidelines"><thead><tr><th>Category</th><th>Target</th><th>Spent</th><th>Left</th></tr></thead><tbody>'+
    (rows || '<tr><td colspan="4" class="empty">Add your first category.</td></tr>')+'</tbody></table></div>'+
    '<div class="guideline-actions"><button class="quiet mini" data-action="manage-categories">Edit guidelines</button></div>'+
    (state.editingCategory || state.editingCategory === "new" ? categoryForm() : "")+'</section>';
  const items = expenses.map(p => {
    const cat = state.guidelines.find(g=>g.id===p.guideline_id)?.category ?? "Category";
    const native = p.currency === "EUR" ? " · €"+moneyInput(p.original_amount_cents) : "";
    return '<div class="transaction"><div class="transaction-details"><strong>'+clean(cat)+(p.note?' · '+clean(p.note):'')+'</strong><span>'+clean(p.spent_on)+native+'</span></div><div class="transaction-end"><strong>'+formatUsd(p.usd_cents)+'</strong><button class="quiet mini" data-action="edit-expense" data-id="'+clean(p.id)+'" aria-label="Edit purchase">Edit</button><button class="quiet mini" data-action="delete-expense" data-id="'+clean(p.id)+'" aria-label="Delete purchase">×</button></div></div>';
  }).join("");
  const recent = '<section class="card"><div class="card-header"><div><h2>Purchases</h2><p class="muted">Shared across both phones.</p></div><button class="mini" data-action="export">Export CSV</button></div><div class="transactions">'+(items||'<div class="empty">No purchases recorded this month.</div>')+'</div></section>';
  const form = '<section class="card"><div class="card-header"><div><h2>'+(state.editingExpense?'Edit purchase':'Add a purchase')+'</h2><p class="muted">Enter only the purchases you actively make.</p></div></div>'+expenseForm()+'</section>';
  const controls='<div class="row spread" style="margin-bottom:14px"><span class="muted" id="live-update-note">'+clean(state.feedback)+'</span><div class="row"><button class="quiet mini" data-action="refresh">↻ Refresh</button><button class="mini" data-action="settings">'+(state.settings?'Close settings':'Settings')+'</button></div></div>';
  $("#app").innerHTML=intro+sum+controls+(state.settings?'<div class="card" style="margin-bottom:20px"><h2>Monthly settings</h2><p class="muted">Only the total automatic obligations belong here. No savings field.</p>'+monthForm()+'<hr style="border:0;border-top:1px solid #edf1eb;margin:22px 0"><h3>Account password</h3>'+passwordForm()+'</div>':'')+
    '<div class="two-col"><div class="stack">'+goals+recent+'</div><div class="stack">'+form+'</div></div>';
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
  const plan = state.plan ?? state.previous;
  const fromPrevious = !state.plan && !!state.previous;
  const income = plan ? moneyInput(plan.net_income_cents) : "";
  const fixed = plan ? moneyInput(plan.fixed_costs_cents) : "";
  return '<form id="month-form"><div class="fields"><label>Two-paycheck net income (USD)<input type="number" min="0" max="999999999" step=".01" name="net" required placeholder="0.00" value="'+clean(income)+'"></label>'+
    '<label>Automatic monthly obligations (USD)<input type="number" min="0" max="999999999" step=".01" name="fixed" required placeholder="0.00" value="'+clean(fixed)+'"></label></div>'+
    '<label>EUR → USD planning rate<input name="rate" type="number" step="0.000001" min="0.000001" max="9.999999" required value="'+clean(plan?.euro_to_usd ?? 1.14)+'"><span class="helper">Used for new EUR purchase entries. Existing transactions keep their recorded USD equivalent.</span></label>'+
    (fromPrevious?'<div class="notice">Prefilled from the previous month. Saving also copies its category guidelines. You can change everything before saving.</div>':'')+
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
    (purchase?'<button type="button" data-action="cancel-edit">Cancel</button>':'')+'</div></form>';
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
  if (state.demo) {
    const d=demoMonths.get(state.month),usd_cents=usdCents(original_amount_cents,currency,d.plan.euro_to_usd);
    if (existing) Object.assign(existing,{...values,usd_cents});
    else d.purchases.unshift({id:uid(),...values,usd_cents,household_id:"demo",month:state.month,created_at:new Date().toISOString()});
  } else if (existing) {
    assertDb(await state.client.from("purchases").update(values).eq("id",existing.id)
      .eq("household_id",state.member.household_id).select("id").single());
  } else {
    assertDb(await state.client.from("purchases").insert({...values,household_id:state.member.household_id,month:state.month})
      .select("id").single());
  }
  state.editingExpense=null;
  await loadMonth();
  toast(existing?"Purchase updated.":"Purchase recorded.");
}
async function deleteExpense(id) {
  if (!confirm("Delete this purchase?")) return;
  if (state.demo) {
    const d=demoMonths.get(state.month);d.purchases=d.purchases.filter(p=>p.id!==id);
  } else assertDb(await state.client.from("purchases").delete().eq("id",id).eq("household_id",state.member.household_id).select("id").single());
  if(state.editingExpense===id) state.editingExpense=null;
  await loadMonth(); toast("Purchase removed.");
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
async function handleAction(button) {
  const action=button.dataset.action, id=button.dataset.id;
  if (action==="prev-month" || action==="next-month") {
    state.month=shiftMonth(state.month,action==="prev-month"?-1:1);
    state.settings=false;state.editingExpense=null;state.editingCategory=null;
    await loadMonth();return;
  }
  if (action==="signout") {
    const {error}=await state.client.auth.signOut();
    if(error) throw error;
    state.user=null;state.member=null;state.plan=null;
    if(state.channel){await state.client.removeChannel(state.channel);state.channel=null;}
    render();return;
  }
  if(action==="refresh"){state.error="";state.feedback="";await loadMonth();return;}
  if(action==="settings"){state.settings=!state.settings;render();return;}
  if(action==="new-category"){state.editingCategory="new";render();return;}
  if(action==="manage-categories"){state.editingCategory=state.guidelines[0]?.id ?? "new";render();return;}
  if(action==="edit-category"){state.editingCategory=id;render();return;}
  if(action==="edit-expense"){state.editingExpense=id;render();return;}
  if(action==="delete-expense"){await deleteExpense(id);return;}
  if(action==="delete-category"){await deleteCategory(id);return;}
  if(action==="cancel-edit"){state.editingExpense=null;state.editingCategory=null;render();return;}
  if(action==="export"){exportCsv();return;}
}
document.addEventListener("click",async event=>{
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
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&!state.loading&&state.user&&state.member)void loadMonth();});

async function startup() {
  if(state.demo){demoSeed();loadDemo();return;}
  try {
    if(!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new Error("The application is not connected to the database yet. Contact the project administrator.");
    const {createClient}=await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/+esm");
    state.client=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:"pkce"}
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
