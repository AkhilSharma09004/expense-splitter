/**
 * models.js
 * ---------------------------------------------------------------------------
 * Plain-object factories for the three entities in the app (Person, Group,
 * Expense/Settlement), plus the pure math for turning "$total split N ways"
 * into exact per-person amounts under four split strategies.
 *
 * Every split function returns an array of {personId, amount} that sums to
 * *exactly* the original total (to the cent) — leftover paise from rounding
 * are handed to the first participants so the ledger always balances.
 * ---------------------------------------------------------------------------
 */

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const Models = {
  person(name) {
    return { id: uid('p'), name: name.trim(), createdAt: Date.now() };
  },

  group(name, icon, memberIds) {
    return { id: uid('g'), name: name.trim(), icon: icon || '👥', memberIds: [...memberIds], createdAt: Date.now() };
  },

  expense({ groupId, description, amount, category, date, paidBy, splitType, splits }) {
    return {
      id: uid('e'),
      type: 'expense',
      groupId,
      description: description.trim(),
      amount: round2(amount),
      category: category || 'general',
      date, // 'YYYY-MM-DD'
      paidBy,
      splitType, // 'equal' | 'unequal' | 'percent' | 'shares'
      splits,    // [{personId, amount}]
      createdAt: Date.now(),
    };
  },

  settlement({ groupId, from, to, amount, date }) {
    return {
      id: uid('s'),
      type: 'settlement',
      groupId,
      from,
      to,
      amount: round2(amount),
      date,
      createdAt: Date.now(),
    };
  },
};

/**
 * Distribute `total` across `ids` evenly, resolving rounding remainders by
 * handing out one extra cent at a time to the first participants.
 */
function splitEqual(total, ids) {
  const n = ids.length;
  if (n === 0) return [];
  const base = Math.floor((total / n) * 100) / 100;
  let distributed = round2(base * n);
  let remainder = round2(total - distributed);
  const cents = Math.round(remainder * 100);
  return ids.map((personId, i) => {
    const bump = i < cents ? 0.01 : 0;
    return { personId, amount: round2(base + bump) };
  });
}

/** Caller supplies exact amounts per person; we just validate & pass through. */
function splitExact(amounts) {
  return Object.entries(amounts).map(([personId, amount]) => ({ personId, amount: round2(Number(amount) || 0) }));
}

/** Percentages (0-100) per person -> converted to money, remainder patched onto the largest share. */
function splitPercent(total, percentages) {
  const entries = Object.entries(percentages);
  const raw = entries.map(([personId, pct]) => ({ personId, amount: round2((total * (Number(pct) || 0)) / 100) }));
  const sum = round2(raw.reduce((s, r) => s + r.amount, 0));
  const diff = round2(total - sum);
  if (diff !== 0 && raw.length) {
    raw.sort((a, b) => b.amount - a.amount);
    raw[0].amount = round2(raw[0].amount + diff);
  }
  return raw;
}

/** Share units (e.g. 2 shares vs 1 share) -> proportional money split, remainder to largest share. */
function splitShares(total, shares) {
  const entries = Object.entries(shares);
  const totalShares = entries.reduce((s, [, v]) => s + (Number(v) || 0), 0);
  if (totalShares <= 0) return entries.map(([personId]) => ({ personId, amount: 0 }));
  const raw = entries.map(([personId, v]) => ({ personId, amount: round2((total * (Number(v) || 0)) / totalShares) }));
  const sum = round2(raw.reduce((s, r) => s + r.amount, 0));
  const diff = round2(total - sum);
  if (diff !== 0 && raw.length) {
    raw.sort((a, b) => b.amount - a.amount);
    raw[0].amount = round2(raw[0].amount + diff);
  }
  return raw;
}
