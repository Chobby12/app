/* Dashboard chrome: the off-canvas menu and the theme switch. */
(function () {
  'use strict';
  var root = document.documentElement;
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- off-canvas menu ---------- */
  var side = document.getElementById('admSide');
  var burger = document.getElementById('admBurger');
  var scrim = document.getElementById('admScrim');
  var mobile = window.matchMedia('(max-width: 900px)');
  var open = false;

  function focusables() {
    return Array.prototype.filter.call(side.querySelectorAll('a, button'), function (el) {
      return el.offsetParent !== null && !el.disabled;
    });
  }

  function setMenu(v) {
    open = v;
    side.classList.toggle('open', v);
    scrim.classList.toggle('open', v);
    burger.setAttribute('aria-expanded', String(v));
    burger.setAttribute('aria-label', v ? 'Close menu' : 'Open menu');
    scrim.setAttribute('aria-hidden', String(!v));
    root.classList.toggle('adm-locked', v);
    if (v) {
      // The sidebar's brand link is display:none at this width, so pick the first
      // element that is actually rendered — focusing a hidden one silently no-ops.
      var first = focusables()[0];
      if (first) setTimeout(function () { first.focus(); }, REDUCED ? 0 : 220);
    } else if (document.activeElement && side.contains(document.activeElement)) {
      burger.focus();
    }
  }

  if (side && burger && scrim) {
    burger.addEventListener('click', function () { setMenu(!open); });
    scrim.addEventListener('click', function () { setMenu(false); });
    var closeBtn = document.getElementById('admClose');
    if (closeBtn) closeBtn.addEventListener('click', function () { setMenu(false); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) { setMenu(false); return; }
      // Keep tabbing inside the drawer while it covers the page.
      if (e.key === 'Tab' && open) {
        var f = focusables();
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      }
    });

    // Widening the window past the breakpoint must not leave the page locked.
    var onBreakpoint = function (e) { if (!e.matches && open) setMenu(false); };
    if (mobile.addEventListener) mobile.addEventListener('change', onBreakpoint);
    else if (mobile.addListener) mobile.addListener(onBreakpoint);
  }

  /* ---------- theme, sharing the site's stored preference ---------- */
  // Two toggles exist — one in the top bar, one in the sidebar — and only one is
  // visible at a time. Both are kept in sync.
  var toggles = Array.prototype.slice.call(document.querySelectorAll('[data-theme-toggle]'));
  function applyTheme(t, animate, persist) {
    if (animate && !REDUCED) {
      root.classList.add('theming');
      setTimeout(function () { root.classList.remove('theming'); }, 440);
    }
    root.setAttribute('data-theme', t);
    toggles.forEach(function (el) {
      el.setAttribute('aria-pressed', String(t === 'light'));
      el.setAttribute('aria-label', t === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    });
    if (persist) { try { localStorage.setItem('josion-theme', t); } catch (e) {} }
  }
  if (toggles.length) {
    applyTheme(root.getAttribute('data-theme') === 'light' ? 'light' : 'dark', false, false);
    toggles.forEach(function (el) {
      el.addEventListener('click', function () {
        applyTheme(root.getAttribute('data-theme') === 'light' ? 'dark' : 'light', true, true);
      });
    });
  }
})();
