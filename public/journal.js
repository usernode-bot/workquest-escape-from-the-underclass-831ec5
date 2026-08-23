/* The Journal — four horizons, one list, and the two rituals (clearing the
 * tray, reviewing the week) that the whole economy is arguing for. */
(function (WQ) {
  'use strict';

  const HORIZONS = [
    { id: 'day', label: 'Day' },
    { id: 'week', label: 'Week' },
    { id: 'month', label: 'Month' },
    { id: 'year', label: 'Year' },
  ];

  const SUGGESTIONS = ['Plan my week', "One thing I've been putting off", 'Tidy my desk'];

  const s = {
    horizon: 'day',
    period: null,      // null = whatever the server calls "now"
    log: null,
    tray: [],
    trayLoaded: false,
    booted: null,
    introShown: false,
  };

  // The bullet signifiers. A journal is legible at a glance or it is not a
  // journal, so status is a shape before it is a colour.
  function bullet(entry) {
    if (entry.status === 'done') {
      return `<span class="w-6 h-6 shrink-0 rounded-full bg-emerald-500/20 border border-emerald-400/60 grid place-items-center text-emerald-300 text-xs">✓</span>`;
    }
    if (entry.status === 'migrated') {
      return `<span class="w-6 h-6 shrink-0 rounded-full border border-zinc-700 grid place-items-center text-zinc-500 text-xs">→</span>`;
    }
    if (entry.status === 'dropped') {
      return `<span class="w-6 h-6 shrink-0 rounded-full border border-zinc-800 grid place-items-center text-zinc-600 text-xs">✕</span>`;
    }
    return `<span class="block w-6 h-6 shrink-0 rounded-full border-2 border-zinc-600"></span>`;
  }

  function titleClass(entry) {
    if (entry.status === 'done') return 'text-zinc-400 line-through decoration-zinc-600';
    if (entry.status === 'dropped') return 'text-zinc-600 line-through decoration-zinc-700';
    if (entry.status === 'migrated') return 'text-zinc-500';
    return 'text-zinc-100';
  }

  function caption(entry) {
    const bits = [];
    if (entry.status === 'migrated' && entry.migrated_to) bits.push(`→ ${WQ.esc(entry.migrated_to)}`);
    if (entry.migrated_from) bits.push(`migrated from ${WQ.esc(entry.migrated_from)}`);
    if (entry.note) bits.push(WQ.esc(entry.note));
    if (!bits.length) return '';
    return `<div class="text-xs text-zinc-500 mt-0.5 truncate">${bits.join(' · ')}</div>`;
  }

  function row(entry) {
    const inert = entry.status === 'dropped' || entry.status === 'migrated';
    return `<div class="un-group-row" data-entry="${entry.id}">
      <div class="flex items-start gap-3 px-4 py-3 bg-zinc-900">
        <button class="un-touch-target mt-0.5 ${inert ? 'opacity-60' : ''}" data-act="toggle"
                ${inert ? 'disabled' : ''} aria-label="Toggle complete">${bullet(entry)}</button>
        <div class="min-w-0 flex-1" data-act="menu">
          <div class="flex items-center gap-1.5">
            ${entry.priority ? '<span class="text-amber-400 text-xs">★</span>' : ''}
            <div class="text-sm truncate ${titleClass(entry)}">${WQ.esc(entry.title)}</div>
          </div>
          ${caption(entry)}
        </div>
        <button class="un-touch-target text-zinc-600 px-1" data-act="menu" aria-label="Row menu">⋯</button>
      </div>
    </div>`;
  }

  function emptyState() {
    const chips = SUGGESTIONS.map((t) =>
      `<button class="un-pressable px-3 py-1.5 rounded-full bg-zinc-800 text-zinc-300 text-xs border border-zinc-700"
               data-suggest="${WQ.esc(t)}">${WQ.esc(t)}</button>`).join('');
    return `<div class="px-4 py-10 text-center">
      <div class="text-3xl mb-3">📓</div>
      <div class="text-sm text-zinc-300">Nothing logged for ${s.horizon === 'day' ? 'today' : 'this ' + s.horizon} yet — what's the first thing?</div>
      <div class="mt-4 flex flex-wrap gap-2 justify-center">${chips}</div>
    </div>`;
  }

  function trayCard() {
    if (s.horizon !== 'day' || !s.log || !s.log.is_current || !s.log.tray_count) return '';
    const n = s.log.tray_count;
    const preview = s.tray.slice(0, 3).map((e) =>
      `<div class="text-xs text-zinc-400 truncate">· ${WQ.esc(e.title)}</div>`).join('');
    return `<div class="mx-4 mb-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3">
      <div class="text-sm text-amber-200 font-medium">${n} task${n === 1 ? '' : 's'} left behind</div>
      ${preview}
      <div class="mt-2.5 flex gap-2">
        <button class="un-pressable flex-1 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-100 text-xs py-2" data-tray="migrate">Migrate all to today</button>
        <button class="un-pressable rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs py-2 px-3" data-tray="drop">Drop all</button>
      </div>
    </div>`;
  }

  function reviewBanner() {
    if (!s.log || !s.log.review_due) return '';
    return `<div class="mx-4 mb-3 rounded-2xl border border-violet-500/40 bg-violet-500/10 p-3">
      <div class="text-sm text-violet-100 font-medium">Your week is nearly done</div>
      <div class="text-xs text-violet-200/70 mt-0.5">Look back over it once and bank the biggest payout in the app.</div>
      <button class="un-pressable mt-2.5 w-full rounded-xl bg-violet-600 text-white text-xs font-medium py-2" data-review="1">Review this week — +200 SP · +25 Resolve</button>
    </div>`;
  }

  function stepper() {
    const log = s.log;
    return `<div class="flex items-center gap-2 px-4 py-3">
      <button class="un-pressable un-touch-target w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400" data-step="-1" aria-label="Previous">‹</button>
      <div class="flex-1 text-center">
        <div class="text-sm font-medium text-zinc-100">${WQ.esc(log.label)}</div>
        <div class="text-[11px] text-zinc-500">${log.counts.done}/${log.counts.total} done</div>
      </div>
      <button class="un-pressable un-touch-target w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400" data-step="1" aria-label="Next">›</button>
      ${log.is_current ? '' : '<button class="un-pressable text-[11px] text-violet-300 px-2" data-step="now">Now</button>'}
    </div>`;
  }

  function tabs() {
    return `<div class="flex gap-1 px-4 pt-3">${HORIZONS.map((h) => {
      const on = h.id === s.horizon;
      return `<button class="un-pressable flex-1 rounded-lg py-1.5 text-xs font-medium border ${
        on ? 'bg-violet-600/20 border-violet-500/50 text-violet-200'
           : 'bg-zinc-900 border-zinc-800 text-zinc-500'}" data-horizon="${h.id}">${h.label}</button>`;
    }).join('')}</div>`;
  }

  function composer() {
    return `<form class="px-4 pb-4 pt-1 flex gap-2" data-add="1">
      <input name="title" autocomplete="off" maxlength="300"
             class="flex-1 rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-500/60"
             placeholder="Add to ${WQ.esc(s.log ? s.log.label.toLowerCase() : 'this log')}…">
      <button type="button" class="un-pressable un-touch-target w-10 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-600" data-star="0" aria-label="Priority">★</button>
      <button type="submit" class="un-pressable rounded-xl bg-violet-600 text-white text-sm font-medium px-4">Add</button>
    </form>`;
  }

  function paint(el) {
    const log = s.log;
    const list = log.entries.length
      ? `<div class="un-group mx-4 overflow-hidden rounded-2xl bg-zinc-900 border border-zinc-800">${log.entries.map(row).join('')}</div>`
      : emptyState();
    el.innerHTML = tabs() + stepper() + trayCard() + reviewBanner() + composer() + list;
    wire(el);
  }

  // ── actions ───────────────────────────────────────────────────────────────
  async function reload(opts) {
    const q = s.period ? '?period=' + encodeURIComponent(s.period) : '';
    const data = await WQ.api('/api/journal/' + s.horizon + q);
    s.log = data.log;
    WQ.setPlayer(data.player);
    if (s.horizon === 'day' && s.log.is_current && s.log.tray_count) await loadTray();
    if (opts && opts.el) paint(opts.el);
  }

  async function loadTray() {
    try {
      const data = await WQ.api('/api/journal/unmigrated');
      s.tray = data.entries || [];
      s.trayLoaded = true;
    } catch (_) { s.tray = []; }
  }

  function absorb(el, data) {
    WQ.applyDeltas(data);
    if (data.tray) s.tray = data.tray;
    if (data.log && data.log.horizon === s.horizon && data.log.period_key === s.log.period_key) {
      s.log = data.log;
      // The tray count moved but the tray body did not come back with it.
      if (s.log.tray_count && s.horizon === 'day' && s.log.is_current && !data.tray) {
        loadTray().then(() => paint(el));
        return;
      }
      paint(el);
    } else {
      reload({ el });
    }
  }

  async function act(el, path, body) {
    try {
      const data = await WQ.api(path, { method: 'POST', body: body || {} });
      absorb(el, data);
      return data;
    } catch (err) {
      WQ.toast(err.message || 'That did not work');
      return null;
    }
  }

  async function offerIntro(el) {
    const p = WQ.state.player;
    if (!p || p.workshop_intro || s.introShown) return;
    s.introShown = true;
    const card = document.createElement('div');
    card.className = 'p-5 text-center';
    card.innerHTML = `<div class="text-3xl mb-2">🛠️</div>
      <div class="text-base font-semibold text-zinc-100">Something is running downstairs</div>
      <div class="text-sm text-zinc-400 mt-1.5">Every task you tick off sends Focus to the Workshop, where it keeps working while you don't. Here's your first machine, on the house.</div>
      <button class="un-pressable mt-4 w-full rounded-xl bg-violet-600 text-white text-sm font-medium py-2.5" data-intro="1">Take the Notepad</button>`;
    const sheet = window.unNative && unNative.presentSheet
      ? unNative.presentSheet({ contentEl: card })
      : null;
    card.querySelector('[data-intro]').addEventListener('click', async () => {
      if (sheet) sheet.dismiss();
      const data = await WQ.api('/api/game/intro', { method: 'POST', body: {} }).catch(() => null);
      if (data) { WQ.applyDeltas(data); WQ.toast('The Workshop is running — go and look'); }
    });
    if (!sheet) card.querySelector('[data-intro]').click();
  }

  function migrateSheet(el, entry) {
    const box = document.createElement('div');
    const targets = (WQ.state.targets || []).map((t) =>
      `<button class="un-pressable w-full text-left px-4 py-3 text-sm text-zinc-100 border-b border-zinc-800" data-target="${WQ.esc(t.token)}">${WQ.esc(t.label)}</button>`).join('');
    box.className = 'pb-2';
    box.innerHTML = `<div class="px-4 pt-1 pb-3">
        <div class="text-sm font-medium text-zinc-100 truncate">${WQ.esc(entry.title)}</div>
        <div class="text-xs text-zinc-500">Where should this go instead?</div>
      </div>
      <div class="rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 mx-2">${targets}
        <button class="un-pressable w-full text-left px-4 py-3 text-sm text-rose-400" data-target="__drop">Drop it</button>
      </div>`;
    const sheet = unNative.presentSheet({ contentEl: box });
    box.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-target]');
      if (!btn) return;
      sheet.dismiss();
      const t = btn.dataset.target;
      if (t === '__drop') await act(el, `/api/journal/entries/${entry.id}/drop`);
      else await act(el, `/api/journal/entries/${entry.id}/migrate`, { target: t });
    });
  }

  async function rowMenu(el, entry, anchorEl) {
    const items = [];
    if (entry.status === 'open') items.push({ id: 'done', label: 'Mark done', icon: 'home' });
    if (entry.status === 'done') items.push({ id: 'undo', label: 'Un-tick' });
    if (entry.status === 'open') items.push({ id: 'migrate', label: 'Migrate…', icon: 'link' });
    if (entry.status === 'open') items.push({ id: 'star', label: entry.priority ? 'Remove star' : 'Star it' });
    items.push({ id: 'note', label: entry.note ? 'Edit note' : 'Add a note' });
    if (entry.status !== 'dropped') items.push({ id: 'drop', label: 'Drop', destructive: true, icon: 'trash' });

    const picked = await unNative.menu({ anchorEl, title: entry.title, items });
    if (!picked) return;
    if (picked.id === 'done') return act(el, `/api/journal/entries/${entry.id}/complete`).then(() => offerIntro(el));
    if (picked.id === 'undo') return act(el, `/api/journal/entries/${entry.id}/uncomplete`);
    if (picked.id === 'migrate') return migrateSheet(el, entry);
    if (picked.id === 'drop') return act(el, `/api/journal/entries/${entry.id}/drop`);
    if (picked.id === 'star') {
      const data = await WQ.api(`/api/journal/entries/${entry.id}`, {
        method: 'PATCH', body: { priority: !entry.priority },
      }).catch((e) => { WQ.toast(e.message); return null; });
      if (data) absorb(el, data);
      return;
    }
    if (picked.id === 'note') {
      const out = await unNative.alert({
        title: 'Note', message: entry.title,
        field: { placeholder: 'A line of context', value: entry.note || '' },
        buttons: [{ label: 'Cancel', style: 'cancel' }, { label: 'Save' }],
      });
      if (!out || out.button.style === 'cancel') return;
      const data = await WQ.api(`/api/journal/entries/${entry.id}`, {
        method: 'PATCH', body: { note: out.value || '' },
      }).catch((e) => { WQ.toast(e.message); return null; });
      if (data) absorb(el, data);
    }
  }

  // ── wiring ────────────────────────────────────────────────────────────────
  function wire(el) {
    const byId = (id) => s.log.entries.find((e) => e.id === Number(id));

    el.querySelectorAll('[data-horizon]').forEach((b) => b.addEventListener('click', () => {
      const h = b.dataset.horizon;
      if (h === s.horizon) return;
      s.horizon = h; s.period = null;
      WQ.go(h === 'day' ? '#/journal' : '#/journal/' + h);
    }));

    el.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', async () => {
      const v = b.dataset.step;
      if (v === 'now') s.period = null;
      else s.period = v === '-1' ? s.log.prev_key : s.log.next_key;
      el.innerHTML = WQ.skeleton(4);
      await reload({ el });
    }));

    el.querySelectorAll('[data-suggest]').forEach((b) => b.addEventListener('click', () => add(el, b.dataset.suggest, false)));

    const form = el.querySelector('[data-add]');
    if (form) {
      const star = form.querySelector('[data-star]');
      star.addEventListener('click', () => {
        const on = star.dataset.star === '1';
        star.dataset.star = on ? '0' : '1';
        star.classList.toggle('text-amber-400', !on);
        star.classList.toggle('text-zinc-600', on);
      });
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const input = form.querySelector('input[name=title]');
        add(el, input.value, star.dataset.star === '1');
      });
    }

    el.querySelectorAll('[data-tray]').forEach((b) => b.addEventListener('click', () =>
      act(el, '/api/journal/tray/clear', { action: b.dataset.tray })));

    const rev = el.querySelector('[data-review]');
    if (rev) rev.addEventListener('click', () => act(el, '/api/journal/weekly-review'));

    el.querySelectorAll('[data-entry]').forEach((rowEl) => {
      const entry = byId(rowEl.dataset.entry);
      if (!entry) return;

      rowEl.addEventListener('click', (ev) => {
        const hit = ev.target.closest('[data-act]');
        if (!hit) return;
        if (hit.dataset.act === 'toggle') {
          if (entry.status === 'done') act(el, `/api/journal/entries/${entry.id}/uncomplete`);
          else act(el, `/api/journal/entries/${entry.id}/complete`).then(() => offerIntro(el));
        } else {
          rowMenu(el, entry, hit);
        }
      });

      // Swipe reveals the two things you do to a task you did not do.
      if (entry.status === 'open' && window.unNative && unNative.attachSwipeActions) {
        unNative.attachSwipeActions(rowEl, {
          actions: [
            { label: 'Migrate', handler: () => migrateSheet(el, entry) },
            { label: 'Drop', destructive: true, handler: () => act(el, `/api/journal/entries/${entry.id}/drop`) },
          ],
        });
      }
    });
  }

  async function add(el, title, priority) {
    title = String(title || '').trim();
    if (!title) return;
    const data = await WQ.api('/api/journal/entries', {
      method: 'POST',
      body: { title, priority: !!priority, horizon: s.horizon, period_key: s.log ? s.log.period_key : undefined },
    }).catch((err) => { WQ.toast(err.message || 'Could not add that'); return null; });
    if (data) absorb(el, data);
  }

  // ── screen contract ───────────────────────────────────────────────────────
  WQ.screens.journal = {
    // Bootstrap already paid for today's log; don't ask for it twice.
    prime(data) {
      s.booted = data;
      s.log = data.log;
      s.tray = data.tray || [];
      s.trayLoaded = true;
    },

    async render(el, rest) {
      const asked = rest[0];
      if (HORIZONS.some((h) => h.id === asked)) {
        if (asked !== s.horizon) { s.horizon = asked; s.period = null; s.log = null; }
      } else if (s.horizon !== 'day' && !asked) {
        s.horizon = 'day'; s.period = null; s.log = null;
      }
      WQ.setTitle('Journal', WQ.state.player ? `Level ${WQ.state.player.journal_level}` : '');
      if (!s.log || s.log.horizon !== s.horizon) {
        if (s.booted && s.horizon === 'day' && !s.period) { s.log = s.booted.log; s.booted = null; }
        else { el.innerHTML = WQ.skeleton(5); await reload(); }
      }
      paint(el);
    },
  };
})(window.WQ);
