/**
 * ui.js
 * ---------------------------------------------------------------------------
 * Every function in here is a "renderer": (state, ...) -> HTML string, or a
 * DOM helper (toast, avatar colour). Nothing here mutates app state — that
 * separation keeps app.js the single place that decides *when* to re-render
 * after a state change.
 * ---------------------------------------------------------------------------
 */
const CATEGORIES = {
  general:   { icon: '🧾', label: 'General',        color: '#8B9C94' },
  food:      { icon: '🍔', label: 'Food & drink',    color: '#C1483A' },
  travel:    { icon: '🚕', label: 'Travel',          color: '#B98A2E' },
  stay:      { icon: '🏨', label: 'Stay',            color: '#0F7C6C' },
  groceries: { icon: '🛒', label: 'Groceries',       color: '#1B8A5A' },
  utilities: { icon: '💡', label: 'Utilities',       color: '#4C6FA8' },
  fun:       { icon: '🎟️', label: 'Entertainment',   color: '#8B5FBF' },
  shopping:  { icon: '🛍️', label: 'Shopping',        color: '#C4699B' },
  other:     { icon: '📦', label: 'Other',           color: '#5C6D66' },
};

const AVATAR_PALETTE = ['#0F7C6C', '#C1483A', '#B98A2E', '#4C6FA8', '#8B5FBF', '#C4699B', '#1B8A5A', '#946B3B'];

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
  return Math.abs(h);
}
function avatarColor(id) { return AVATAR_PALETTE[hashStr(id) % AVATAR_PALETTE.length]; }
function initials(name) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}
function personById(state, id) { return state.people.find((p) => p.id === id); }
function personName(state, id) {
  if (id === state.meId) return 'You';
  return personById(state, id)?.name || 'Unknown';
}
function avatarHTML(state, id, size = '') {
  const name = personName(state, id);
  const cls = size ? `avatar avatar--${size}` : 'avatar';
  return `<span class="${cls}" style="background:${avatarColor(id)}">${initials(name === 'You' ? (personById(state,id)?.name || 'You') : name)}</span>`;
}
function fmtMoney(state, amount) {
  const n = Math.abs(amount) < 0.005 ? 0 : amount;
  return `${state.currency}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDateGroup(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  const diffDays = Math.round((today - d) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}
function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function toast(message, tone = 'default') {
  const wrap = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  const dot = tone === 'success' ? '✓' : tone === 'error' ? '!' : '·';
  el.innerHTML = `<span aria-hidden="true">${dot}</span> ${escapeHTML(message)}`;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s ease'; setTimeout(() => el.remove(), 260); }, 2600);
}

/* ============================= DASHBOARD ============================= */

function renderDashboard(state) {
  const summary = Balance.globalSummary(state);
  const netClass = summary.net > 0.005 ? 'is-credit' : summary.net < -0.005 ? 'is-debit' : 'is-zero';
  const netLabel = summary.net > 0.005 ? 'you are owed overall' : summary.net < -0.005 ? 'you owe overall' : "you're all settled up";

  const owedRows = Object.entries(summary.owedToMe).sort((a,b) => b[1]-a[1]);
  const oweRows = Object.entries(summary.iOwe).sort((a,b) => b[1]-a[1]);

  // category breakdown across expenses the user actually participates in
  const catTotals = {};
  for (const item of state.activity) {
    if (item.type !== 'expense') continue;
    const mine = item.splits.find((s) => s.personId === state.meId);
    if (!mine) continue;
    catTotals[item.category] = (catTotals[item.category] || 0) + mine.amount;
  }
  const catSegments = Object.entries(catTotals)
    .sort((a,b) => b[1]-a[1])
    .map(([cat, val]) => ({ label: CATEGORIES[cat]?.label || cat, color: CATEGORIES[cat]?.color || '#888', value: round2(val) }));
  const catTotal = catSegments.reduce((s,c) => s+c.value, 0);

  const recentActivity = [...state.activity].sort((a,b) => b.createdAt - a.createdAt).slice(0, 5);

  return `
    <div class="receipt">
      <div class="receipt__eyebrow">Tally · overall balance</div>
      <div class="receipt__row">
        <div>
          <div class="receipt__amount ${netClass}">${summary.net === 0 ? fmtMoney(state,0) : fmtMoney(state, Math.abs(summary.net))}</div>
          <div class="receipt__caption">${netLabel}${state.groups.length ? '' : ' — create a group to get started'}</div>
        </div>
        <div class="receipt__stub">
          <div class="receipt__stat"><div class="num mono" style="color:var(--credit)">${fmtMoney(state, summary.totalOwed)}</div><div class="lbl">owed to you</div></div>
          <div class="receipt__stat"><div class="num mono" style="color:var(--debit)">${fmtMoney(state, summary.totalOwe)}</div><div class="lbl">you owe</div></div>
          <div class="receipt__stat"><div class="num mono">${state.groups.length}</div><div class="lbl">${state.groups.length===1?'group':'groups'}</div></div>
        </div>
      </div>
      <div class="receipt__barcode" aria-hidden="true"></div>
    </div>

    <div class="grid grid--dash">
      <div class="grid" style="gap:18px;">
        <div class="card">
          <div class="card__head"><span class="card__title">Owes you</span></div>
          ${owedRows.length ? owedRows.map(([id, amt]) => `
            <div class="person-row">
              <div class="person-id">${avatarHTML(state, id)}<span class="txt">${escapeHTML(personName(state, id))}</span></div>
              <span class="amt is-credit">${fmtMoney(state, amt)}</span>
            </div>`).join('') : `<div class="empty"><div class="empty__icon">🌿</div><div class="empty__title">Nobody owes you right now</div></div>`}
        </div>
        <div class="card">
          <div class="card__head"><span class="card__title">You owe</span></div>
          ${oweRows.length ? oweRows.map(([id, amt]) => `
            <div class="person-row">
              <div class="person-id">${avatarHTML(state, id)}<span class="txt">${escapeHTML(personName(state, id))}</span></div>
              <span class="amt is-debit">${fmtMoney(state, amt)}</span>
            </div>`).join('') : `<div class="empty"><div class="empty__icon">✅</div><div class="empty__title">You don't owe anyone</div></div>`}
        </div>
      </div>

      <div class="grid" style="gap:18px;">
        <div class="card">
          <div class="card__head"><span class="card__title">Where your money goes</span></div>
          ${catTotal > 0 ? `
            <div style="display:flex; align-items:center; gap:20px;">
              ${Charts.donut(catSegments)}
              <div class="legend" style="flex:1;">
                ${catSegments.slice(0,5).map((s) => `
                  <div class="legend__row">
                    <span class="legend__dot" style="background:${s.color}"></span>
                    <span class="legend__name">${escapeHTML(s.label)}</span>
                    <span class="legend__val">${fmtMoney(state, s.value)}</span>
                  </div>`).join('')}
              </div>
            </div>` : `<div class="empty"><div class="empty__icon">📊</div><div class="empty__title">No expenses yet</div><div class="empty__sub">Add one to see your breakdown</div></div>`}
        </div>

        <div class="card">
          <div class="card__head"><span class="card__title">Recent activity</span><button class="card__link" data-goto="activity">View all</button></div>
          ${recentActivity.length ? `<div class="feed">${recentActivity.map((item) => feedItemHTML(state, item)).join('')}</div>`
            : `<div class="empty"><div class="empty__icon">🧾</div><div class="empty__title">Nothing here yet</div><div class="empty__sub">Add your first expense to start the ledger</div></div>`}
        </div>
      </div>
    </div>
  `;
}

/* ============================== GROUPS ============================== */

function renderGroups(state) {
  if (!state.groups.length) {
    return `<div class="empty" style="padding:70px 16px;">
      <div class="empty__icon">🧳</div>
      <div class="empty__title">No groups yet</div>
      <div class="empty__sub">Create one for a trip, a flat share, or any shared cost</div>
      <button class="btn btn--primary" style="margin-top:16px;" id="btnEmptyNewGroup">+ New group</button>
    </div>`;
  }
  return `<div class="group-cards">
    ${state.groups.map((g) => {
      const balances = Balance.netBalances(g.id, state);
      const mine = balances[state.meId] || 0;
      const cls = mine > 0.005 ? 'is-credit' : mine < -0.005 ? 'is-debit' : 'is-zero';
      const label = mine > 0.005 ? 'you are owed' : mine < -0.005 ? 'you owe' : 'settled up';
      return `
      <button class="group-card" data-open-group="${g.id}">
        <div class="group-card__icon">${g.icon}</div>
        <div class="group-card__name">${escapeHTML(g.name)}</div>
        <div class="group-card__meta">${g.memberIds.length} member${g.memberIds.length===1?'':'s'}</div>
        <div class="balance-pill ${cls}">${label}${mine !== 0 ? ' · ' + fmtMoney(state, Math.abs(mine)) : ''}</div>
        <div class="group-card__avatars">${g.memberIds.slice(0,5).map((id) => avatarHTML(state, id, 'sm')).join('')}</div>
      </button>`;
    }).join('')}
  </div>`;
}

function renderGroupDetail(state, groupId) {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return `<div class="empty"><div class="empty__title">Group not found</div></div>`;

  const balances = Balance.netBalances(groupId, state);
  const txns = Balance.simplifyDebts(balances);
  const items = state.activity.filter((a) => a.groupId === groupId).sort((a,b) => b.createdAt - a.createdAt);

  return `
    <div class="card" style="margin-bottom:20px;">
      <div class="card__head">
        <div style="display:flex; align-items:center; gap:12px;">
          <div class="group-card__icon" style="margin:0;">${group.icon}</div>
          <div>
            <div class="card__title" style="font-size:17px;">${escapeHTML(group.name)}</div>
            <div class="group-card__meta">${group.memberIds.map((id) => escapeHTML(personName(state,id))).join(', ')}</div>
          </div>
        </div>
        <button class="btn btn--ghost btn--sm" id="btnEditGroupMembers">Manage members</button>
      </div>
      <div class="grid grid--2">
        <div>
          <div class="split-header" style="margin-bottom:8px;"><label>Balances</label></div>
          ${group.memberIds.map((id) => {
            const b = balances[id] || 0;
            const cls = b > 0.005 ? 'is-credit' : b < -0.005 ? 'is-debit' : 'is-zero';
            return `<div class="person-row">
              <div class="person-id">${avatarHTML(state,id)}<span class="txt">${escapeHTML(personName(state,id))}</span></div>
              <span class="amt ${cls}">${b === 0 ? 'settled up' : (b>0?'+ ':'- ') + fmtMoney(state, Math.abs(b))}</span>
            </div>`;
          }).join('')}
        </div>
        <div>
          <div class="split-header" style="margin-bottom:8px;"><label>Suggested settlements</label></div>
          ${txns.length ? `<div class="settle-list">${txns.map((t) => `
            <div class="settle-row">
              ${avatarHTML(state, t.from, 'sm')}
              <span class="who">${escapeHTML(personName(state,t.from))}</span>
              <span class="arrow">→</span>
              ${avatarHTML(state, t.to, 'sm')}
              <span class="who">${escapeHTML(personName(state,t.to))}</span>
              <span class="amt">${fmtMoney(state, t.amount)}</span>
              <button class="btn btn--ghost btn--sm" data-settle-txn data-from="${t.from}" data-to="${t.to}" data-amount="${t.amount}" data-group="${groupId}">Settle</button>
            </div>`).join('')}</div>`
            : `<div class="empty" style="padding:20px;"><div class="empty__icon">🎉</div><div class="empty__title">Everyone's square</div></div>`}
        </div>
      </div>
    </div>

    <div class="tabs">
      <button class="tabs__item is-active" data-detail-tab="expenses">Expenses</button>
      <button class="tabs__item" data-detail-tab="settle">Record a payment</button>
    </div>
    <div id="groupDetailBody">
      ${items.length ? `<div class="feed">${items.map((item) => feedItemHTML(state, item)).join('')}</div>`
        : `<div class="empty"><div class="empty__icon">🧾</div><div class="empty__title">No expenses in this group yet</div></div>`}
    </div>
  `;
}

/* ============================== PEOPLE ============================== */

function renderPeople(state) {
  const rows = [{ id: state.meId, name: 'You', isMe: true }, ...state.people.map((p) => ({ id: p.id, name: p.name }))];
  return `<div class="card">
    ${rows.map((p) => {
      // aggregate this person's balance with "me" across all shared groups
      let net = 0;
      if (!p.isMe) {
        for (const g of state.groups) {
          if (!g.memberIds.includes(p.id) || !g.memberIds.includes(state.meId)) continue;
          const bal = Balance.netBalances(g.id, state);
          const txns = Balance.simplifyDebts(bal);
          for (const t of txns) {
            if (t.from === state.meId && t.to === p.id) net -= t.amount;
            if (t.to === state.meId && t.from === p.id) net += t.amount;
          }
        }
      }
      const cls = net > 0.005 ? 'is-credit' : net < -0.005 ? 'is-debit' : 'is-zero';
      const groupsShared = state.groups.filter((g) => g.memberIds.includes(p.id)).length;
      return `<div class="person-row">
        <div class="person-id">
          ${avatarHTML(state, p.id, 'lg')}
          <div>
            <div class="txt">${escapeHTML(p.name)}${p.isMe ? ' <span class="sub">(you)</span>' : ''}</div>
            <div class="sub">${groupsShared} group${groupsShared===1?'':'s'}</div>
          </div>
        </div>
        ${p.isMe ? '' : `<span class="amt ${cls}">${net===0?'settled up':(net>0?'owes you ':'you owe ') + fmtMoney(state, Math.abs(net))}</span>`}
      </div>`;
    }).join('')}
  </div>`;
}

/* ============================= ACTIVITY ============================= */

function feedItemHTML(state, item) {
  if (item.type === 'settlement') {
    const involvesMe = item.from === state.meId || item.to === state.meId;
    return `<div class="feed-item is-settlement" data-open-item="${item.id}">
      <div class="feed-item__icon">🤝</div>
      <div class="feed-item__body">
        <div class="feed-item__title">${escapeHTML(personName(state,item.from))} paid ${escapeHTML(personName(state,item.to))}</div>
        <div class="feed-item__sub">${fmtDate(item.date)} · Settlement</div>
      </div>
      <div class="feed-item__right">
        <div class="feed-item__amt">${fmtMoney(state, item.amount)}</div>
        ${involvesMe ? `<div class="feed-item__you" style="color:var(--ink-500)">settled</div>` : ''}
      </div>
    </div>`;
  }
  const mySplit = item.splits.find((s) => s.personId === state.meId);
  const iPaid = item.paidBy === state.meId;
  let youLabel = '', youColor = 'var(--ink-500)';
  if (iPaid && mySplit) {
    const diff = round2(item.amount - mySplit.amount);
    if (diff > 0.005) { youLabel = `you lent ${fmtMoney(state, diff)}`; youColor = 'var(--credit)'; }
  } else if (iPaid) {
    youLabel = `you lent ${fmtMoney(state, item.amount)}`; youColor = 'var(--credit)';
  } else if (mySplit) {
    youLabel = `you owe ${fmtMoney(state, mySplit.amount)}`; youColor = 'var(--debit)';
  }
  const cat = CATEGORIES[item.category] || CATEGORIES.other;
  return `<div class="feed-item" data-open-item="${item.id}">
    <div class="feed-item__icon">${cat.icon}</div>
    <div class="feed-item__body">
      <div class="feed-item__title">${escapeHTML(item.description)}</div>
      <div class="feed-item__sub">${fmtDate(item.date)} · ${escapeHTML(personName(state,item.paidBy))} paid ${fmtMoney(state, item.amount)}</div>
    </div>
    <div class="feed-item__right">
      <div class="feed-item__amt">${fmtMoney(state, item.amount)}</div>
      ${youLabel ? `<div class="feed-item__you" style="color:${youColor}">${youLabel}</div>` : ''}
    </div>
  </div>`;
}

function renderActivity(state, searchTerm = '') {
  let items = [...state.activity];
  if (searchTerm.trim()) {
    const q = searchTerm.trim().toLowerCase();
    items = items.filter((item) => {
      if (item.type === 'expense') {
        return item.description.toLowerCase().includes(q) || (CATEGORIES[item.category]?.label || '').toLowerCase().includes(q) || personName(state,item.paidBy).toLowerCase().includes(q);
      }
      return personName(state,item.from).toLowerCase().includes(q) || personName(state,item.to).toLowerCase().includes(q);
    });
  }
  items.sort((a,b) => (b.date.localeCompare(a.date)) || (b.createdAt - a.createdAt));

  if (!items.length) {
    return `<div class="empty" style="padding:70px 16px;"><div class="empty__icon">🔍</div><div class="empty__title">No activity found</div><div class="empty__sub">Try a different search, or add your first expense</div></div>`;
  }

  let currentDay = null;
  let html = '';
  for (const item of items) {
    const dayLabel = fmtDateGroup(item.date);
    if (dayLabel !== currentDay) { html += `<div class="feed-day">${dayLabel}</div>`; currentDay = dayLabel; }
    html += feedItemHTML(state, item);
  }
  return `<div class="feed">${html}</div>`;
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
