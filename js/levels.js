/**
 * Cumulative XP to reach each level. Index 0 = level 1 (0 XP).
 * From the XP Thresholds sheet: Total XP on the level N row is the
 * amount needed to finish that level (reach N+1).
 */
const LEVEL_THRESHOLDS = [
  0, 200, 450, 750, 1050, 1350, 1650, 1950, 2250, 2550, 2850, 3150, 3450, 3750, 4050, 4350, 4650,
  4950, 5250, 5550, 5850,
];

const XP_TREES = ['teamwork', 'studying', 'collegeSuccess'];

const XP_TREE_LABELS = {
  teamwork: 'Teamwork',
  studying: 'Studying',
  collegeSuccess: 'College Success',
};

function xpForLevel(level) {
  const idx = Math.max(0, level - 1);
  return LEVEL_THRESHOLDS[idx] ?? LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
}

function levelFromXp(xp) {
  const amount = Number(xp) || 0;
  let level = 1;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (amount >= LEVEL_THRESHOLDS[i]) {
      level = i + 1;
      break;
    }
  }
  return level;
}

function questXpForTree(quest, tree) {
  const key = `xp${tree.charAt(0).toUpperCase()}${tree.slice(1)}`;
  return Number(quest?.[key]) || 0;
}

function snapshotXp(profile) {
  const xp = profile?.xp || emptyXp();
  const out = emptyXp();
  XP_TREES.forEach((tree) => {
    out[tree] = Number(xp[tree]) || 0;
  });
  return out;
}

function xpProgressInLevel(xp) {
  const level = levelFromXp(xp);
  const currentThreshold = xpForLevel(level);
  const nextThreshold =
    LEVEL_THRESHOLDS[level] ?? currentThreshold + (currentThreshold - xpForLevel(level - 1) || 100);
  const intoLevel = xp - currentThreshold;
  const span = Math.max(1, nextThreshold - currentThreshold);
  return { level, currentThreshold, nextThreshold, intoLevel, span, percent: Math.min(100, (intoLevel / span) * 100) };
}

function totalXp(profile) {
  const xp = profile.xp || {};
  return XP_TREES.reduce((sum, tree) => sum + (xp[tree] || 0), 0);
}

function emptyXp() {
  return { teamwork: 0, studying: 0, collegeSuccess: 0 };
}

const REWARD_CHEST_COUNT = 3;
const REWARD_OFFER_COUNT = 4;
const REWARD_RECENT_OFFER_LIMIT = 8;
const REWARD_RESPONSE_MAX_CHARS = 400;

function randomInt(maxExclusive) {
  const max = Math.max(0, Math.floor(Number(maxExclusive) || 0));
  if (max <= 1) return 0;
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const range = 0x100000000;
    const limit = range - (range % max);
    const buf = new Uint32Array(1);
    let value = 0;
    do {
      cryptoObj.getRandomValues(buf);
      value = buf[0];
    } while (value >= limit);
    return value % max;
  }
  return Math.floor(Math.random() * max);
}

function shuffleList(list) {
  const arr = (list || []).slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function normalizeRecentOfferedIds(ids) {
  return (Array.isArray(ids) ? ids : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .slice(-REWARD_RECENT_OFFER_LIMIT);
}

function countLevelUps(beforeXp, afterXp) {
  return XP_TREES.reduce((sum, tree) => {
    const from = levelFromXp(Number(beforeXp?.[tree]) || 0);
    const to = levelFromXp(Number(afterXp?.[tree]) || 0);
    return sum + Math.max(0, to - from);
  }, 0);
}

function lifetimeRewardKeysFromXp(xp) {
  const snap = snapshotXp({ xp });
  return XP_TREES.reduce((sum, tree) => sum + Math.max(0, levelFromXp(snap[tree]) - 1), 0);
}

function freshRewardChests(recentOfferedIds) {
  return {
    slots: Array(REWARD_CHEST_COUNT).fill('locked'),
    prizeIndex: randomInt(REWARD_CHEST_COUNT),
    pendingOffer: null,
    recentOfferedIds: normalizeRecentOfferedIds(recentOfferedIds),
  };
}

function normalizeRewardChests(chests) {
  const slots = Array.isArray(chests?.slots) ? chests.slots.slice(0, REWARD_CHEST_COUNT) : [];
  while (slots.length < REWARD_CHEST_COUNT) slots.push('locked');
  const validSlots = slots.map((slot) => (slot === 'empty' || slot === 'prize' ? slot : 'locked'));
  const prizeIndex = Number(chests?.prizeIndex);
  const hasValidPrize =
    Number.isInteger(prizeIndex) && prizeIndex >= 0 && prizeIndex < REWARD_CHEST_COUNT;
  const recentOfferedIds = normalizeRecentOfferedIds(chests?.recentOfferedIds);
  if (!hasValidPrize) return freshRewardChests(recentOfferedIds);
  return {
    slots: validSlots,
    prizeIndex,
    pendingOffer: chests?.pendingOffer || null,
    recentOfferedIds,
  };
}

function rewardProgressFromXp(profile, afterXp) {
  const chests = normalizeRewardChests(profile?.rewardChests);
  const currentKeys = Math.max(0, Number(profile?.rewardKeys) || 0);
  const earned = lifetimeRewardKeysFromXp(afterXp);
  const storedEarned = Number(profile?.rewardKeysEarned);
  const spentThisRound = chests.slots.filter((slot) => slot !== 'locked').length;
  const baseline = Number.isFinite(storedEarned) ? Math.max(0, storedEarned) : currentKeys + spentThisRound;
  const keysGained = Math.max(0, earned - baseline);
  return {
    rewardKeys: currentKeys + keysGained,
    rewardKeysEarned: Math.max(baseline, earned),
    rewardChests: chests,
    keysGained,
  };
}

const DEFAULT_CLASS_OPTIONS = [
  { id: 'math142', name: 'Math& 142 Precalc 2', rosterSize: 20 },
  { id: 'math151', name: 'Math& 151 Calc 1', rosterSize: 30 },
  { id: 'math238', name: 'Math 238 Differential Equations', rosterSize: 20 },
];

/** Live class list (seeded defaults, then replaced from Firestore). */
let CLASS_OPTIONS = DEFAULT_CLASS_OPTIONS.map((c) => ({ ...c }));

function normalizeClassRecord(id, data = {}) {
  const rosterRaw = Number(data.rosterSize);
  const rosterSize = Number.isFinite(rosterRaw) && rosterRaw > 0 ? Math.round(rosterRaw) : 20;
  const sortRaw = Number(data.sortOrder);
  return {
    id: String(id || data.id || '').trim(),
    name: String(data.name || id || 'Class').trim() || 'Class',
    rosterSize,
    sortOrder: Number.isFinite(sortRaw) ? sortRaw : 0,
  };
}

function setClassOptions(list) {
  const normalized = (list || [])
    .map((c) => normalizeClassRecord(c.id, c))
    .filter((c) => c.id)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  CLASS_OPTIONS = normalized.length ? normalized : DEFAULT_CLASS_OPTIONS.map((c) => ({ ...c }));
  return CLASS_OPTIONS;
}

function classLabel(classId) {
  return CLASS_OPTIONS.find((c) => c.id === classId)?.name || 'Unassigned';
}

function classRosterSize(classId) {
  const found = CLASS_OPTIONS.find((c) => c.id === classId);
  const size = Number(found?.rosterSize);
  return Number.isFinite(size) && size > 0 ? size : 20;
}

/** Total XP ÷ configured roster size (not signup count). */
function scaledClassXp(totalXp, classId) {
  const size = classRosterSize(classId);
  return Math.round((Number(totalXp) || 0) / size);
}

function fillClassSelect(selectEl, selectedId, includeBlank = true) {
  if (!selectEl) return;
  const blank = includeBlank ? `<option value="">Select your class</option>` : '';
  selectEl.innerHTML =
    blank +
    CLASS_OPTIONS.map((c) => {
      const selected = c.id === selectedId ? ' selected' : '';
      return `<option value="${c.id}"${selected}>${c.name}</option>`;
    }).join('');
}

function suggestClassId(name) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);
  return base || `class${Date.now().toString(36)}`;
}
