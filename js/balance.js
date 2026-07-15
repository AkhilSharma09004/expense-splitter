/**
 * balance.js
 * ---------------------------------------------------------------------------
 * Two responsibilities:
 *
 *  1. netBalances(groupId, state)  — walk every expense & settlement in a
 *     group and reduce it to one signed number per member: positive means
 *     "the group owes this person", negative means "this person owes the
 *     group". This is just bookkeeping (O(expenses * splitsPerExpense)).
 *
 *  2. simplifyDebts(balances)      — the interesting part. Given those net
 *     positions, find a minimal-ish set of point-to-point payments that
 *     re-zeroes everyone. Settling debts pairwise (every debtor pays every
 *     creditor they individually owe) can take O(n^2) transactions; this
 *     greedy "largest debtor pays largest creditor" sweep produces at most
 *     n-1 transactions for n people with a non-zero balance, which is the
 *     same simplification strategy production tools like Splitwise use.
 *
 *     Proof sketch of the n-1 bound: every settlement fully zeroes out at
 *     least one participant (whichever side of the pair had the smaller
 *     remaining amount), so with n non-zero balances we run out of people
 *     to zero after at most n-1 steps. Finding the *true* minimum number of
 *     transactions in the general case is NP-hard (it's equivalent to an
 *     optimal set-partition problem), so this greedy heuristic is the
 *     standard, practical trade-off.
 * ---------------------------------------------------------------------------
 */
const Balance = (() => {
  const EPS = 0.005;

  function netBalances(groupId, state) {
    const group = state.groups.find((g) => g.id === groupId);
    if (!group) return {};
    const balances = {};
    group.memberIds.forEach((id) => { balances[id] = 0; });

    for (const item of state.activity) {
      if (item.groupId !== groupId) continue;

      if (item.type === 'expense') {
        balances[item.paidBy] = round2((balances[item.paidBy] || 0) + item.amount);
        for (const s of item.splits) {
          balances[s.personId] = round2((balances[s.personId] || 0) - s.amount);
        }
      } else if (item.type === 'settlement') {
        // `from` paid `to` back, so from's debt shrinks (+) and to's credit shrinks (-).
        balances[item.from] = round2((balances[item.from] || 0) + item.amount);
        balances[item.to] = round2((balances[item.to] || 0) - item.amount);
      }
    }
    return balances;
  }

  function simplifyDebts(balances) {
    const creditors = [];
    const debtors = [];
    for (const [id, amt] of Object.entries(balances)) {
      if (amt > EPS) creditors.push({ id, amt });
      else if (amt < -EPS) debtors.push({ id, amt: -amt });
    }
    creditors.sort((a, b) => b.amt - a.amt);
    debtors.sort((a, b) => b.amt - a.amt);

    const transactions = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const pay = round2(Math.min(debtors[i].amt, creditors[j].amt));
      if (pay > EPS) transactions.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
      debtors[i].amt = round2(debtors[i].amt - pay);
      creditors[j].amt = round2(creditors[j].amt - pay);
      if (debtors[i].amt <= EPS) i++;
      if (creditors[j].amt <= EPS) j++;
    }
    return transactions;
  }

  /** Aggregate simplified transactions across every group, from the point of view of `meId`. */
  function globalSummary(state) {
    const owedToMe = {};   // counterparty -> amount they owe me
    const iOwe = {};       // counterparty -> amount I owe them
    let totalOwed = 0, totalOwe = 0;

    for (const group of state.groups) {
      const balances = netBalances(group.id, state);
      const txns = simplifyDebts(balances);
      for (const t of txns) {
        if (t.from === state.meId) {
          iOwe[t.to] = round2((iOwe[t.to] || 0) + t.amount);
          totalOwe = round2(totalOwe + t.amount);
        } else if (t.to === state.meId) {
          owedToMe[t.from] = round2((owedToMe[t.from] || 0) + t.amount);
          totalOwed = round2(totalOwed + t.amount);
        }
      }
    }
    return { owedToMe, iOwe, totalOwed, totalOwe, net: round2(totalOwed - totalOwe) };
  }

  return { netBalances, simplifyDebts, globalSummary };
})();
