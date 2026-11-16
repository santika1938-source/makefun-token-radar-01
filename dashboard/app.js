// Token Radar dashboard: renders window.RADAR, the dataset main.ts writes
// next to this page as data.js. Everything on screen — the ranked board,
// the filters, the detail drawer with its model breakdown and farm plan —
// comes from that one object. The page makes no network requests.
//
// The page also carries its own copy of the scoring function (impliedOf)
// and of the farm-plan derivation, mirroring lib/model.ts, so a reader can
// check that the number printed for a row is the number board.json holds.
(function () {
  'use strict';

  const DATA = window.RADAR;
  if (!DATA) return;
  const root = document.getElementById('board');
  const state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  // ---- formatting -------------------------------------------------------

  const usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    const a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFull.format(n);
  }

  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // ---- the model, mirrored ----------------------------------------------
  // Same arithmetic as lib/model.ts: clamp the growth, scale it, age the
  // protocol toward its maturity multiplier, apply its category multiple.

  function impliedOf(row, model) {
    const rawGrowth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
    const growthMult = 1 + (growth / 100) * model.growth_weight;
    const age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    const maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    const multiple = row.base_multiple === null || row.base_multiple === undefined ? model.base_multiple : row.base_multiple;
    return Math.max(1, Math.round(row.tvl_usd * multiple * growthMult * maturity));
  }

  // ---- farm plans, mirrored ----------------------------------------------
  // Category picks the action, TVL the position size, age the holding
  // window. The strings match board.json's farm_steps exactly.

  function firstChain(p) {
    return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
  }

  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }

  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  function actionFor(p, capital, chain) {
    const c = (p.category || '').toLowerCase();
    const name = p.name;
    const has = (word) => c.indexOf(word) >= 0;
    if (has('lend') || has('cdp') || has('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
    if (has('dex') || has('yield') || has('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
    if (has('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
    if (has('staking') || has('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
    if (has('perpetual') || has('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
    if (has('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
    if (has('curator') || has('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
    if (has('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
    if (has('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
    if (has('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
    return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
  }

  function stepText(step) {
    let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
    if (s.length > 600) s = `${s.slice(0, 596)}...`;
    if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
    return s;
  }

  function farmSteps(p) {
    const chain = firstChain(p);
    const capital = capitalFor(p);
    const hold = holdDaysFor(p.age_days);
    const steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: "Once a week, read the protocol's official announcements for a points program, a snapshot date or a token announcement, and change the position only when the protocol itself publishes the change.", cost: 'nothing to read', time: '10 minutes a week' },
      { text: "Set the exit rule before the position grows: withdraw if the protocol is exploited, its TVL halves inside a week, or the farm's terms change against early users.", cost: 'nothing until you act on it', time: '5 minutes to write the rule' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
    ];
    return steps.map(stepText);
  }

  // ---- tiny DOM helper ----------------------------------------------------
  // h('td', { class: 'num', text: '3' }, child, [children], 'text') builds a
  // node: `class`, `text` and `html` are special keys, `on*` keys attach
  // listeners, everything else becomes an attribute.

  function h(tag, attrs, ...rest) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined) node.setAttribute(k, v);
      }
    }
    const add = (child) => {
      if (child === null || child === undefined) return;
      if (Array.isArray(child)) { child.forEach(add); return; }
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    };
    rest.forEach(add);
    return node;
  }

  // ---- URL hash state -------------------------------------------------------

  function readHash() {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    const params = new URLSearchParams(raw);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }

  function writeHash() {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    const next = params.toString();
    const url = next ? `#${next}` : window.location.pathname + window.location.search;
    window.history.replaceState(null, '', url);
  }

  // ---- row selection ---------------------------------------------------------

  function visibleRows() {
    const q = state.q.trim().toLowerCase();
    return DATA.rows.filter((r) => {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      const haystack = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return haystack.indexOf(q) >= 0;
    });
  }

  function sortKeyOf(r, key) {
    switch (key) {
      case 'name': return r.name.toLowerCase();
      case 'tvl': return r.tvl_usd;
      case 'growth': return r.change_7d === null ? -Infinity : r.change_7d;
      case 'age': return r.age_days === null ? Infinity : r.age_days;
      default: return r.implied_value_usd;
    }
  }

  function sortedRows(list) {
    const key = state.sort;
    return list.slice().sort((a, b) => {
      const av = sortKeyOf(a, key);
      const bv = sortKeyOf(b, key);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ---- sections ----------------------------------------------------------------

  function header() {
    return h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'brand-name', text: 'Token Radar' })),
      h('div', { class: 'top-meta' },
        h('span', { text: `Snapshot ${DATA.as_of}` }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: `${DATA.model_version} model` }),
      ),
    );
  }

  function lede() {
    const floorM = Math.round(DATA.floor_usd / 1e6);
    return h('section', { class: 'lede' },
      h('div', null,
        h('h1', { text: `${DATA.watchlist_size} watchlist protocols, ranked by implied value` }),
        h('p', { text: `The watchlist is the floor: every protocol with at least $${floorM}M of TVL and no token on record. The early radar adds ${DATA.early_size} pre-token protocols below that floor. Each category is priced from the snapshot's own live-token peers, not one flat multiple. Implied value is a model, not a promise.` }),
      ),
      h('div', { class: 'facts' },
        h('div', { class: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: `${DATA.watchlist_size} / ${DATA.watchlist_size}` })),
        h('div', { class: 'fact' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(DATA.board_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Early rows below the floor' }), h('b', { text: String(DATA.early_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(DATA.live_size) })),
      ),
    );
  }

  function controls() {
    const categories = Array.from(new Set(DATA.rows.map((r) => r.category || 'Other'))).sort();
    const search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', () => { state.q = search.value; writeHash(); render(); });
    const select = h('select', { id: 'category', 'aria-label': 'Filter by category' },
      h('option', { value: 'all', text: 'All categories' }),
      categories.map((c) => h('option', { value: c, text: c, selected: c === state.category ? 'selected' : null })),
    );
    select.addEventListener('change', () => { state.category = select.value; writeHash(); render(); });
    const preBtn = h('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: () => { state.tab = 'pre-token'; render(); } });
    const liveBtn = h('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: () => { state.tab = 'live'; render(); } });
    const count = state.tab === 'pre-token' ? `${visibleRows().length} rows shown` : `${DATA.live.length} live-token protocols`;
    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      h('div', { class: 'field' }, h('label', { for: 'category', text: 'Category' }), select),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Token status' }), h('div', { class: 'tabs' }, preBtn, liveBtn)),
      h('span', { class: 'count', text: count }),
    );
  }

  function sortHeader(key, label) {
    const indicator = state.sort === key ? h('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null;
    const btn = h('button', {
      type: 'button',
      onclick: () => {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = -1; }
        render();
      },
    }, label, indicator);
    return h('th', { scope: 'col' }, btn);
  }

  function chainLabel(r) {
    return r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain';
  }

  function boardTable() {
    const list = sortedRows(visibleRows());
    if (list.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category to see the board again.' }),
        h('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: () => { state.q = ''; state.category = 'all'; writeHash(); render(); } }),
      ));
    }
    const max = list[0].implied_value_usd || 1;
    const tbody = h('tbody');
    for (const r of list) {
      const growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      const barWidth = Math.max(3, Math.round((r.implied_value_usd / max) * 100));
      const tr = h('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: () => openDetail(r.slug),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
      },
        h('td', { class: 'num', text: String(r.rank) }),
        h('td', null, h('div', { class: 'name' },
          h('b', { text: r.name }),
          h('span', { class: 'sub', text: `${r.category || 'Other'} on ${chainLabel(r)}` }),
        )),
        h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        h('td', { class: `num ${growthClass}`, text: r.change_7d === null ? 'n/a' : fmtPct(r.change_7d) }),
        h('td', { class: 'num', text: fmtAge(r.age_days) }),
        h('td', null, h('div', { class: 'implied' },
          h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: `width:${barWidth}%` })),
          h('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
        )),
        h('td', null, h('span', { class: 'status', text: 'no token' })),
      );
      tbody.appendChild(tr);
    }
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          h('thead', null, h('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            h('th', { scope: 'col', text: 'Token' }),
          )),
          tbody,
        ),
      ),
    );
  }

  function liveTable() {
    const tbody = h('tbody');
    for (const r of DATA.live) {
      tbody.appendChild(h('tr', null,
        h('td', { class: 'num', text: 'live' }),
        h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: `${r.category || 'Other'} on ${chainLabel(r)}` }))),
        h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        h('td', { class: `num ${r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'}`, text: fmtPct(r.change_7d) }),
        h('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        h('td', null, h('span', { class: 'status', text: 'already trades' })),
      ));
    }
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          h('thead', null, h('tr', null,
            h('th', { scope: 'col', text: 'Status' }),
            h('th', { scope: 'col', text: 'Protocol' }),
            h('th', { scope: 'col', text: 'TVL' }),
            h('th', { scope: 'col', text: '7d' }),
            h('th', { scope: 'col', text: 'Market cap' }),
            h('th', { scope: 'col', text: 'Token' }),
          )),
          tbody,
        ),
      ),
    );
  }

  function modelPanel() {
    const m = DATA.model;
    const formula = `implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ${m.growth_floor}, ${m.growth_cap}) / 100 x ${m.growth_weight}) x (${m.maturity_floor} + min(age_days, ${m.maturity_days}) / ${m.maturity_days} x ${m.maturity_range}) )`;
    const note = `The category multiple is calibrated from this snapshot itself: the median market-cap / TVL ratio of the live-token protocols in the same category (at least 4 peers, otherwise the global median of ${m.base_multiple}), adjusted +4% for each extra chain beyond the first, up to five, and clamped between 0.05 and 1.50. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ${m.unknown_age_days} days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.`;
    return h('section', { class: 'panel model' },
      h('h2', { text: 'How implied value is computed' }),
      h('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { class: 'formula' }, formula),
      h('p', { class: 'sub', text: note }),
    );
  }

  // ---- detail drawer ---------------------------------------------------------

  const dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', () => { state.selected = null; writeHash(); });

  function openDetail(slug) {
    const row = DATA.rows.find((r) => r.slug === slug);
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';

    dialog.appendChild(h('div', { class: 'detail-head' },
      h('div', null,
        h('span', { class: 'brand-name', text: `Rank ${row.rank} of ${DATA.board_size}` }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { class: 'sub', text: `${row.category || 'Other'} on ${row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain'}` }),
      ),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: () => dialog.close() }),
    ));

    const recomputed = impliedOf(row, DATA.model);
    const verdict = recomputed === row.implied_value_usd
      ? ', the same number board.json carries.'
      : ', which differs from the board: the data would be stale.';
    const multipleShown = row.base_multiple === undefined ? DATA.model.base_multiple : row.base_multiple;
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Implied value' }),
      h('div', { class: 'equation' },
        h('div', null, h('span', { text: 'TVL' }), h('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        h('div', null, h('span', { text: 'Seven-day growth' }), h('b', { class: 'num', text: fmtPct(row.change_7d) })),
        h('div', null, h('span', { text: 'Age with no token' }), h('b', { class: 'num', text: fmtAge(row.age_days) })),
        h('div', null, h('span', { text: 'Category base multiple' }), h('b', { class: 'num', text: String(multipleShown) })),
        h('div', null, h('span', { text: 'Growth multiplier' }), h('b', { class: 'num', text: String(row.growth_multiplier) })),
        h('div', null, h('span', { text: 'Maturity multiplier' }), h('b', { class: 'num', text: String(row.maturity_multiplier) })),
        h('div', null, h('span', { text: 'Implied value' }), h('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
      ),
      h('p', { class: 'sub', text: `Model ${DATA.model_version}: the same function scores every protocol. The page recomputes this row as ${fmtUsd(recomputed)}${verdict} This is an estimate, not a price.` }),
    ));

    const stepItems = farmSteps(row).map((s) => {
      const at = s.indexOf(' Cost: ');
      const action = at >= 0 ? s.slice(0, at) : s;
      const tail = at >= 0 ? s.slice(at + 1) : '';
      return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
    });
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Farm plan' }),
      h('ol', { class: 'steps' }, stepItems),
    ));

    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // ---- render ------------------------------------------------------------------

  function render() {
    root.textContent = '';
    const shell = h('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    root.appendChild(shell);
    root.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) root.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
