/* The season pass — 50 tiers, two rows, everything priced in currency the
 * player earned. The real-money door is visibly shut, on purpose. */
(function (WQ) {
  'use strict';

  const s = { data: null };

  // Tailwind reads class names as whole literals out of this file, so rarity
  // tints are a lookup table rather than a built string.
  const RARITY_BADGE = {
    common: 'border-zinc-600 text-zinc-300 bg-zinc-800/60',
    rare: 'border-sky-500 text-sky-300 bg-sky-500/10',
    epic: 'border-fuchsia-500 text-fuchsia-300 bg-fuchsia-500/10',
    legendary: 'border-amber-400 text-amber-300 bg-amber-400/10',
  };
  const RARITY_LABEL = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

  function rewardCell(reward, opts) {
    const { unlocked, claimed, locked } = opts;
    if (!reward) {
      return `<div class="h-20 rounded-xl border border-dashed border-zinc-800/80"></div>`;
    }
    const face = reward.kind === 'focus' ? `<div class="text-sky-300 text-sm font-semibold">${WQ.num(reward.amount)}</div><div class="text-[10px] text-zinc-500">Focus</div>`
      : reward.kind === 'resolve' ? `<div class="text-violet-300 text-sm font-semibold">${WQ.plain(reward.amount)}</div><div class="text-[10px] text-zinc-500">Resolve</div>`
      : `<div class="w-7 h-7 rounded-md mb-1" style="${WQ.esc(reward.css || '')}"></div>
         <div class="text-[10px] text-zinc-400 leading-tight text-center px-1 truncate w-full">${WQ.esc(reward.name || reward.label)}</div>`;
    const badge = reward.rarity
      ? `<span class="absolute top-1 right-1 text-[8px] px-1 rounded border ${RARITY_BADGE[reward.rarity] || RARITY_BADGE.common}">${RARITY_LABEL[reward.rarity] || ''}</span>`
      : '';
    const tone = locked ? 'border-zinc-800 bg-zinc-900/40 opacity-45'
      : claimed ? 'border-emerald-500/40 bg-emerald-500/5'
      : unlocked ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-800 bg-zinc-900/60 opacity-70';
    return `<div class="relative h-20 rounded-xl border ${tone} grid place-items-center px-1">
      ${badge}${face}
      ${claimed ? '<span class="absolute bottom-1 right-1.5 text-[9px] text-emerald-400">✓</span>' : ''}
    </div>`;
  }

  function trackColumn(row, premium) {
    const cur = s.data.progress.tier;
    return `<div class="shrink-0 w-24 space-y-1.5 ${row.tier === cur + 1 ? 'ring-1 ring-violet-500/40 rounded-2xl p-1 -m-1' : ''}">
      <div class="text-center text-[11px] ${row.unlocked ? 'text-violet-300' : 'text-zinc-600'} tabular-nums">${row.tier}</div>
      ${rewardCell(row.free, { unlocked: row.unlocked, claimed: row.free_claimed, locked: false })}
      ${rewardCell(row.premium, { unlocked: row.unlocked, claimed: row.premium_claimed, locked: !premium })}
    </div>`;
  }

  function header() {
    const p = s.data.progress;
    const se = s.data.season;
    const pct = Math.round((p.tier_progress / p.tier_target) * 100);
    const ends = new Date(se.ends_at);
    const daysLeft = Math.max(0, Math.ceil((ends.getTime() - Date.now()) / 86400000));
    return `<div class="px-4 pt-4">
      <div class="flex items-baseline justify-between">
        <div class="text-base font-semibold text-zinc-100">${WQ.esc(se.name)}</div>
        <div class="text-[11px] text-zinc-500">${daysLeft} day${daysLeft === 1 ? '' : 's'} left</div>
      </div>
      <div class="mt-2 flex items-center gap-2">
        <span class="text-xs text-zinc-400 tabular-nums">Tier ${p.tier}</span>
        <div class="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
          <div class="h-full bg-violet-500" style="width:${pct}%"></div>
        </div>
        <span class="text-[11px] text-zinc-500 tabular-nums">${p.tier_progress}/${p.tier_target} SP</span>
      </div>
    </div>`;
  }

  function premiumCta() {
    const p = s.data.progress;
    const se = s.data.season;
    if (p.premium) {
      return `<div class="mx-4 mt-3 rounded-2xl border border-amber-400/40 bg-amber-400/5 px-3 py-2.5 text-xs text-amber-200">
        Premium track unlocked — every tier you have already passed paid out.</div>`;
    }
    const short = Math.max(0, se.premium_cost - s.data.resolve);
    return `<div class="mx-4 mt-3 rounded-2xl border border-violet-500/40 bg-violet-500/10 p-3">
      <div class="text-sm text-violet-100 font-medium">Unlock Premium Track — ${WQ.plain(se.premium_cost)} Resolve</div>
      <div class="text-xs text-violet-200/70 mt-0.5">One payment, this season. Every tier you have already reached pays out the moment you unlock it.</div>
      <button class="un-pressable mt-2.5 w-full rounded-xl text-xs font-medium py-2 ${
        s.data.can_unlock ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-500'}"
        data-unlock ${s.data.can_unlock ? '' : 'disabled'}>
        ${s.data.can_unlock ? 'Unlock now' : `${WQ.plain(short)} Resolve to go`}
      </button>
    </div>`;
  }

  function skipRow() {
    const p = s.data.progress;
    const se = s.data.season;
    const left = se.max_skips - p.skips_used;
    return `<div class="mx-4 mt-2 flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2.5">
      <div class="min-w-0 flex-1">
        <div class="text-xs text-zinc-200">Skip a tier — ${se.skip_cost} Resolve</div>
        <div class="text-[11px] text-zinc-500">${left} of ${se.max_skips} left this season</div>
      </div>
      <button class="un-pressable shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${
        s.data.can_skip ? 'bg-zinc-800 border border-zinc-700 text-zinc-100' : 'bg-zinc-900 border border-zinc-800 text-zinc-600'}"
        data-skip ${s.data.can_skip ? '' : 'disabled'}>Skip</button>
    </div>`;
  }

  // The seam. It is visible, it is disabled, and the copy says why.
  function storeRow() {
    return `<div class="mx-4 mt-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 opacity-70">
      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-xs text-zinc-400">Get Resolve</div>
          <div class="text-[11px] text-zinc-600" data-store-copy>Resolve purchases aren't available yet — earn it by journalling.</div>
        </div>
        <button class="shrink-0 rounded-lg px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-800 text-zinc-600 cursor-not-allowed"
                disabled data-store>Unavailable</button>
      </div>
    </div>`;
  }

  function objectiveRow(o) {
    const pct = Math.min(100, Math.round((o.progress / o.target) * 100));
    const pay = [o.sp ? `${o.sp} SP` : '', o.resolve ? `${o.resolve} Resolve` : ''].filter(Boolean).join(' · ');
    return `<div class="un-group-row px-4 py-2.5 bg-zinc-900">
      <div class="flex items-center justify-between gap-2">
        <div class="text-xs ${o.completed ? 'text-emerald-300' : 'text-zinc-200'} truncate">${o.completed ? '✓ ' : ''}${WQ.esc(o.label)}</div>
        <div class="text-[11px] text-zinc-500 shrink-0 tabular-nums">${o.progress}/${o.target}</div>
      </div>
      <div class="mt-1.5 h-1 rounded-full bg-zinc-800 overflow-hidden">
        <div class="h-full ${o.completed ? 'bg-emerald-500' : 'bg-violet-500'}" style="width:${pct}%"></div>
      </div>
      <div class="text-[10px] text-zinc-600 mt-1">${pay}</div>
    </div>`;
  }

  function objectives() {
    const groups = [
      ['Today', s.data.objectives.filter((o) => o.scope === 'daily')],
      ['This week', s.data.objectives.filter((o) => o.scope === 'weekly')],
      ['This season', s.data.objectives.filter((o) => o.scope === 'season')],
    ];
    return groups.filter(([, list]) => list.length).map(([title, list]) =>
      `<div class="px-4 pt-4 pb-1 text-[11px] uppercase tracking-wider text-zinc-500">${title}</div>
       <div class="un-group mx-4 overflow-hidden rounded-2xl border border-zinc-800">${list.map(objectiveRow).join('')}</div>`
    ).join('');
  }

  function paint(el) {
    const premium = s.data.progress.premium;
    el.innerHTML = header() + `
      <div class="mt-3 overflow-x-auto overscroll-x-contain" data-track>
        <div class="flex gap-2 px-4 pb-1">${s.data.track.map((r) => trackColumn(r, premium)).join('')}</div>
      </div>
      <div class="px-4 pt-1.5 text-[10px] text-zinc-600">
        Top row: free · Bottom row: premium${premium ? '' : ' (locked)'}
      </div>`
      + premiumCta() + skipRow() + storeRow() + objectives();
    wire(el);
    // Park the track on the tier the player is actually working towards.
    const scroller = el.querySelector('[data-track]');
    if (scroller) scroller.scrollLeft = Math.max(0, (s.data.progress.tier - 1) * 104);
  }

  async function post(el, path) {
    try {
      const data = await WQ.api(path, { method: 'POST', body: {} });
      s.data = data;
      WQ.applyDeltas(data);
      paint(el);
    } catch (err) { WQ.toast(err.message || 'That did not work'); }
  }

  function wire(el) {
    const u = el.querySelector('[data-unlock]');
    if (u) u.addEventListener('click', () => post(el, '/api/season/unlock-premium'));
    const k = el.querySelector('[data-skip]');
    if (k) k.addEventListener('click', () => post(el, '/api/season/skip-tier'));
  }

  WQ.screens.season = {
    async render(el, _rest, opts) {
      WQ.setTitle('Season', WQ.state.player ? `${WQ.plain(WQ.state.player.season_xp)} SP` : '');
      if (!s.data || (opts && opts.changed)) {
        el.innerHTML = WQ.skeleton(6);
        s.data = await WQ.api('/api/season');
        WQ.setPlayer(s.data.player);
        // Ask the seam itself rather than assuming; it answers the same in
        // every environment and the copy comes from the server.
        try {
          const cat = await WQ.api('/api/purchase/catalog');
          s.catalog = cat;
        } catch (_) { s.catalog = null; }
      }
      paint(el);
      if (s.catalog && s.catalog.message) {
        const copy = el.querySelector('[data-store-copy]');
        if (copy) copy.textContent = s.catalog.message;
      }
    },
  };
})(window.WQ);
