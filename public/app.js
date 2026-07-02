const LTQ_USER_KEY = 'ltq_user';

function getAuth() {
  try { return JSON.parse(localStorage.getItem(LTQ_USER_KEY) || 'null'); } catch { return null; }
}
function setAuth(data) {
  const { role, name, email, permissions, mustChangePassword, contestantId, id } = data;
  localStorage.setItem(LTQ_USER_KEY, JSON.stringify({ role, name, email, permissions, mustChangePassword, contestantId, id }));
}
function clearAuth() {
  localStorage.removeItem(LTQ_USER_KEY);
  fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
}

function dashboardUrlForRole(role) {
  const map = {
    superuser:               'dashboard-superuser.html',
    contestant_manager:      'dashboard-contestant-manager.html',
    finance_manager:         'dashboard-finance-manager.html',
    judge:                   'dashboard-judge.html',
    content_manager:         'dashboard-content-manager.html',
    admin:                   'dashboard-admin.html',
    head_judge:              'dashboard-head-judge.html',
    media_coordinator:       'dashboard-media-coordinator.html',
    communications_manager:  'dashboard-communications-manager.html',
  };
  return map[role] || 'index.html';
}

async function authFetch(url, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...options, headers, credentials: 'include' });
  if (res.status === 401) { clearAuth(); window.location.href = 'login.html'; throw new Error('Session expired'); }
  return res;
}

function guardRole(allowedRoles) {
  const auth = getAuth();
  if (!auth?.role || !allowedRoles.includes(auth.role)) {
    window.location.href = 'login.html';
    return null;
  }
  if (auth.mustChangePassword) {
    window.location.href = 'change-password.html';
    return null;
  }
  return auth;
}

function hasPermission(key) {
  const auth = getAuth();
  if (!auth) return false;
  const perms = auth.permissions || [];
  return perms.includes('*') || perms.includes(key);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function renderAuthNav() {
  const navAuth = document.getElementById('navAuth');
  if (!navAuth) return;
  const auth = getAuth();

  if (auth?.role) {
    navAuth.innerHTML = `
      <a class="nav-auth-dashboard" href="${dashboardUrlForRole(auth.role)}">Dashboard</a>
      <button class="nav-auth-logout" id="logoutBtn">Log out</button>`;
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      clearAuth(); window.location.href = 'index.html';
    });
  }
  // Login is intentionally not shown in the public nav — accessible at /login.html directly.
}

function initNav() {
  const toggle = document.querySelector('.nav-toggle');
  const links  = document.querySelector('.nav-links');
  if (toggle && links) toggle.addEventListener('click', () => links.classList.toggle('open'));
  renderAuthNav();
}

function initScrollFX() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bars = document.querySelectorAll('.site-nav, .admin-topbar');
  if (bars.length) {
    const onScroll = () => { const s = window.scrollY > 8; bars.forEach((b) => b.classList.toggle('is-scrolled', s)); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  const targets = document.querySelectorAll(
    '.hero-inner, .category-strip, .section-head, .phase-list .phase, ' +
    '.contestant-grid .card, .stat-grid, .board-row, .queue-item, ' +
    '.form-card, .auth-card, .table-wrap, .tabs'
  );
  if (!targets.length) return;

  if (reduceMotion || typeof IntersectionObserver === 'undefined') {
    targets.forEach((el) => el.classList.add('reveal', 'is-visible'));
    return;
  }
  targets.forEach((el) => el.classList.add('reveal'));
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-visible'); obs.unobserve(e.target); } });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  targets.forEach((el) => obs.observe(el));
}

const THEME_KEY  = 'ltq_theme';
const ICON_SUN   = '<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path></svg>';
const ICON_MOON  = '<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

function initThemeToggle() {
  const root = document.documentElement;
  const btn  = document.createElement('button');
  btn.type      = 'button';
  btn.className = 'theme-toggle';
  btn.setAttribute('aria-label', 'Switch between light and dark theme');
  btn.innerHTML = ICON_SUN + ICON_MOON;
  btn.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch {}
  });

  const navWrap   = document.querySelector('.site-nav .wrap');
  const topbarUser = document.querySelector('.admin-topbar .topbar-user');
  const topbar    = document.querySelector('.admin-topbar');

  if (navWrap) {
    navWrap.appendChild(btn);
  } else if (topbarUser) {
    topbarUser.insertBefore(btn, topbarUser.firstChild);
  } else if (topbar) {
    topbar.appendChild(btn);
  }
}

const _ICO_PIN  = `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
const _ICO_PHONE = `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.68A2 2 0 012 .18h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>`;
const _ICO_MAIL  = `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`;
const _ICO_MAIL_BTN = `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`;
const _ICO_WA    = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;
const _ICO_WA_SM = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;
const _ICO_FB    = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`;
const _ICO_IG    = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>`;
const _ICO_TT    = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.17 8.17 0 004.78 1.53V6.75a4.85 4.85 0 01-1.01-.06z"/></svg>`;
const _ICO_X     = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;
const _ICO_YT    = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`;
const _ICO_LI    = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`;
const _ICO_PINT  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12 0-6.628-5.373-12-12-12z"/></svg>`;
const _ICO_SNAP  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.206.793c.99 0 4.347.276 5.93 3.821.5 1.17.478 3.177.463 4.345l.017.064c.043.021.122.05.255.05.198 0 .47-.057.784-.21l.148-.072.145.086c.12.073.221.178.279.305.132.295.105.632-.08.896-.41.587-1.116.928-2.033.928-.102 0-.205-.006-.31-.018-.02.01-.04.021-.059.031-.037.02-.073.038-.11.056-.02.01-.04.02-.06.03C16.68 11.98 15.96 13.014 15.96 13.014c.025.204.122.476.293.797l.007.012c.408.769 1.24 1.857 2.854 2.355.097.03.171.08.22.15.033.046.034.092.021.14-.027.098-.116.148-.227.171-.083.017-.17.027-.261.027-.064 0-.131-.006-.201-.017-.142-.025-.28-.06-.409-.101l-.086-.025a3.56 3.56 0 00-.7-.116c-.04 0-.081.002-.121.006-.225.02-.437.084-.622.186-.377.21-.737.556-1.06.89-.23.236-.437.47-.65.694a3.95 3.95 0 01-.295.278 3.48 3.48 0 01-1.965.618 3.57 3.57 0 01-1.985-.62 3.867 3.867 0 01-.29-.274c-.213-.225-.421-.459-.652-.695-.323-.334-.683-.68-1.06-.89a2.234 2.234 0 00-.622-.186c-.04-.004-.08-.006-.12-.006-.236 0-.47.04-.704.117l-.086.026a3.44 3.44 0 01-.409.1c-.07.012-.137.018-.201.018-.091 0-.179-.01-.261-.027-.111-.023-.2-.073-.228-.17-.013-.049-.012-.095.022-.14.049-.07.123-.12.22-.15 1.614-.498 2.447-1.586 2.854-2.355l.008-.012c.17-.321.268-.593.293-.797 0 0-.72-1.034-1.602-1.894a2.39 2.39 0 00-.06-.031 3.003 3.003 0 00-.109-.056 1.994 1.994 0 00-.059-.031c-.105.012-.208.018-.311.018-.916 0-1.623-.341-2.033-.928-.185-.264-.212-.601-.08-.896.058-.127.16-.232.279-.305l.145-.086.148.072c.313.153.587.21.785.21.132 0 .211-.029.255-.05l.017-.064c-.015-1.168-.037-3.175.463-4.345C7.859 1.07 11.216.793 12.206.793z"/></svg>`;
const _ICO_RD    = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>`;
const _ICO_DC    = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`;

const SOCIAL_GLYPHS = {
  facebook:  { label: 'Facebook',  glyph: _ICO_FB   },
  instagram: { label: 'Instagram', glyph: _ICO_IG   },
  tiktok:    { label: 'TikTok',    glyph: _ICO_TT   },
  twitter:   { label: 'X',         glyph: _ICO_X    },
  youtube:   { label: 'YouTube',   glyph: _ICO_YT   },
  linkedin:  { label: 'LinkedIn',  glyph: _ICO_LI   },
  pinterest: { label: 'Pinterest', glyph: _ICO_PINT },
  snapchat:  { label: 'Snapchat',  glyph: _ICO_SNAP },
  reddit:    { label: 'Reddit',    glyph: _ICO_RD   },
  discord:   { label: 'Discord',   glyph: _ICO_DC   },
};

// Fetches /api/seasons/current and updates every .season-label element on the page.
// Also updates document.title if it contains the placeholder "Season Two" or similar.
async function initSeasonLabel() {
  try {
    const season = await fetch('/api/seasons/current').then((r) => r.json());
    if (!season) return;
    const label = season.name; // e.g. "Season Two"
    window.ltqSeasonName = label;
    document.querySelectorAll('.season-label').forEach((el) => {
      el.textContent = label;
    });
    // Update <title> if it has a season placeholder
    if (document.title.includes('Season')) {
      document.title = document.title.replace(/Season\s+\w+/gi, label);
    }
  } catch {}
}

// Call with a fetch Response to show a notice when the API fell back to a previous season.
// Pages that display contestant/schedule/announcement data should call this after fetching.
function checkSeasonFallback(response) {
  if (response.headers.get('X-Season-Fallback') !== 'true') return;
  if (document.querySelector('.ltq-fallback-banner')) return; // already shown
  const seasonName = response.headers.get('X-Season-Fallback-Name')
    || `Season ${response.headers.get('X-Season-Fallback-Number')}`;
  const banner = document.createElement('div');
  banner.className = 'ltq-fallback-banner';
  banner.style.cssText = [
    'background:var(--brand-gold,#c8960c)',
    'color:#000',
    'text-align:center',
    'padding:10px 20px',
    'font-size:0.875rem',
    'font-weight:600',
    'position:relative',
    'z-index:10',
  ].join(';');
  banner.textContent = `Showing ${seasonName} highlights — the new season is just getting started. Check back soon!`;
  // Insert after the first <nav> if present, otherwise at the top of <body>
  const nav = document.querySelector('nav, header');
  if (nav && nav.nextSibling) {
    nav.parentNode.insertBefore(banner, nav.nextSibling);
  } else {
    document.body.insertBefore(banner, document.body.firstChild);
  }
}

async function initFooter() {
  const yearEl = document.getElementById('footerYear');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const socialWrap = document.getElementById('footerSocial');
  const contactList = document.getElementById('footerContact');
  if (socialWrap || contactList) {
    try {
      const s = await fetch('/api/settings').then((r) => r.json());
      if (socialWrap) {
        const items = Object.entries(SOCIAL_GLYPHS)
          .filter(([key]) => s[key])
          .map(([key, { label, glyph }]) =>
            `<a class="footer-social-btn ${key}" href="${s[key]}" target="_blank" rel="noopener" aria-label="${label}">${glyph}</a>`
          );
        socialWrap.innerHTML = items.join('');
      }
      if (contactList) {
        contactList.innerHTML = `
          <li><span class="ico">${_ICO_PIN}</span> Paynesville, Liberia</li>
          ${s.contact_phone ? `<li><span class="ico">${_ICO_PHONE}</span> <a href="tel:${s.contact_phone.replace(/\s/g,'')}">${escapeHtml(s.contact_phone)}</a></li>` : ''}
          ${s.contact_email ? `<li><span class="ico">${_ICO_MAIL}</span> <a href="mailto:${s.contact_email}">${escapeHtml(s.contact_email)}</a></li>` : ''}
          ${s.whatsapp ? `<li><span class="ico">${_ICO_WA_SM}</span> <a href="${s.whatsapp}" target="_blank" rel="noopener">WhatsApp</a></li>` : ''}`;
      }
    } catch {}
  }

  const logosWrap = document.getElementById('footerLogos');
  if (logosWrap) {
    try {
      const sponsors = await fetch('/api/sponsors').then((r) => r.json());
      logosWrap.innerHTML = sponsors.length
        ? sponsors.map((sp) => `<div class="footer-logo-item"><img src="${sp.logoUrl || 'assets/Sponsor_1.jpg'}" alt="${escapeHtml(sp.name)}" /><span>${escapeHtml(sp.name)}</span></div>`).join('')
        : '<span style="font-size:0.85rem;color:var(--muted-soft);">Partnerships announced soon.</span>';
    } catch { logosWrap.innerHTML = ''; }
  }
}

const SIDEBAR_COLLAPSE_KEY = 'ltq_sidebar_collapsed';

const ICON_CHEVRON_LEFT = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>`;

function initSidebarCollapse() {
  const sidebar = document.querySelector('.admin-sidebar');
  if (!sidebar) return;

  // Restore persisted state (desktop only — CSS overrides on mobile)
  const isCollapsed = localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1';
  if (isCollapsed) sidebar.classList.add('collapsed');

  // Inject collapse button
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sidebar-collapse-btn';
  btn.setAttribute('aria-label', 'Toggle sidebar');
  btn.innerHTML = ICON_CHEVRON_LEFT;

  const nav = sidebar.querySelector('.sidebar-nav');
  if (nav) {
    sidebar.insertBefore(btn, nav);
  } else {
    sidebar.appendChild(btn);
  }

  btn.addEventListener('click', () => {
    const nowCollapsed = sidebar.classList.toggle('collapsed');
    try { localStorage.setItem(SIDEBAR_COLLAPSE_KEY, nowCollapsed ? '1' : '0'); } catch {}
  });
}

function initMobileSidebar() {
  const sidebar  = document.querySelector('.admin-sidebar');
  const toggle   = document.querySelector('.topbar-toggle');
  const backdrop = document.querySelector('.sidebar-backdrop');
  if (!sidebar || !toggle) return;

  const open  = () => { sidebar.classList.add('open');  backdrop?.classList.add('open'); };
  const close = () => { sidebar.classList.remove('open'); backdrop?.classList.remove('open'); };

  toggle.addEventListener('click', () => sidebar.classList.contains('open') ? close() : open());
  backdrop?.addEventListener('click', close);
}

// ── Styled confirm modal ──────────────────────────────────────────────────
function _ensureConfirmEl() {
  if (document.getElementById('ltq-confirm-overlay')) return;
  const el = document.createElement('div');
  el.className = 'modal-overlay';
  el.id = 'ltq-confirm-overlay';
  el.innerHTML = `
    <div class="modal" style="max-width:420px;">
      <h3 id="ltq-confirm-title" style="margin-bottom:12px;font-size:1.1rem;"></h3>
      <p id="ltq-confirm-msg" style="color:var(--muted);margin-bottom:24px;line-height:1.65;white-space:pre-line;"></p>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="ltq-confirm-cancel" style="flex:1;">Cancel</button>
        <button class="btn btn-primary"   id="ltq-confirm-ok"     style="flex:1;">Confirm</button>
      </div>
    </div>`;
  document.body.appendChild(el);
}

window.ltqConfirm = function(message, { title = 'Confirm', danger = false, okLabel } = {}) {
  _ensureConfirmEl();
  return new Promise((resolve) => {
    const overlay = document.getElementById('ltq-confirm-overlay');
    document.getElementById('ltq-confirm-title').textContent = title;
    document.getElementById('ltq-confirm-msg').textContent   = message;
    const okBtn = document.getElementById('ltq-confirm-ok');
    okBtn.className   = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    okBtn.textContent = okLabel || (danger ? 'Delete' : 'Confirm');
    overlay.classList.add('open');

    function cleanup() {
      overlay.classList.remove('open');
      okBtn.removeEventListener('click', onOk);
      document.getElementById('ltq-confirm-cancel').removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBg);
    }
    function onOk()  { cleanup(); resolve(true);  }
    function onCancel() { cleanup(); resolve(false); }
    function onBg(e) { if (e.target === overlay) { cleanup(); resolve(false); } }

    okBtn.addEventListener('click', onOk);
    document.getElementById('ltq-confirm-cancel').addEventListener('click', onCancel);
    overlay.addEventListener('click', onBg);
  });
};

// ── Toast notifications ───────────────────────────────────────────────────
function _ensureToastContainer() {
  if (document.getElementById('ltq-toast-wrap')) return;
  const el = document.createElement('div');
  el.id = 'ltq-toast-wrap';
  el.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:10000;display:flex;flex-direction:column-reverse;gap:10px;pointer-events:none;max-width:360px;';
  document.body.appendChild(el);
}

window.ltqToast = function(message, type = 'error') {
  _ensureToastContainer();
  const typeMap = { error: 'alert-error', success: 'alert-success', info: 'alert-info' };
  const toast = document.createElement('div');
  toast.className = `alert ${typeMap[type] || 'alert-error'}`;
  toast.style.cssText = 'pointer-events:auto;opacity:1;transition:opacity 0.35s ease;box-shadow:0 4px 24px rgba(0,0,0,0.45);';
  toast.textContent = message;
  document.getElementById('ltq-toast-wrap').appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 370);
  }, 4500);
};

// ── Global form loading state ──────────────────────────────────────────────
(function() {
  const SPINNER_HTML = '<svg class="ltq-btn-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" stroke-dasharray="28 56" stroke-linecap="round"/></svg>';

  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (!form || form.dataset.noLoader) return;
    const btn = form.querySelector('[type="submit"]');
    if (!btn || btn.dataset.noLoader) return;

    const origHTML     = btn.innerHTML;
    const origDisabled = btn.disabled;
    btn.disabled = true;
    btn.innerHTML = SPINNER_HTML + ' Saving…';

    let restored = false;
    let observer  = null;
    let fallback;

    function doRestore() {
      if (restored) return;
      restored = true;
      if (observer) { observer.disconnect(); observer = null; }
      clearTimeout(fallback);
      btn.disabled = origDisabled;
      btn.innerHTML = origHTML;
    }

    // Derive alert element ID from form ID (annForm → annAlert, editAnnForm → editAnnAlert, etc.)
    const formId = form.id || '';
    let alertEl = formId ? document.getElementById(formId.replace(/Form$/, 'Alert')) : null;
    if (!alertEl) {
      // Fallback: nearest ancestor modal/section with an [id$="Alert"] child
      const scope = form.closest('.modal, .admin-section, .section-head') || form.parentElement;
      if (scope) alertEl = scope.querySelector('[id$="Alert"]');
    }

    if (alertEl) {
      observer = new MutationObserver(doRestore);
      observer.observe(alertEl, { childList: true, subtree: true });
    }

    // Safety: restore after 8 s regardless
    fallback = setTimeout(doRestore, 8000);
  }, true);
})();

document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initScrollFX();
  initThemeToggle();
  initFooter();
  initSeasonLabel();
  initSidebarCollapse();
  initMobileSidebar();
});
