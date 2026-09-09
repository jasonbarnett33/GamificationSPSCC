const FRAME_TIER_MAX = 9;

const FRAME_TIER_NAMES = [
  'Plain',
  'Wood',
  'Bronze',
  'Iron',
  'Silver',
  'Gold',
  'Emerald',
  'Sapphire',
  'Arcane',
  'Radiant',
];

const BADGE_TIER_MAX = 2;
const BADGE_TIER_NAMES = ['Basic', 'Improved', 'Upgraded'];

const BADGE_THRESHOLDS = {
  streak: [2, 3, 4],
  quest: [10, 20, 30],
  teamwork: [5, 10, 15],
  scholar: [5, 10, 15],
  campus: [5, 10, 15],
  raid: [1, 2, 3],
  completionist: [50, 75, 100],
};

const BADGE_TYPES = [
  {
    id: 'streak',
    name: 'Streak',
    how: 'Complete at least 2 quests, 2 / 3 / 4 weeks in a row. Can be lost.',
    icon: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.2 1.6c.4-.6 1.3-.4 1.5.3.6 2.1.4 3.8-.4 5.3 2.4-1 4.7.3 6 2.7 1.6 2.9.8 6.5-1.8 8.6-3 2.4-7.4 2.1-10-.7C6 15.2 5.4 11.4 7 8.6c.4-.8 1.5-.7 1.8.1.5 1.4.4 2.6-.2 3.6 0-3.2 1.3-6.4 4.6-10.7zM9.6 19.3c1.8 1.8 4.7 2.1 6.7.5 2.1-1.7 2.6-4.6 1.3-6.8-.6 1.8-2 3.2-3.8 3.7-.6.2-1.1-.4-.9-1 .4-1.3.3-2.6-.3-3.8-1.8 1.6-2.6 4.1-3 7.4z"/></svg>',
  },
  {
    id: 'quest',
    name: 'Quest',
    how: 'Complete 10 / 20 / 30 quests total. Weekly quests count each week.',
    icon: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 2h2.4v20H5V2zm3.2 1.6 13 4.7-13 4.7V3.6z"/></svg>',
  },
  {
    id: 'teamwork',
    name: 'Teamwork',
    how: 'Reach Teamwork level 5 / 10 / 15.',
    icon: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2 20 6v6.2c0 4.6-3.1 8.7-8 9.8-4.9-1.1-8-5.2-8-9.8V6l8-3.8zm0 2.3L6 7.1v5.1c0 3.6 2.4 6.8 6 7.7 3.6-.9 6-4.1 6-7.7V7.1l-6-2.6zm-3.2 6.2 2.1 2.1 4.4-4.4 1.4 1.4-5.8 5.8-3.5-3.5 1.4-1.4z"/></svg>',
  },
  {
    id: 'scholar',
    name: 'Scholar',
    how: 'Reach Studying level 5 / 10 / 15.',
    icon: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3 1.8 8.6 12 14.2l8.3-4.5v5.8h2.4V8.6L12 3zM6.2 13.4v3.6c0 .9 2.6 2.5 5.8 2.5s5.8-1.6 5.8-2.5v-3.6L12 16.6l-5.8-3.2z"/></svg>',
  },
  {
    id: 'campus',
    name: 'Campus',
    how: 'Reach College Success level 5 / 10 / 15.',
    icon: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2 14.4 8h6.3l-5.1 3.8 1.9 6-5.5-3.9-5.5 3.9 1.9-6L3.3 8h6.3L12 2.2zm0 4.2-.9 2.2H8.7l1.9 1.4-.7 2.3 2.1-1.5 2.1 1.5-.7-2.3 1.9-1.4h-2.4L12 6.4z"/></svg>',
  },
  {
    id: 'raid',
    name: 'Raid Boss',
    how: 'Join 1 / 2 / 3 raids that your class finishes.',
    icon: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 3 9.5 8.5 8 10l-4.2-1.2L2 3.6 4 3zm16 0 2 0.6-1.8 5.2L16 10l-1.5-1.5L20 3zM9.2 11.2 12 14l2.8-2.8 3.5 3.5-1.5 1.5 2 5.8-5.2-2.2-1.2 1.2-1.4-1.4-1.4 1.4-1.2-1.2-5.2 2.2 2-5.8-1.5-1.5 3.5-3.5z"/></svg>',
  },
  {
    id: 'completionist',
    name: 'Completionist',
    how: 'Finish 50% / 75% / 100% of a week’s available quests.',
    icon: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 5h3v3H4V5zm5 .6h11v1.8H9V5.6zM4 10.5h3v3H4v-3zm5 .6h11v1.8H9v-1.8zM4 16h3v3H4v-3zm5 .6h11v1.8H9v-1.8zM5.1 6.1l.8.8 1.5-1.6.9.9-2.4 2.4-1.7-1.7.9-.8zm0 5.5.8.8 1.5-1.6.9.9-2.4 2.4-1.7-1.7.9-.8zM5.1 17l.8.8 1.5-1.6.9.9-2.4 2.4-1.7-1.7.9-.8z"/></svg>',
  },
];

function normalizeFrameTier(value) {
  const tier = Number(value);
  if (!Number.isFinite(tier)) return 0;
  return Math.min(FRAME_TIER_MAX, Math.max(0, Math.round(tier)));
}

function frameTierName(tier) {
  return FRAME_TIER_NAMES[normalizeFrameTier(tier)];
}

function frameTierClass(tier) {
  return `frame-tier-${normalizeFrameTier(tier)}`;
}

function applyFrameTier(element, tier) {
  if (!element) return;
  for (let i = 0; i <= FRAME_TIER_MAX; i++) {
    element.classList.remove(`frame-tier-${i}`);
  }
  element.classList.add(frameTierClass(tier));
}

function normalizeBadgeTier(value) {
  if (value === null || value === undefined || value === '') return null;
  const tier = Number(value);
  if (!Number.isFinite(tier)) return null;
  return Math.min(BADGE_TIER_MAX, Math.max(0, Math.round(tier)));
}

function badgeTierName(tier) {
  const normalized = normalizeBadgeTier(tier);
  return normalized === null ? 'Unearned' : BADGE_TIER_NAMES[normalized];
}

function normalizeBadges(badges) {
  const source = badges && typeof badges === 'object' ? badges : {};
  const out = {};
  BADGE_TYPES.forEach((type) => {
    out[type.id] = normalizeBadgeTier(source[type.id]);
  });
  return out;
}

function badgeTierFromThresholds(value, thresholds) {
  const amount = Number(value) || 0;
  let tier = null;
  (thresholds || []).forEach((min, index) => {
    if (amount >= min) tier = index;
  });
  return normalizeBadgeTier(tier);
}

function badgesEqual(a, b) {
  const left = normalizeBadges(a);
  const right = normalizeBadges(b);
  return BADGE_TYPES.every((type) => left[type.id] === right[type.id]);
}

function badgeGains(previous, next) {
  const before = normalizeBadges(previous);
  const after = normalizeBadges(next);
  return BADGE_TYPES.filter((type) => {
    const from = before[type.id];
    const to = after[type.id];
    return to !== null && (from === null || to > from);
  }).map((type) => ({
    type,
    from: before[type.id],
    to: after[type.id],
  }));
}

function badgeGainSummary(gains) {
  return (gains || [])
    .map((gain) => `${gain.type.name} (${badgeTierName(gain.to)})`)
    .join(', ');
}

function escapeAttr(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function badgeLabel(type, tier) {
  const status = `${type.name} — ${badgeTierName(tier)}`;
  return type.how ? `${status}. ${type.how}` : status;
}

function renderBadge(type, tier) {
  const normalized = normalizeBadgeTier(tier);
  const earned = normalized !== null;
  const classes = [
    'badge',
    `badge-${type.id}`,
    earned ? `badge-tier-${normalized}` : 'badge-unearned',
  ].join(' ');
  const label = badgeLabel(type, normalized);
  const status = `${type.name} — ${badgeTierName(normalized)}`;
  return `<button type="button" class="${classes}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}" aria-expanded="false" data-badge-name="${escapeAttr(status)}" data-badge-how="${escapeAttr(type.how || '')}">${type.icon}</button>`;
}

function hideBadgeTip() {
  const tip = document.getElementById('badge-tip');
  if (tip) tip.classList.add('hidden');
  document.querySelectorAll('.badge[aria-expanded="true"]').forEach((el) => {
    el.setAttribute('aria-expanded', 'false');
  });
}

function positionBadgeTip(badge, tip) {
  const rect = badge.getBoundingClientRect();
  const margin = 8;
  tip.classList.remove('hidden');
  const tipRect = tip.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  let top = rect.bottom + margin;
  left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));
  if (top + tipRect.height > window.innerHeight - margin) {
    top = rect.top - tipRect.height - margin;
  }
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(Math.max(margin, top))}px`;
}

function showBadgeTip(badge) {
  let tip = document.getElementById('badge-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'badge-tip';
    tip.className = 'badge-tip hidden';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }

  const alreadyOpen = badge.getAttribute('aria-expanded') === 'true';
  hideBadgeTip();
  if (alreadyOpen) return;

  const name = badge.getAttribute('data-badge-name') || badge.getAttribute('aria-label') || '';
  const how = badge.getAttribute('data-badge-how') || '';
  tip.innerHTML = `<strong class="badge-tip-name">${escapeAttr(name)}</strong>${
    how ? `<span class="badge-tip-how">${escapeAttr(how)}</span>` : ''
  }`;
  badge.setAttribute('aria-expanded', 'true');
  positionBadgeTip(badge, tip);
}

function setupBadgeTips() {
  if (document.documentElement.dataset.badgeTipsBound === '1') return;
  document.documentElement.dataset.badgeTipsBound = '1';

  document.addEventListener('click', (event) => {
    const badge = event.target.closest('.badge');
    if (badge) {
      showBadgeTip(badge);
      return;
    }
    hideBadgeTip();
  });

  document.addEventListener(
    'scroll',
    () => {
      hideBadgeTip();
    },
    true
  );

  window.addEventListener('resize', hideBadgeTip);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupBadgeTips);
} else {
  setupBadgeTips();
}

function renderBadgeRow(badges, extraClass = '') {
  const normalized = normalizeBadges(badges);
  const className = extraClass ? `badge-row ${extraClass}` : 'badge-row';
  return `<div class="${className}">${BADGE_TYPES.map((type) => renderBadge(type, normalized[type.id])).join('')}</div>`;
}

function defaultCosmetics() {
  return { frameTier: 0, badges: normalizeBadges({}) };
}
