/* WorkQuest — shell: transport, routing, the currency strip, and the one
 * place that turns a { player, deltas } response into something the player
 * can see. Screen modules register themselves on WQ.screens. */
window.WQ = (function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  // The shell injects ?token= on the initial iframe load; every later fetch
  // forwards it in a header. An offline launch carries no token at all, which
  // is a state to survive, not to crash on.
  const TOKEN = params.get('token') || '';
  const DEMO = params.get('demo') === '1';
  const SHOT = params.get('shot') || '';

  const state = {
    player: null,
    targets: [],
    screen: 'journal',
    ready: false,
  };

  // ── formatting ────────────────────────────────────────────────────────────
  const UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];
  function num(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(Math.floor(n));
    let u = 0;
    while (n >= 1000 && u < UNITS.length - 1) { n /= 1000; u++; }
    return (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.floor(n)) + UNITS[u];
  }
  function plain(n) { return (Math.floor(Number(n) || 0)).toLocaleString('en-US'); }
  function rate(n) {
    n = Number(n) || 0;
    return (n < 10 ? n.toFixed(1) : num(n)) + '/s';
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── transport ─────────────────────────────────────────────────────────────
  function url(path) {
    const u = new URL(path, location.origin);
    if (DEMO) u.searchParams.set('demo', '1');
    return u.pathname + (u.search || '');
  }

  async function api(path, opts) {
    const o = Object.assign({ headers: {} }, opts || {});
    o.headers = Object.assign({ 'content-type': 'application/json' }, o.headers);
    if (TOKEN) o.headers['x-usernode-token'] = TOKEN;
    if (o.body && typeof o.body !== 'string') o.body = JSON.stringify(o.body);
    const res = await fetch(url(path), o);
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (!res.ok) {
      const err = new Error((data && (data.message || data.error)) || ('HTTP ' + res.status));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ── feedback ──────────────────────────────────────────────────────────────
  function toast(message, opts) {
    if (!message) return;
    if (window.unNative && unNative.toast) unNative.toast(message, opts);
  }

  // Every mutating endpoint answers { player, deltas }. This is the single
  // place that shows what the player just earned, so no screen has to
  // reimplement "what happened".
  function applyDeltas(data) {
    if (!data) return;
    if (data.player) setPlayer(data.player);
    const d = data.deltas;
    if (!d) return;
    const lines = [];
    (d.messages || []).forEach((m) => lines.push(m));
    (d.tier_ups || []).forEach((t) => lines.push(`Tier ${t.tier} — ${t.label}`));
    (d.cosmetics || []).forEach((c) => lines.push(`Unlocked ${c.name || c}`));
    if (d.level_up) lines.push(`Journal Level ${d.level_up}`);
    if (lines.length) toast(lines.join(' · '));
  }

  // ── currency strip ────────────────────────────────────────────────────────
  function chip(label, value, cls) {
    return `<span class="shrink-0 px-2 py-1 rounded-full border ${cls}">
      <span class="opacity-70">${label}</span> <span class="font-semibold tabular-nums">${value}</span></span>`;
  }

  function setPlayer(p) {
    if (!p) return;
    state.player = p;
    renderStrip();
  }

  function renderStrip() {
    const p = state.player;
    const strip = document.getElementById('currency-strip');
    if (!strip) return;
    if (!p) { strip.innerHTML = ''; return; }
    strip.innerHTML = [
      chip('Focus', num(p.focus), 'border-sky-500/40 bg-sky-500/10 text-sky-200'),
      chip('Resolve', plain(p.resolve), 'border-violet-500/40 bg-violet-500/10 text-violet-200'),
      chip('Tier', p.tier, 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'),
      chip('Lv', p.journal_level, 'border-zinc-700 bg-zinc-800/60 text-zinc-300'),
    ].join('');
    const s = document.getElementById('streak-chip');
    if (s) {
      if (p.streak > 0) {
        s.classList.remove('hidden');
        const pct = Math.round((p.multiplier - 1) * 100);
        s.textContent = `🔥 ${p.streak}d${pct ? ' · +' + pct + '%' : ''}`;
      } else {
        s.classList.add('hidden');
      }
    }
  }

  function setTitle(title, sub) {
    const t = document.getElementById('screen-title');
    const s = document.getElementById('screen-sub');
    if (t) t.textContent = title;
    if (s) s.textContent = sub || '';
  }

  // ── routing ───────────────────────────────────────────────────────────────
  const screens = {};

  function parseHash() {
    const raw = (location.hash || '').replace(/^#\/?/, '');
    const parts = raw.split('/').filter(Boolean);
    const name = screens[parts[0]] ? parts[0] : 'journal';
    return { name, rest: parts.slice(1) };
  }

  function el(name) { return document.querySelector(`[data-screen="${name}"]`); }

  let navigating = false;
  async function route(opts) {
    const { name, rest } = parseHash();
    const changed = name !== state.screen;
    const prev = state.screen;
    state.screen = name;

    document.querySelectorAll('#tabbar [data-tab]').forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle('text-violet-300', on);
      b.classList.toggle('text-zinc-500', !on);
    });

    const show = () => {
      document.querySelectorAll('[data-screen]').forEach((s) => {
        s.classList.toggle('hidden', s.dataset.screen !== name);
      });
    };
    // Tab switches are high-frequency UI — animating them reads as lag, so
    // the kit is asked for an instant cut.
    if (changed && window.unNative && unNative.transition) {
      unNative.transition(show, { type: 'none' });
    } else {
      show();
    }
    if (changed) document.getElementById('scroll').scrollTop = 0;

    const screen = screens[name];
    if (!screen) return;
    if (navigating) return;
    navigating = true;
    try {
      await screen.render(el(name), rest, Object.assign({ changed, prev }, opts || {}));
    } catch (err) {
      console.error('[route]', name, err);
      el(name).innerHTML = errorBlock(err);
    } finally {
      navigating = false;
    }
  }

  function errorBlock(err) {
    return `<div class="p-6 text-center text-sm text-zinc-400">
      <div class="text-2xl mb-2">😵</div>
      <div class="text-zinc-300 mb-1">Something went wrong loading this screen.</div>
      <div class="text-xs text-zinc-500">${esc(err && err.message)}</div>
    </div>`;
  }

  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  function skeleton(rows) {
    let out = '<div class="p-4 space-y-3">';
    for (let i = 0; i < (rows || 4); i++) {
      out += '<div class="h-12 rounded-xl bg-zinc-900 animate-pulse"></div>';
    }
    return out + '</div>';
  }

  // ── boot ──────────────────────────────────────────────────────────────────
  async function boot() {
    document.querySelectorAll('#tabbar [data-tab]').forEach((b) => {
      b.addEventListener('click', () => go('#/' + b.dataset.tab));
    });
    window.addEventListener('hashchange', () => route());

    // Deep links for screenshots and the "Test this change" button. These are
    // pure UI state — no writes — so they work in every environment, which is
    // what lets the "before" shot start working the moment they ship.
    if (SHOT && !location.hash) {
      if (SHOT === 'week' || SHOT === 'review') location.hash = '#/journal/week';
      else if (SHOT === 'workshop') location.hash = '#/workshop';
      else if (SHOT === 'season') location.hash = '#/season';
      else if (SHOT === 'profile' || SHOT === 'locker') location.hash = '#/profile';
    }
    if (!location.hash) location.hash = '#/journal';

    try {
      // The server keeps period keys in the player's own timezone; the browser
      // is the only thing that knows what that is on a first visit.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const data = await api('/api/bootstrap' + (tz ? '?tz=' + encodeURIComponent(tz) : ''));
      state.targets = data.targets || [];
      state.is_new = !!data.is_new;
      state.purchases_enabled = !!data.purchases_enabled;
      setPlayer(data.player);
      if (screens.journal) screens.journal.prime(data);
      state.ready = true;
    } catch (err) {
      console.error('[boot]', err);
      if (err.status === 401) {
        el('journal').innerHTML = `<div class="p-6 text-center text-sm text-zinc-400">
          <div class="text-2xl mb-2">🔒</div>Open this app inside Usernode to start journalling.</div>`;
        return;
      }
      el('journal').innerHTML = errorBlock(err);
      return;
    }
    await route();
  }

  return {
    api, boot, route, go, screens, state, setPlayer, applyDeltas, toast,
    num, plain, rate, esc, setTitle, skeleton, errorBlock,
    DEMO, SHOT,
  };
})();
