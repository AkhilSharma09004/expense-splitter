/**
 * app.js
 * ---------------------------------------------------------------------------
 * Owns the mutable app state and every event listener. Rendering itself
 * lives in ui.js; this file decides *when* to call it. Kept deliberately
 * framework-free (a light pub-less "mutate then render()" loop) since the
 * state tree is small enough that a virtual-DOM diff would be overkill.
 * ---------------------------------------------------------------------------
 */
let state = Store.load();

// transient (not persisted) UI state for the expense form's split editor
let splitDraft = { type: 'equal', checked: new Set(), values: {} };
let editingExpenseId = null;
let pendingGroupModalMode = 'create'; // 'create' | 'edit'
let editingGroupId = null;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function persist() { Store.save(state); }

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function daysAgoISO(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

/* =========================================================================
   VIEW ROUTING
   ========================================================================= */
function setView(view, opts = {}) {
  state.view = view;
  if (opts.groupId !== undefined) state.activeGroupId = opts.groupId;
  persist();
  closeSidebarMobile();
  render();
}

function render() {
  applyTheme();
  $('#currencySelect').value = state.currency;

  // nav active state
  $$('.nav__item').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.view === state.view));

  // sidebar group list
  const groupListEl = $('#sidebarGroupList');
  groupListEl.innerHTML = state.groups.map((g) => {
    const bal = Balance.netBalances(g.id, state)[state.meId] || 0;
    const cls = bal > 0.005 ? 'is-credit' : bal < -0.005 ? 'is-debit' : '';
    const active = state.view === 'group' && state.activeGroupId === g.id ? 'is-active' : '';
    return `<button class="sidebar__groupitem ${active}" data-open-group="${g.id}">
      <span class="grp-name">${g.icon} ${escapeHTML(g.name)}</span>
      <span class="grp-balance amt ${cls}">${bal === 0 ? '' : fmtMoney(state, Math.abs(bal))}</span>
    </button>`;
  }).join('') || `<div class="empty__sub" style="padding:4px 10px;">No groups yet</div>`;

  const titleEl = $('#pageTitle'), subEl = $('#pageSubtitle'), rootEl = $('#viewRoot');
  $('#searchInput').closest('.search').style.display = state.view === 'activity' ? '' : (window.innerWidth <= 760 ? 'flex' : '');

  if (state.view === 'dashboard') {
    titleEl.textContent = 'Dashboard';
    subEl.textContent = 'Your overall balance across every group';
    rootEl.innerHTML = renderDashboard(state);
  } else if (state.view === 'groups') {
    titleEl.textContent = 'Groups';
    subEl.textContent = `${state.groups.length} group${state.groups.length===1?'':'s'} · tap one to see the ledger`;
    rootEl.innerHTML = renderGroups(state);
  } else if (state.view === 'group') {
    const g = state.groups.find((x) => x.id === state.activeGroupId);
    titleEl.textContent = g ? `${g.icon} ${g.name}` : 'Group';
    subEl.textContent = g ? `${g.memberIds.length} members` : '';
    rootEl.innerHTML = renderGroupDetail(state, state.activeGroupId);
  } else if (state.view === 'people') {
    titleEl.textContent = 'People';
    subEl.textContent = `Everyone you've split an expense with`;
    rootEl.innerHTML = renderPeople(state);
  } else if (state.view === 'activity') {
    titleEl.textContent = 'Activity';
    subEl.textContent = 'Every expense and payment, newest first';
    rootEl.innerHTML = renderActivity(state, $('#searchInput').value);
  }
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  $('#themeIcon').textContent = state.theme === 'dark' ? '◐' : '◑';
}

function closeSidebarMobile() {
  $('#sidebar').classList.remove('is-open');
  $('#scrim').classList.remove('is-visible');
}

/* =========================================================================
   MODAL PLUMBING
   ========================================================================= */
function openModal(id) {
  $('#scrim').classList.add('is-visible');
  $(`#${id}`).classList.add('is-open');
}
function closeModal(id) {
  $(`#${id}`).classList.remove('is-open');
  const anyOpen = $$('.modal.is-open').length > 0;
  if (!anyOpen) $('#scrim').classList.remove('is-visible');
}
function closeAllModals() { $$('.modal').forEach((m) => m.classList.remove('is-open')); $('#scrim').classList.remove('is-visible'); }

/* =========================================================================
   EXPENSE MODAL
   ========================================================================= */
function allPeopleForGroup(groupId) {
  const g = state.groups.find((x) => x.id === groupId);
  if (!g) return [];
  return g.memberIds.map((id) => ({ id, name: personName(state, id) }));
}

function openExpenseModal({ groupId = null, expenseId = null } = {}) {
  editingExpenseId = expenseId;
  const form = $('#formExpense');
  form.reset();
  $('#expenseFormError').textContent = '';
  $('#btnDeleteExpense').hidden = !expenseId;
  $('#expenseCurrencyPrefix').textContent = state.currency;

  // populate group select
  const groupSel = $('#expenseGroup');
  groupSel.innerHTML = state.groups.map((g) => `<option value="${g.id}">${g.icon} ${escapeHTML(g.name)}</option>`).join('');

  let expense = null;
  if (expenseId) expense = state.activity.find((a) => a.id === expenseId);

  const initialGroupId = expense?.groupId || groupId || state.groups[0]?.id;
  if (!initialGroupId) { toast('Create a group first', 'error'); return; }
  groupSel.value = initialGroupId;

  $('#modalExpenseTitle').textContent = expense ? 'Edit expense' : 'Add an expense';
  $('#expenseDesc').value = expense?.description || '';
  $('#expenseAmount').value = expense?.amount ?? '';
  $('#expenseCategory').value = expense?.category || 'general';
  $('#expenseDate').value = expense?.date || todayISO();

  populatePaidBySelect(initialGroupId, expense?.paidBy);

  // seed split draft
  const type = expense?.splitType || 'equal';
  splitDraft.type = type;
  setSplitTypeUI(type);
  if (expense) {
    splitDraft.checked = new Set(expense.splits.map((s) => s.personId));
    splitDraft.values = {};
    if (type !== 'equal') expense.splits.forEach((s) => {
      splitDraft.values[s.personId] = type === 'percent' ? round2((s.amount / expense.amount) * 100) : (type === 'shares' ? s.amount : s.amount);
    });
  } else {
    splitDraft.checked = new Set(allPeopleForGroup(initialGroupId).map((p) => p.id));
    splitDraft.values = {};
  }

  paintSplitMembers();
  openModal('modalExpense');
}

function populatePaidBySelect(groupId, selectedId) {
  const paidSel = $('#expensePaidBy');
  const people = allPeopleForGroup(groupId);
  paidSel.innerHTML = people.map((p) => `<option value="${p.id}">${escapeHTML(p.name)}</option>`).join('');
  paidSel.value = selectedId || state.meId;
}

function setSplitTypeUI(type) {
  $$('#splitTypeToggle .segmented__opt').forEach((b) => b.classList.toggle('is-active', b.dataset.split === type));
}

function paintSplitMembers() {
  const groupId = $('#expenseGroup').value;
  const people = allPeopleForGroup(groupId);
  const amount = parseFloat($('#expenseAmount').value) || 0;
  const container = $('#splitMembers');
  const type = splitDraft.type;

  container.innerHTML = people.map((p) => {
    const checked = splitDraft.checked.has(p.id);
    let valueField = '';
    if (type === 'equal') {
      const checkedIds = people.map((x) => x.id).filter((id) => splitDraft.checked.has(id));
      const share = checked && checkedIds.length ? splitEqual(amount, checkedIds).find((s) => s.personId === p.id)?.amount : 0;
      valueField = `<span class="split-value mono" style="text-align:right; color:var(--ink-500); font-size:12.5px;">${checked ? fmtMoney(state, share || 0) : ''}</span>`;
    } else {
      const val = splitDraft.values[p.id] ?? '';
      const unit = type === 'percent' ? '%' : type === 'shares' ? '×' : '';
      valueField = `<span class="split-value"><input type="number" min="0" step="0.01" data-split-input="${p.id}" value="${val}" ${checked ? '' : 'disabled'} placeholder="0"></span><span class="unit">${unit}</span>`;
    }
    return `<label class="split-member">
      <input type="checkbox" data-split-check="${p.id}" ${checked ? 'checked' : ''}>
      ${avatarHTML(state, p.id, 'sm')}
      <span class="name">${escapeHTML(p.name)}</span>
      ${valueField}
    </label>`;
  }).join('');

  updateSplitHint();
}

function updateSplitHint() {
  const hint = $('#splitSumHint');
  const amount = parseFloat($('#expenseAmount').value) || 0;
  const checkedIds = [...splitDraft.checked];
  if (splitDraft.type === 'equal') {
    hint.textContent = checkedIds.length ? `split ${checkedIds.length} ways` : 'select at least one person';
    hint.className = `split-check ${checkedIds.length ? 'ok' : 'bad'}`;
    return;
  }
  if (splitDraft.type === 'unequal') {
    const sum = round2(checkedIds.reduce((s, id) => s + (parseFloat(splitDraft.values[id]) || 0), 0));
    hint.textContent = `${fmtMoney(state, sum)} / ${fmtMoney(state, amount)}`;
    hint.className = `split-check ${Math.abs(sum - amount) < 0.01 && checkedIds.length ? 'ok' : 'bad'}`;
    return;
  }
  if (splitDraft.type === 'percent') {
    const sum = round2(checkedIds.reduce((s, id) => s + (parseFloat(splitDraft.values[id]) || 0), 0));
    hint.textContent = `${sum}% / 100%`;
    hint.className = `split-check ${Math.abs(sum - 100) < 0.01 && checkedIds.length ? 'ok' : 'bad'}`;
    return;
  }
  if (splitDraft.type === 'shares') {
    const sum = round2(checkedIds.reduce((s, id) => s + (parseFloat(splitDraft.values[id]) || 0), 0));
    hint.textContent = `${sum} share${sum===1?'':'s'} total`;
    hint.className = `split-check ${sum > 0 && checkedIds.length ? 'ok' : 'bad'}`;
  }
}

function computeSplitsFromDraft(amount) {
  const checkedIds = [...splitDraft.checked];
  if (splitDraft.type === 'equal') return splitEqual(amount, checkedIds);
  if (splitDraft.type === 'unequal') {
    const amounts = {}; checkedIds.forEach((id) => amounts[id] = splitDraft.values[id] || 0);
    return splitExact(amounts);
  }
  if (splitDraft.type === 'percent') {
    const pcts = {}; checkedIds.forEach((id) => pcts[id] = splitDraft.values[id] || 0);
    return splitPercent(amount, pcts);
  }
  const shares = {}; checkedIds.forEach((id) => shares[id] = splitDraft.values[id] || 0);
  return splitShares(amount, shares);
}

function splitIsValid(amount) {
  const checkedIds = [...splitDraft.checked];
  if (!checkedIds.length) return false;
  if (splitDraft.type === 'equal') return true;
  if (splitDraft.type === 'unequal') {
    const sum = round2(checkedIds.reduce((s, id) => s + (parseFloat(splitDraft.values[id]) || 0), 0));
    return Math.abs(sum - amount) < 0.01;
  }
  if (splitDraft.type === 'percent') {
    const sum = round2(checkedIds.reduce((s, id) => s + (parseFloat(splitDraft.values[id]) || 0), 0));
    return Math.abs(sum - 100) < 0.01;
  }
  const sum = round2(checkedIds.reduce((s, id) => s + (parseFloat(splitDraft.values[id]) || 0), 0));
  return sum > 0;
}

/* =========================================================================
   GROUP MODAL
   ========================================================================= */
function openGroupModal({ groupId = null } = {}) {
  editingGroupId = groupId;
  pendingGroupModalMode = groupId ? 'edit' : 'create';
  const group = groupId ? state.groups.find((g) => g.id === groupId) : null;

  $('#formGroup').reset();
  $('#groupFormError').textContent = '';
  $('#modalGroupTitle').textContent = group ? 'Manage members' : 'Create a group';
  $('#groupName').value = group?.name || '';
  $('#groupIcon').value = group?.icon || '🧳';

  paintGroupMemberChecklist(group ? new Set(group.memberIds) : new Set([state.meId]));
  openModal('modalGroup');
}

function paintGroupMemberChecklist(checkedSet) {
  const container = $('#groupMembers');
  const all = [{ id: state.meId, name: 'You' }, ...state.people.map((p) => ({ id: p.id, name: p.name }))];
  container.innerHTML = all.map((p) => `
    <label class="split-member">
      <input type="checkbox" data-group-member="${p.id}" ${checkedSet.has(p.id) ? 'checked' : ''} ${p.id === state.meId ? 'disabled checked' : ''}>
      ${avatarHTML(state, p.id, 'sm')}
      <span class="name">${escapeHTML(p.name)}</span>
    </label>`).join('');
}

/* =========================================================================
   PERSON MODAL
   ========================================================================= */
let personModalReturnTo = null;
function openPersonModal(returnTo = null) {
  personModalReturnTo = returnTo;
  $('#formPerson').reset();
  $('#personFormError').textContent = '';
  openModal('modalPerson');
  setTimeout(() => $('#personName').focus(), 50);
}

/* =========================================================================
   SETTLE MODAL
   ========================================================================= */
function openSettleModal({ groupId, from = '', to = '', amount = '' } = {}) {
  const group = state.groups.find((g) => g.id === groupId) || state.groups[0];
  if (!group) { toast('Create a group first', 'error'); return; }
  $('#formSettle').reset();
  $('#settleFormError').textContent = '';
  $('#settleGroupId').value = group.id;
  $('#settleCurrencyPrefix').textContent = state.currency;
  const people = allPeopleForGroup(group.id);
  const opts = people.map((p) => `<option value="${p.id}">${escapeHTML(p.name)}</option>`).join('');
  $('#settleFrom').innerHTML = opts;
  $('#settleTo').innerHTML = opts;
  if (from) $('#settleFrom').value = from;
  if (to) $('#settleTo').value = to;
  if (amount) $('#settleAmount').value = amount;
  openModal('modalSettle');
}

/* =========================================================================
   SEED / DEMO DATA
   ========================================================================= */
function seedDemoData() {
  const priya = Models.person('Priya Sharma');
  const rohan = Models.person('Rohan Mehta');
  const aditi = Models.person('Aditi Rao');
  const vikram = Models.person('Vikram Nair');

  const trip = Models.group('Goa Trip', '🧳', [state.meId, priya.id, rohan.id, aditi.id]);
  const flat = Models.group('Flatmates', '🏠', [state.meId, vikram.id, priya.id]);

  state.people = [priya, rohan, aditi, vikram];
  state.groups = [trip, flat];

  const mk = (groupId, description, amount, category, daysAgo, paidBy, splitType, splitFn) => {
    const members = state.groups.find((g) => g.id === groupId).memberIds;
    return Models.expense({
      groupId, description, amount, category, date: daysAgoISO(daysAgo), paidBy, splitType,
      splits: splitFn(members),
    });
  };

  const tripMembers = trip.memberIds;
  const flatMembers = flat.memberIds;

  state.activity = [
    mk(trip.id, 'Flights to Goa', 24000, 'travel', 18, state.meId, 'equal', (m) => splitEqual(24000, m)),
    mk(trip.id, 'Beach resort · 3 nights', 18600, 'stay', 17, priya.id, 'equal', (m) => splitEqual(18600, m)),
    mk(trip.id, 'Seafood dinner at Britto\'s', 4820, 'food', 16, rohan.id, 'equal', (m) => splitEqual(4820, m)),
    mk(trip.id, 'Scuba diving', 9000, 'fun', 15, state.meId, 'unequal', () => splitExact({ [state.meId]: 3000, [priya.id]: 3000, [rohan.id]: 3000 })),
    mk(trip.id, 'Cab from airport', 1400, 'travel', 18, aditi.id, 'shares', () => splitShares(1400, { [state.meId]: 1, [priya.id]: 1, [rohan.id]: 1, [aditi.id]: 1 })),
    mk(trip.id, 'Groceries for the villa', 2350, 'groceries', 16, priya.id, 'percent', () => splitPercent(2350, { [state.meId]: 25, [priya.id]: 25, [rohan.id]: 25, [aditi.id]: 25 })),
    mk(flat.id, 'Electricity bill · June', 3200, 'utilities', 9, vikram.id, 'equal', (m) => splitEqual(3200, m)),
    mk(flat.id, 'Groceries — BigBasket', 2860, 'groceries', 6, state.meId, 'equal', (m) => splitEqual(2860, m)),
    mk(flat.id, 'Broadband bill', 1499, 'utilities', 4, priya.id, 'equal', (m) => splitEqual(1499, m)),
    mk(flat.id, 'Weekend movie night', 1240, 'fun', 2, vikram.id, 'equal', (m) => splitEqual(1240, m)),
    Models.settlement({ groupId: trip.id, from: aditi.id, to: state.meId, amount: 2500, date: daysAgoISO(10) }),
  ];

  state.view = 'dashboard';
  state.activeGroupId = null;
  persist();
  render();
  toast('Loaded sample data', 'success');
}

/* =========================================================================
   EVENT WIRING
   ========================================================================= */
function init() {
  if (!state.people.length && !state.groups.length) seedDemoData();
  render();

  // --- primary nav ---
  $$('.nav__item').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));

  // --- delegated clicks across the app ---
  document.addEventListener('click', (e) => {
    const openGroupBtn = e.target.closest('[data-open-group]');
    if (openGroupBtn) { setView('group', { groupId: openGroupBtn.dataset.openGroup }); return; }

    const gotoBtn = e.target.closest('[data-goto]');
    if (gotoBtn) { setView(gotoBtn.dataset.goto); return; }

    const openItemEl = e.target.closest('[data-open-item]');
    if (openItemEl) {
      const item = state.activity.find((a) => a.id === openItemEl.dataset.openItem);
      if (item?.type === 'expense') openExpenseModal({ expenseId: item.id });
      else if (item?.type === 'settlement') {
        if (confirm(`Delete this ${fmtMoney(state, item.amount)} payment from ${personName(state,item.from)} to ${personName(state,item.to)}?`)) {
          state.activity = state.activity.filter((a) => a.id !== item.id);
          persist(); render(); toast('Payment deleted');
        }
      }
      return;
    }

    const settleTxnBtn = e.target.closest('[data-settle-txn]');
    if (settleTxnBtn) {
      openSettleModal({ groupId: settleTxnBtn.dataset.group, from: settleTxnBtn.dataset.from, to: settleTxnBtn.dataset.to, amount: settleTxnBtn.dataset.amount });
      return;
    }

    if (e.target.id === 'btnEmptyNewGroup' || e.target.id === 'btnSidebarAddGroup') { openGroupModal({}); return; }
    if (e.target.id === 'btnEditGroupMembers') { openGroupModal({ groupId: state.activeGroupId }); return; }
    if (e.target.id === 'btnGroupNewPerson') { openPersonModal('group'); return; }

    if (e.target.closest('[data-detail-tab]')) {
      const tabBtn = e.target.closest('[data-detail-tab]');
      $$('.tabs__item').forEach((b) => b.classList.toggle('is-active', b === tabBtn));
      if (tabBtn.dataset.detailTab === 'settle') {
        openSettleModal({ groupId: state.activeGroupId });
        // revert tab highlight back to expenses since settle opens a modal, not a persistent tab
        setTimeout(() => $$('.tabs__item').forEach((b) => b.classList.toggle('is-active', b.dataset.detailTab === 'expenses')), 50);
      }
      return;
    }

    if (e.target.closest('[data-close-modal]')) { closeAllModals(); return; }
  });

  $('#scrim').addEventListener('click', closeAllModals);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllModals(); });

  // --- top bar ---
  $('#btnAddExpense').addEventListener('click', () => openExpenseModal({ groupId: state.activeGroupId }));
  $('#btnMobileAdd').addEventListener('click', () => openExpenseModal({ groupId: state.activeGroupId }));
  $('#searchInput').addEventListener('input', () => { if (state.view === 'activity') render(); });

  // --- mobile sidebar ---
  $('#btnMenu').addEventListener('click', () => { $('#sidebar').classList.add('is-open'); $('#scrim').classList.add('is-visible'); });
  $('#scrim').addEventListener('click', closeSidebarMobile);

  // --- theme / currency / demo reset ---
  $('#btnTheme').addEventListener('click', () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; persist(); applyTheme(); });
  $('#currencySelect').addEventListener('change', (e) => { state.currency = e.target.value; persist(); render(); });
  $('#btnResetDemo').addEventListener('click', () => {
    if (confirm('Replace all current data with fresh sample data? This cannot be undone.')) seedDemoData();
  });

  /* ---------------- EXPENSE FORM ---------------- */
  $('#expenseGroup').addEventListener('change', (e) => {
    populatePaidBySelect(e.target.value);
    splitDraft.checked = new Set(allPeopleForGroup(e.target.value).map((p) => p.id));
    splitDraft.values = {};
    paintSplitMembers();
  });
  $('#expenseAmount').addEventListener('input', () => paintSplitMembers());
  $('#splitTypeToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.segmented__opt');
    if (!btn) return;
    splitDraft.type = btn.dataset.split;
    splitDraft.values = {};
    setSplitTypeUI(splitDraft.type);
    paintSplitMembers();
  });
  $('#splitMembers').addEventListener('change', (e) => {
    const checkEl = e.target.closest('[data-split-check]');
    if (checkEl) {
      const id = checkEl.dataset.splitCheck;
      if (checkEl.checked) splitDraft.checked.add(id); else splitDraft.checked.delete(id);
      paintSplitMembers();
    }
  });
  $('#splitMembers').addEventListener('input', (e) => {
    const valEl = e.target.closest('[data-split-input]');
    if (valEl) { splitDraft.values[valEl.dataset.splitInput] = valEl.value; updateSplitHint(); }
  });

  $('#formExpense').addEventListener('submit', (e) => {
    e.preventDefault();
    const groupId = $('#expenseGroup').value;
    const amount = parseFloat($('#expenseAmount').value);
    const errEl = $('#expenseFormError');
    if (!amount || amount <= 0) { errEl.textContent = 'Enter an amount greater than zero.'; return; }
    if (!splitIsValid(amount)) { errEl.textContent = 'Your split doesn\'t add up yet — check the amounts above.'; return; }

    const splits = computeSplitsFromDraft(amount).filter((s) => splitDraft.checked.has(s.personId));
    const payload = {
      groupId,
      description: $('#expenseDesc').value || 'Expense',
      amount,
      category: $('#expenseCategory').value,
      date: $('#expenseDate').value || todayISO(),
      paidBy: $('#expensePaidBy').value,
      splitType: splitDraft.type,
      splits,
    };

    if (editingExpenseId) {
      const idx = state.activity.findIndex((a) => a.id === editingExpenseId);
      if (idx > -1) state.activity[idx] = { ...state.activity[idx], ...payload };
      toast('Expense updated', 'success');
    } else {
      state.activity.push(Models.expense(payload));
      toast('Expense added', 'success');
    }
    persist();
    closeAllModals();
    setView('group', { groupId });
  });

  $('#btnDeleteExpense').addEventListener('click', () => {
    if (!editingExpenseId) return;
    if (confirm('Delete this expense? This cannot be undone.')) {
      state.activity = state.activity.filter((a) => a.id !== editingExpenseId);
      persist();
      closeAllModals();
      render();
      toast('Expense deleted');
    }
  });

  /* ---------------- GROUP FORM ---------------- */
  $('#formGroup').addEventListener('submit', (e) => {
    e.preventDefault();
    const errEl = $('#groupFormError');
    const name = $('#groupName').value.trim();
    if (!name) { errEl.textContent = 'Give the group a name.'; return; }
    const checked = $$('#groupMembers [data-group-member]').filter((c) => c.checked).map((c) => c.dataset.groupMember);
    if (checked.length < 2) { errEl.textContent = 'Add at least one other person to the group.'; return; }

    if (pendingGroupModalMode === 'edit' && editingGroupId) {
      const group = state.groups.find((g) => g.id === editingGroupId);
      const removed = group.memberIds.filter((id) => !checked.includes(id));
      const balances = Balance.netBalances(group.id, state);
      const blocked = removed.find((id) => Math.abs(balances[id] || 0) > 0.01);
      if (blocked) { errEl.textContent = `Can't remove ${personName(state, blocked)} — they still have a nonzero balance in this group.`; return; }
      group.name = name;
      group.icon = $('#groupIcon').value;
      group.memberIds = checked;
      toast('Group updated', 'success');
      persist();
      closeAllModals();
      render();
    } else {
      const group = Models.group(name, $('#groupIcon').value, checked);
      state.groups.push(group);
      persist();
      closeAllModals();
      toast('Group created', 'success');
      setView('group', { groupId: group.id });
    }
  });

  /* ---------------- PERSON FORM ---------------- */
  $('#formPerson').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#personName').value.trim();
    const errEl = $('#personFormError');
    if (!name) { errEl.textContent = 'Enter a name.'; return; }
    const person = Models.person(name);
    state.people.push(person);
    persist();
    closeModal('modalPerson');
    toast(`Added ${name}`, 'success');
    if (personModalReturnTo === 'group') {
      const checkedNow = new Set($$('#groupMembers [data-group-member]').filter((c) => c.checked).map((c) => c.dataset.groupMember));
      checkedNow.add(person.id);
      paintGroupMemberChecklist(checkedNow);
      openModal('modalGroup');
    } else {
      render();
    }
  });

  /* ---------------- SETTLE FORM ---------------- */
  $('#formSettle').addEventListener('submit', (e) => {
    e.preventDefault();
    const errEl = $('#settleFormError');
    const from = $('#settleFrom').value, to = $('#settleTo').value;
    const amount = parseFloat($('#settleAmount').value);
    if (from === to) { errEl.textContent = 'Pick two different people.'; return; }
    if (!amount || amount <= 0) { errEl.textContent = 'Enter an amount greater than zero.'; return; }
    state.activity.push(Models.settlement({ groupId: $('#settleGroupId').value, from, to, amount, date: todayISO() }));
    persist();
    closeAllModals();
    render();
    toast('Payment recorded', 'success');
  });

  window.addEventListener('resize', () => { if (window.innerWidth > 760) closeSidebarMobile(); });
}

document.addEventListener('DOMContentLoaded', init);
