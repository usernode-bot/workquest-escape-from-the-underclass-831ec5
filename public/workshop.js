/* The Workshop — where completed tasks turn into a machine that runs while
 * the journal is closed. */
(function (WQ) {
  'use strict';

  const s = { data: null, ticker: null, shownAway: false };

  function awayBanner() {
    const idle = s.data.idle;
    if (!idle.away_gained) return '';
    const hrs = Math.floor(idle.away_seconds / 3600);
    const mins = Math.round((idle.away_seconds % 3600) / 60);
    const span = hrs ? `${hrs}h ${mins}m` : `${mins}m`;
    return `<div class="mx-4 mb-3 rounded-2xl border border-sky-500/30 bg-sky-500/5 p-3">
      <div class="text-sm text-sky-100">While you were gone: +${WQ.plain(idle.away_gained)} Focus</div>
      <div class="text-xs text-sky-200/60 mt-0.5">${span} away${idle.away_capped
        ? ` · the Workshop only banks ${idle.offline_cap_hours}h — upgrades raise that` : ''}</div>
    </div>`;
  }

  function head() {
    const p = WQ.state.player;
    const c = s.data.collect;
    const ready = c.ready_in <= 0;
    return `<div class="px-4 pt-4 pb-3 text-center">
      <div class="text-4xl font-semibold tabular-nums text-sky-200" data-focus>${WQ.num(p.focus)}</div>
      <div class="text-xs text-zinc-500 mt-1">Focus · ${WQ.rate(s.data.idle.rate)}</div>
      <button class="un-pressable mt-4 w-full rounded-2xl py-3 text-sm font-medium border ${
        ready ? 'bg-sky-600 border-sky-500 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-500'}"
        data-collect ${ready ? '' : 'disabled'}>
        ${ready ? `Collect +${WQ.num(c.amount)} Focus` : `<span data-cd>Ready in ${c.ready_in}s</span>`}
      </button>
    </div>`;
  }

  function genRow(g) {
    const state = g.locked ? 'locked' : g.at_cap ? 'capped' : g.affordable ? 'ready' : 'poor';
    const btnClass = {
      ready: 'bg-sky-600 border-sky-500 text-white',
      poor: 'bg-zinc-800 border-zinc-700 text-zinc-500',
      capped: 'bg-zinc-800 border-zinc-700 text-zinc-600',
      locked: 'bg-zinc-800 border-zinc-700 text-zinc-600',
    }[state];
    return `<div class="un-group-row flex items-center gap-3 px-4 py-3 bg-zinc-900 ${g.locked ? 'opacity-50' : ''}">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="text-sm text-zinc-100 truncate">${WQ.esc(g.name)}</span>
          <span class="text-[11px] text-zinc-500 tabular-nums shrink-0">lv ${g.level}/${g.cap}</span>
        </div>
        <div class="text-xs text-zinc-500 truncate">${WQ.esc(g.lock_reason || g.blurb)}</div>
        ${g.level ? `<div class="text-[11px] text-sky-300/70 mt-0.5">${WQ.rate(g.output)}</div>` : ''}
      </div>
      <button class="un-pressable shrink-0 rounded-xl border px-3 py-2 text-xs font-medium tabular-nums ${btnClass}"
              data-buy-gen="${g.id}" ${state === 'ready' ? '' : 'disabled'}>
        ${g.locked ? 'Locked' : g.at_cap ? 'Capped' : WQ.num(g.cost)}
      </button>
    </div>`;
  }

  function upRow(u) {
    return `<div class="un-group-row flex items-center gap-3 px-4 py-3 bg-zinc-900 ${u.locked ? 'opacity-50' : ''}">
      <div class="min-w-0 flex-1">
        <div class="text-sm ${u.owned ? 'text-emerald-300' : 'text-zinc-100'} truncate">${WQ.esc(u.name)}</div>
        <div class="text-xs text-zinc-500 truncate">${WQ.esc(u.lock_reason || u.blurb)}</div>
      </div>
      <button class="un-pressable shrink-0 rounded-xl border px-3 py-2 text-xs font-medium tabular-nums ${
        u.owned ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
        : u.affordable ? 'bg-violet-600 border-violet-500 text-white'
        : 'bg-zinc-800 border-zinc-700 text-zinc-500'}"
        data-buy-up="${u.id}" ${u.affordable ? '' : 'disabled'}>
        ${u.owned ? 'Owned' : u.locked ? 'Locked' : WQ.num(u.cost)}
      </button>
    </div>`;
  }

  function section(title, body) {
    return `<div class="px-4 pt-4 pb-1 text-[11px] uppercase tracking-wider text-zinc-500">${title}</div>
      <div class="un-group mx-4 overflow-hidden rounded-2xl border border-zinc-800">${body}</div>`;
  }

  function paint(el) {
    el.innerHTML = head() + awayBanner()
      + section('Machines', s.data.generators.map(genRow).join(''))
      + section('Upgrades', s.data.upgrades.map(upRow).join(''));
    wire(el);
    startTicker(el);
  }

  // The passive trickle is real, so the number on screen should move. This is
  // display only — the server banks the same interval from last_tick_at.
  function startTicker(el) {
    stopTicker();
    const rate = s.data.idle.rate;
    const node = el.querySelector('[data-focus]');
    if (!node || rate <= 0) return;
    let shown = WQ.state.player.focus;
    s.ticker = setInterval(() => {
      if (!document.body.contains(node)) return stopTicker();
      shown += rate / 2;
      node.textContent = WQ.num(shown);
      const cd = el.querySelector('[data-cd]');
      if (cd && s.data.collect.ready_in > 0) {
        s.data.collect.ready_in = Math.max(0, s.data.collect.ready_in - 0.5);
        if (s.data.collect.ready_in <= 0) paint(el);
        else cd.textContent = `Ready in ${Math.ceil(s.data.collect.ready_in)}s`;
      }
    }, 500);
  }
  function stopTicker() { if (s.ticker) { clearInterval(s.ticker); s.ticker = null; } }

  async function post(el, path) {
    try {
      const data = await WQ.api(path, { method: 'POST', body: {} });
      s.data = data;
      WQ.applyDeltas(data);
      paint(el);
    } catch (err) { WQ.toast(err.message || 'That did not work'); }
  }

  function wire(el) {
    const c = el.querySelector('[data-collect]');
    if (c) c.addEventListener('click', () => post(el, '/api/game/collect'));
    el.querySelectorAll('[data-buy-gen]').forEach((b) =>
      b.addEventListener('click', () => post(el, `/api/game/generators/${b.dataset.buyGen}/buy`)));
    el.querySelectorAll('[data-buy-up]').forEach((b) =>
      b.addEventListener('click', () => post(el, `/api/game/upgrades/${b.dataset.buyUp}/buy`)));
  }

  WQ.screens.workshop = {
    async render(el, _rest, opts) {
      WQ.setTitle('Workshop', WQ.state.player ? WQ.rate(WQ.state.player.focus_rate) : '');
      if (!s.data || (opts && opts.changed)) {
        el.innerHTML = WQ.skeleton(6);
        s.data = await WQ.api('/api/game/state');
        WQ.setPlayer(s.data.player);
      }
      paint(el);
    },
  };
})(window.WQ);
