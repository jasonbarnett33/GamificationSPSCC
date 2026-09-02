/**
 * Collapsible dashboard cards.
 * Markup: .collapsible-card > .collapsible-header > .collapsible-toggle + optional .collapsible-actions
 *          .collapsible-card > .collapsible-body
 * Optional: data-collapse-key (persists in localStorage), data-collapse-default="collapsed"
 */
function initCollapsibleCards(root = document) {
  root.querySelectorAll('.collapsible-card').forEach((card) => {
    if (card.dataset.collapseReady === '1') return;

    const toggle = card.querySelector(':scope > .collapsible-header .collapsible-toggle');
    const body = card.querySelector(':scope > .collapsible-body');
    if (!toggle || !body) return;

    card.dataset.collapseReady = '1';

    const storageKey = card.dataset.collapseKey
      ? `cq-collapse:${card.dataset.collapseKey}`
      : null;

    let collapsed = card.dataset.collapseDefault === 'collapsed';
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved === '1') collapsed = true;
      else if (saved === '0') collapsed = false;
    }

    function apply() {
      card.classList.toggle('is-collapsed', collapsed);
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      body.hidden = collapsed;
      if (storageKey) localStorage.setItem(storageKey, collapsed ? '1' : '0');
    }

    apply();
    toggle.addEventListener('click', () => {
      collapsed = !collapsed;
      apply();
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initCollapsibleCards());
} else {
  initCollapsibleCards();
}
