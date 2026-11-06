// Static hosts can't send X-Frame-Options / frame-ancestors: refuse to run inside a frame.
if (window.top !== window.self) {
  document.documentElement.style.display = 'none';
  try {
    window.top.location = window.self.location;
  } catch (e) {
    /* cross-origin parent: stay hidden */
  }
}

// Applies the saved theme before React mounts, to avoid a flash. Dark is the default.
(function () {
  var pref = 'dark';
  try {
    pref = localStorage.getItem('ledger.theme') || 'dark';
  } catch (e) {
    /* storage unavailable */
  }
  var theme = pref;
  if (pref === 'system') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#F5F6F8' : '#0B0D12');
})();
