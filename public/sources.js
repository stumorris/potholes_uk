(async () => {
  const box = document.getElementById('sources');
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null)); return n; };
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'never');
  try {
    const sources = await (await fetch('/api/sources')).json();
    box.replaceChildren(...sources.filter((s) => s.enabled).map((s) => {
      let status;
      if (s.id === 'user') status = el('span', { className: 'status-ok' }, 'Live');
      else if (!s.status) status = el('span', { className: 'status-off' }, 'Not synced yet');
      else if (s.status.last_error) status = el('span', { className: 'status-err' }, `Last attempt failed (${fmt(s.status.last_run_at)})`);
      else status = el('span', { className: 'status-ok' }, `OK – updated ${fmt(s.status.last_ok_at)}`);
      return el('div', { className: 'card' },
        el('h3', {}, s.homepage ? el('a', { href: s.homepage, rel: 'noopener' }, s.name) : s.name),
        el('p', {}, `${(s.count ?? 0).toLocaleString('en-GB')} potholes stored · `, status),
        s.attribution ? el('p', { className: 'small hint' }, s.attribution) : null);
    }));
  } catch {
    box.textContent = 'Could not load source list.';
  }
})();
