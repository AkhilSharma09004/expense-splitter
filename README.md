# 🧾 Tally — an expense splitter (Splitwise clone)

Track shared expenses in a group, split them fairly, and settle up with the
fewest possible payments. Built with **plain HTML, CSS and JavaScript** —
zero frameworks, zero build step, zero dependencies. Clone it and open
`index.html`; that's the whole install process.

**[Live demo →](#)** *(deploy to GitHub Pages / Netlify / Vercel and drop the link here)*

---

## Why this project

Most "todo app" portfolio pieces don't touch money math, multi-entity state,
or any algorithm harder than filtering an array. This one does all three:

- **Real domain logic** — four different ways to split a bill (equal, exact
  amounts, percentages, shares), each with cent-accurate rounding so the
  splits always sum to the original total.
- **A genuine algorithm** — a debt-simplification routine that collapses a
  tangled web of who-owes-whom into the minimum practical set of payments
  (see below). This is the same technique Splitwise's "simplify debts"
  feature uses.
- **Non-trivial state management** — expenses, settlements, people and
  groups are normalized, derived balances are computed on the fly, and the
  UI re-renders from a single source of truth, all without React/Vue — a
  deliberate choice to demonstrate DOM and state fundamentals.

## Features

- **Groups** — create a group per trip/house/project, add and remove members
  (blocked if it would orphan a non-zero balance).
- **Four split types** — Equal, Exact amounts, Percentages, and Shares, with
  live validation as you type.
- **Balances dashboard** — a running "you owe / you're owed" total across
  every group, aggregated per person.
- **Settle up** — record a payment between any two people; suggested
  settlements are one tap away from the simplify-debts output.
- **Activity feed** — every expense and payment, searchable, grouped by day.
- **Spending breakdown** — a hand-rolled SVG donut chart of your spend by
  category (no charting library).
- **Light/dark theme**, a switchable currency symbol, and full mobile layout.
- **Sample data** — a "load sample data" action seeds a realistic multi-group
  ledger so the app isn't a blank slate on first look (great for demos).
- Everything persists to `localStorage`; there is no backend.

## The interesting part: minimizing settlements

If four friends share a dozen expenses, the naive ledger has every person
owing several others small amounts. `js/balance.js` reduces that mess in two
passes:

1. **Net each person's position.** Walk every expense and settlement in a
   group once, and each person collapses to a single signed number: positive
   means the group owes them, negative means they owe the group.
2. **Greedily match debtors to creditors.** Sort both lists by size, then
   repeatedly pay the largest debtor to the largest creditor until both
   lists are empty. Every payment fully clears at least one person, so for
   *n* people with a non-zero balance, this produces **at most n − 1
   transactions** — down from as many as `n * (n - 1) / 2` pairwise debts.

Finding the mathematically optimal minimum number of transactions is
NP-hard in the general case (it reduces to an optimal subset-partitioning
problem), so this greedy heuristic is the standard, practical trade-off —
and it's the same one production tools use.

```js
// js/balance.js (simplified)
function simplifyDebts(balances) {
  const creditors = [...].sort((a, b) => b.amt - a.amt);
  const debtors   = [...].sort((a, b) => b.amt - a.amt);
  const transactions = [];
  while (debtors.length && creditors.length) {
    const pay = Math.min(debtors[0].amt, creditors[0].amt);
    transactions.push({ from: debtors[0].id, to: creditors[0].id, amount: pay });
    // shrink whichever side hit zero first, drop it, repeat
  }
  return transactions;
}
```

## Architecture

```
index.html         Static shell: sidebar, topbar, view root, all modal markup
css/styles.css      Design tokens (CSS custom properties) + every component
js/
  storage.js        localStorage read/write, default state, no other module
                     touches localStorage directly
  models.js         Factories for Person/Group/Expense/Settlement + the four
                     split-math functions (pure, unit-testable)
  balance.js         netBalances() and simplifyDebts() — the algorithm above
  charts.js          ~40-line SVG donut chart renderer
  ui.js             Pure render(state) -> HTML string functions for every
                     view; touches the DOM only for toast()
  app.js            The only stateful module: owns `state`, wires every
                     event listener, decides when to re-render
```

The split between `ui.js` (pure rendering) and `app.js` (state + events) is
deliberate: every view is a function of state, and `app.js` is the one place
that mutates state and re-renders — a one-way data flow without needing a
framework to enforce it.

## Data model

```js
state = {
  currency, theme, meId, view, activeGroupId,
  people:   [{ id, name }],
  groups:   [{ id, name, icon, memberIds }],
  activity: [
    // expenses
    { id, type:'expense', groupId, description, amount, category, date,
      paidBy, splitType, splits: [{ personId, amount }] },
    // settlements
    { id, type:'settlement', groupId, from, to, amount, date },
  ],
}
```

Everything else — per-group balances, suggested settlements, category
totals, the dashboard's net figure — is *derived* from this on every render
rather than stored redundantly, so there's exactly one place that can go
out of sync: nowhere.

## Running it

No build step, no npm install:

```bash
# any static file server works, e.g.
npx serve .
# or just open index.html directly in a browser
```

## Possible next steps

- Swap the `localStorage` layer for a real backend (Firebase/Supabase or a
  small REST API) and add multi-user auth — the `Store` module is the only
  file that would need to change.
- Multi-currency expenses with live FX conversion.
- Recurring expenses (rent, subscriptions) that auto-post on a schedule.
- Export a group's ledger to PDF/CSV.
- Attach a receipt photo per expense (would need actual file storage).

## Tech

HTML5 · CSS3 (custom properties, no preprocessor) · vanilla ES2021 JavaScript
· zero runtime dependencies. Fonts: Fraunces (display) + Public Sans (UI) +
IBM Plex Mono (currency figures), via Google Fonts.
