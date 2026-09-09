/* global firebase, db, XP_TREES, QUEST_CATALOG, RAID_CATALOG, QUEST_CATALOG_VERSION, TERM_WEEK1_START, TERM_WEEK_COUNT */

const QUEST_RESPONSE_MAX_CHARS = 400;
const DEFAULT_RAID_PARTICIPANTS = 10;

function parseLocalISODate(iso) {
  const [year, month, day] = String(iso || '')
    .split('-')
    .map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function currentTermWeek(now = new Date()) {
  const start = parseLocalISODate(typeof TERM_WEEK1_START === 'string' ? TERM_WEEK1_START : '2026-09-21');
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - start.getTime()) / 86400000);
  const maxWeek = typeof TERM_WEEK_COUNT === 'number' ? TERM_WEEK_COUNT : 11;
  if (diffDays < 0) return 1;
  return Math.min(maxWeek, Math.floor(diffDays / 7) + 1);
}

function isCatalogMetaQuest(quest) {
  return !quest || quest.id === '_catalogVersion' || quest.isCatalogMeta;
}

function isQuestScheduledThisWeek(quest, week = currentTermWeek()) {
  if (isCatalogMetaQuest(quest)) return false;
  if (quest.scheduleKind === 'every-week') return true;
  const weeks = quest.assignedWeeks;
  if (Array.isArray(weeks) && weeks.length) {
    return weeks.map(Number).includes(Number(week));
  }
  if (!quest.scheduleKind) return true;
  return false;
}

function questWeekDisplay(quest) {
  if (quest.scheduleKind === 'every-week') return 'Every week';
  const weeks = normalizeAssignedWeeks(quest.assignedWeeks);
  if (weeks.length === 1) return `Week ${weeks[0]}`;
  if (weeks.length) return `Weeks ${weeks.join(', ')}`;
  return quest.weekLabel || '—';
}

function normalizeAssignedWeeks(weeks) {
  const maxWeek = typeof TERM_WEEK_COUNT === 'number' ? TERM_WEEK_COUNT : 11;
  return [...new Set((weeks || []).map(Number).filter((n) => n >= 1 && n <= maxWeek))].sort((a, b) => a - b);
}

function weekLabelFromSchedule(scheduleKind, assignedWeeks) {
  if (scheduleKind === 'every-week') return 'Every week';
  if (assignedWeeks.length === 1) return `Week ${assignedWeeks[0]}`;
  if (assignedWeeks.length) return `Weeks ${assignedWeeks.join(', ')}`;
  return '';
}

async function getActiveQuests() {
  const week = currentTermWeek();
  const snap = await db.collection('quests').get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((q) => !isCatalogMetaQuest(q) && q.active !== false && isQuestScheduledThisWeek(q, week))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

async function getAllQuests() {
  const snap = await db.collection('quests').get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((q) => !isCatalogMetaQuest(q))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

async function getUserCompletions(userId) {
  try {
    const snap = await db.collection('completions').where('userId', '==', userId).get();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const aTime = a.completedAt?.toMillis?.() || 0;
        const bTime = b.completedAt?.toMillis?.() || 0;
        return bTime - aTime;
      });
  } catch (err) {
    console.error('Completions query failed, using profile fallback:', err);
    const profile = await getUserProfile(userId);
    const ids = profile?.completedQuestIds || [];
    return ids.map((questId) => ({ questId }));
  }
}

function questRequiredCount(quest) {
  return Math.max(1, Number(quest?.requiredCount) || 1);
}

function questXpAwardMap(quest) {
  const xpAward = emptyXp();
  XP_TREES.forEach((tree) => {
    xpAward[tree] = questXpForTree(quest, tree);
  });
  return xpAward;
}

function completionTimeMs(completion) {
  return completion?.completedAt?.toMillis?.() || 0;
}

function isAwardedCompletion(completion) {
  if (!completion) return false;
  if (completion.status === 'pending' || completion.status === 'progress') return false;
  return completion.status === 'awarded' || !completion.status;
}

function isPendingCompletion(completion) {
  return completion?.status === 'pending';
}

function isProgressCompletion(completion) {
  return completion?.status === 'progress';
}

function localDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function localWeekKey(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNum = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayNum + 3);
  const isoYear = d.getFullYear();
  const week1 = new Date(isoYear, 0, 4);
  const week1Day = (week1.getDay() + 6) % 7;
  week1.setDate(week1.getDate() - week1Day);
  const week = 1 + Math.round((d.getTime() - week1.getTime()) / 604800000);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

function dateFromIsoWeekKey(weekKey) {
  const match = String(weekKey || '').match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(year, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - jan4Day + (week - 1) * 7);
  return monday;
}

function shiftIsoWeekKey(weekKey, deltaWeeks) {
  const monday = dateFromIsoWeekKey(weekKey);
  if (!monday) return '';
  monday.setDate(monday.getDate() + Number(deltaWeeks || 0) * 7);
  return localWeekKey(monday);
}

function dayKeyFromCompletion(completion) {
  if (completion?.dayKey) return completion.dayKey;
  if (completion?.completedAt?.toDate) return localDayKey(completion.completedAt.toDate());
  return '';
}

function weekKeyFromCompletion(completion) {
  if (completion?.weekKey) return completion.weekKey;
  if (completion?.completedAt?.toDate) return localWeekKey(completion.completedAt.toDate());
  return '';
}

function completionsForQuest(completions, questId) {
  return (completions || []).filter((c) => c.questId === questId);
}

function cycleCompletions(completions, quest) {
  const list = completionsForQuest(completions, quest.id);
  if (quest.weekly) {
    const week = localWeekKey();
    return list.filter((c) => weekKeyFromCompletion(c) === week);
  }
  if (quest.oneTime) return list;
  const awardedTimes = list.filter(isAwardedCompletion).map(completionTimeMs);
  if (!awardedTimes.length) return list;
  const lastAward = Math.max(...awardedTimes);
  return list.filter((c) => completionTimeMs(c) > lastAward);
}

function cycleAwarded(completions, quest) {
  return cycleCompletions(completions, quest).some(isAwardedCompletion);
}

function cyclePendingCompletion(completions, quest) {
  return cycleCompletions(completions, quest).find(isPendingCompletion) || null;
}

function cycleLogCount(completions, quest) {
  return cycleCompletions(completions, quest).filter(
    (c) => isProgressCompletion(c) || isPendingCompletion(c) || isAwardedCompletion(c)
  ).length;
}

function loggedOnDay(completions, quest, dayKey) {
  return cycleCompletions(completions, quest).some((c) => dayKeyFromCompletion(c) === dayKey);
}

function hasCompletedQuest(completions, questId) {
  return completionsForQuest(completions, questId).some(isAwardedCompletion);
}

function isQuestAvailable(quest, completions) {
  if (quest.oneTime && hasCompletedQuest(completions, quest.id)) return false;
  if (quest.weekly && cycleAwarded(completions, quest)) return false;
  return true;
}

function completionStatusLabel(completion) {
  if (isPendingCompletion(completion)) return 'Pending';
  if (isProgressCompletion(completion)) {
    const n = completion.progressIndex || 1;
    const req = completion.requiredCount || 1;
    return `Logged ${n}/${req}`;
  }
  return 'Awarded';
}

function questFlagLabels(quest) {
  const flags = [];
  if (quest.oneTime) flags.push('One-time');
  else if (quest.weekly) flags.push('Weekly');
  else flags.push('Repeatable');
  if (quest.requiresText) flags.push('Text');
  if (quest.requiresValidation) flags.push('Review');
  const required = questRequiredCount(quest);
  if (required > 1) flags.push(`${required}×`);
  if (quest.requireUniqueDays) flags.push('Unique days');
  return flags.join(' · ');
}

function rewardFlagLabels(reward) {
  const flags = [];
  if (reward.automated) {
    if (reward.automatedType === 'upgradeFrame') flags.push('Frame upgrade');
    else if (reward.automatedType === 'addXpToClassmate') flags.push('Classmate XP');
    else flags.push('Automated');
  } else {
    flags.push('Instructor');
  }
  if (reward.requiresText) flags.push('Text');
  const pool = rewardPoolSize(reward);
  if (pool) flags.push(`Pool ${pool}`);
  const boostXp = Number(reward.automatedXp);
  if (reward.automatedType === 'addXpToClassmate' && boostXp) flags.push(`+${boostXp} XP`);
  return flags.join(' · ');
}

function applyXpAward(profile, xpAward) {
  const xp = { ...emptyXp(), ...snapshotXp(profile) };
  XP_TREES.forEach((tree) => {
    xp[tree] += Number(xpAward?.[tree]) || 0;
  });
  return xp;
}

function publicProfileXpPayload(profile, xp) {
  return {
    characterName: profile.characterName || '',
    classId: profile.classId || '',
    className: classLabel(profile.classId),
    xp,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
}

async function completeQuest(userId, quest, options = {}) {
  const profile = await getUserProfile(userId);
  if (!profile) {
    throw new Error('Your profile could not be loaded. Try signing in again.');
  }

  const userCompletions = await getUserCompletions(userId);
  const dayKey = localDayKey();
  const weekKey = localWeekKey();
  const required = questRequiredCount(quest);
  const responseText = String(options.responseText || '').trim();

  if (quest.requiresText) {
    if (!responseText) {
      throw new Error('Please write a short response for this quest.');
    }
    if (responseText.length > QUEST_RESPONSE_MAX_CHARS) {
      throw new Error(`Keep your answer to ${QUEST_RESPONSE_MAX_CHARS} characters or fewer.`);
    }
  }

  if (cyclePendingCompletion(userCompletions, quest)) {
    throw new Error('This quest is waiting for instructor approval.');
  }

  if (quest.oneTime && ((profile.completedQuestIds || []).includes(quest.id) || hasCompletedQuest(userCompletions, quest.id))) {
    throw new Error('You have already completed this one-time quest.');
  }

  if (quest.weekly && cycleAwarded(userCompletions, quest)) {
    throw new Error('You have already completed this quest this week.');
  }

  if (quest.requireUniqueDays && loggedOnDay(userCompletions, quest, dayKey)) {
    throw new Error('You already logged this quest today. Come back tomorrow.');
  }

  const logsSoFar = cycleLogCount(userCompletions, quest);
  if (logsSoFar >= required) {
    throw new Error('You have already finished this quest.');
  }

  const nextCount = logsSoFar + 1;
  const fulfills = nextCount >= required;
  const needsReview = Boolean(quest.requiresValidation) && fulfills;
  const awardsNow = fulfills && !needsReview;
  const status = needsReview ? 'pending' : awardsNow ? 'awarded' : 'progress';
  const xpAward = questXpAwardMap(quest);

  const completionData = {
    userId,
    questId: quest.id,
    questName: quest.name,
    completedAt: firebase.firestore.FieldValue.serverTimestamp(),
    status,
    dayKey,
    weekKey,
    progressIndex: nextCount,
    requiredCount: required,
    xpAward,
  };
  if (quest.requiresText) {
    completionData.responseText = responseText;
  }

  const userRef = db.collection('users').doc(userId);
  const batch = db.batch();

  let keysGained = 0;
  let badgeGained = [];
  if (awardsNow) {
    const xp = applyXpAward(profile, xpAward);
    const rewardFields = rewardProgressFromXp(profile, xp);
    keysGained = rewardFields.keysGained;
    batch.set(
      userRef,
      {
        xp,
        rewardKeys: rewardFields.rewardKeys,
        rewardKeysEarned: rewardFields.rewardKeysEarned,
        rewardChests: rewardFields.rewardChests,
        completedQuestIds: firebase.firestore.FieldValue.arrayUnion(quest.id),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    batch.set(db.collection('publicProfiles').doc(userId), publicProfileXpPayload(profile, xp), { merge: true });
  }

  batch.set(db.collection('completions').doc(), completionData);
  await batch.commit();

  if (awardsNow) {
    const badgeResult = await syncStudentBadges(userId);
    badgeGained = badgeResult.gained;
  }

  return {
    status,
    awarded: awardsNow,
    progressIndex: nextCount,
    requiredCount: required,
    keysGained,
    badgeGained,
  };
}

async function approveCompletion(completionId) {
  const ref = db.collection('completions').doc(completionId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error('That submission could not be found.');
  }

  const completion = { id: snap.id, ...snap.data() };
  if (completion.status !== 'pending') {
    throw new Error('This submission is not waiting for approval.');
  }

  const profile = await getUserProfile(completion.userId);
  if (!profile) {
    throw new Error('Student profile could not be loaded.');
  }

  const xpAward = completion.xpAward || emptyXp();
  const xp = applyXpAward(profile, xpAward);
  const rewardFields = rewardProgressFromXp(profile, xp);
  const batch = db.batch();
  batch.update(ref, {
    status: 'awarded',
    awardedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  batch.set(
    db.collection('users').doc(completion.userId),
    {
      xp,
      rewardKeys: rewardFields.rewardKeys,
      rewardKeysEarned: rewardFields.rewardKeysEarned,
      rewardChests: rewardFields.rewardChests,
      completedQuestIds: firebase.firestore.FieldValue.arrayUnion(completion.questId),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  batch.set(
    db.collection('publicProfiles').doc(completion.userId),
    publicProfileXpPayload(profile, xp),
    { merge: true }
  );
  await batch.commit();
  await syncStudentBadges(completion.userId);
}

async function getAllStudents() {
  const snap = await db.collection('users').where('role', '==', 'student').get();
  const students = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const withIdentity = typeof attachPrivateIdentities === 'function'
    ? await attachPrivateIdentities(students)
    : students;
  return withIdentity.sort((a, b) =>
    (a.realName || a.characterName || '').localeCompare(b.realName || b.characterName || '')
  );
}

async function saveQuest(questId, data) {
  const oneTime = Boolean(data.oneTime);
  const weekly = Boolean(data.weekly) && !oneTime;
  const everyWeek = Boolean(data.everyWeek);
  const assignedWeeks = everyWeek ? [] : normalizeAssignedWeeks(data.assignedWeeks);
  if (!everyWeek && !assignedWeeks.length) {
    throw new Error('Choose every week or at least one week this quest is available.');
  }
  const scheduleKind = everyWeek ? 'every-week' : weekly ? 'randomly-weekly' : 'week-specific';
  const payload = {
    name: data.name.trim(),
    description: (data.description || '').trim(),
    xpTeamwork: Number(data.xpTeamwork) || 0,
    xpStudying: Number(data.xpStudying) || 0,
    xpCollegeSuccess: Number(data.xpCollegeSuccess) || 0,
    active: Boolean(data.active),
    oneTime,
    weekly,
    scheduleKind,
    assignedWeeks,
    weekLabel: weekLabelFromSchedule(scheduleKind, assignedWeeks),
    requiresText: Boolean(data.requiresText),
    textPrompt: (data.textPrompt || '').trim(),
    requiresValidation: Boolean(data.requiresValidation),
    requiredCount: questRequiredCount(data),
    requireUniqueDays: Boolean(data.requireUniqueDays),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  if (questId) {
    await db.collection('quests').doc(questId).set(payload, { merge: true });
    return questId;
  }

  payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
  const ref = await db.collection('quests').add(payload);
  return ref.id;
}

async function setQuestActive(questId, active) {
  await db.collection('quests').doc(questId).set(
    {
      active: Boolean(active),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function saveStudentCosmetics(uid, { frameTier, badges } = {}) {
  const profile = await getUserProfile(uid);
  const nextFrame = frameTier !== undefined ? normalizeFrameTier(frameTier) : normalizeFrameTier(profile?.frameTier);
  const nextBadges = badges !== undefined ? normalizeBadges(badges) : normalizeBadges(profile?.badges);
  await db.collection('users').doc(uid).set(
    {
      frameTier: nextFrame,
      badges: nextBadges,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await syncPublicProfile(uid, {
    characterName: profile?.characterName,
    classId: profile?.classId,
    xp: profile?.xp,
    frameTier: nextFrame,
    badges: nextBadges,
  });
  return { frameTier: nextFrame, badges: nextBadges };
}

async function resetStudentCosmetics(uid) {
  return saveStudentCosmetics(uid, { frameTier: 0 });
}

function awardedCompletions(completions) {
  return (completions || []).filter(isAwardedCompletion);
}

function awardedQuestCount(completions) {
  return awardedCompletions(completions).length;
}

function awardedCountByWeek(completions) {
  const counts = {};
  awardedCompletions(completions).forEach((completion) => {
    const week = weekKeyFromCompletion(completion);
    if (!week) return;
    counts[week] = (counts[week] || 0) + 1;
  });
  return counts;
}

function currentQuestStreakWeeks(completions, now = new Date()) {
  const counts = awardedCountByWeek(completions);
  const thisWeek = localWeekKey(now);
  let cursor = (counts[thisWeek] || 0) >= 2 ? thisWeek : shiftIsoWeekKey(thisWeek, -1);
  let streak = 0;
  while (cursor && (counts[cursor] || 0) >= 2) {
    streak += 1;
    cursor = shiftIsoWeekKey(cursor, -1);
    if (streak > 60) break;
  }
  return streak;
}

function questsAvailableInWeek(quests, weekKey) {
  const monday = dateFromIsoWeekKey(weekKey);
  if (!monday) return [];
  const termWeek = currentTermWeek(monday);
  return (quests || []).filter(
    (quest) =>
      !isCatalogMetaQuest(quest) && quest.active !== false && isQuestScheduledThisWeek(quest, termWeek)
  );
}

function uniqueAwardedQuestIdsInWeek(completions, weekKey) {
  const ids = new Set();
  awardedCompletions(completions).forEach((completion) => {
    if (weekKeyFromCompletion(completion) === weekKey && completion.questId) {
      ids.add(completion.questId);
    }
  });
  return ids;
}

function completionistBadgeTier(completions, quests, now = new Date()) {
  const weeks = new Set([localWeekKey(now)]);
  awardedCompletions(completions).forEach((completion) => {
    const week = weekKeyFromCompletion(completion);
    if (week) weeks.add(week);
  });

  let best = null;
  weeks.forEach((weekKey) => {
    const available = questsAvailableInWeek(quests, weekKey);
    if (!available.length) return;
    const done = uniqueAwardedQuestIdsInWeek(completions, weekKey);
    const completed = available.filter((quest) => done.has(quest.id)).length;
    BADGE_THRESHOLDS.completionist.forEach((percent, index) => {
      const need =
        percent >= 100 ? available.length : Math.max(1, Math.round((available.length * percent) / 100));
      if (completed >= need) best = best === null ? index : Math.max(best, index);
    });
  });
  return normalizeBadgeTier(best);
}

function completedRaidParticipationCount(userId, participations, awards) {
  const awardedKeys = new Set();
  (awards || []).forEach((award) => {
    if (award.status === 'awarded' && award.raidId && award.classId) {
      awardedKeys.add(`${award.raidId}__${award.classId}`);
    }
  });
  const raidIds = new Set();
  (participations || []).forEach((part) => {
    if (part.userId !== userId || !part.raidId) return;
    if (awardedKeys.has(`${part.raidId}__${part.classId || ''}`)) {
      raidIds.add(part.raidId);
    }
  });
  return raidIds.size;
}

function computeStudentBadges({ uid, profile, completions, quests, participations, awards, now }) {
  const xp = snapshotXp(profile);
  const userId = uid || profile?.id;
  return normalizeBadges({
    streak: badgeTierFromThresholds(currentQuestStreakWeeks(completions, now), BADGE_THRESHOLDS.streak),
    quest: badgeTierFromThresholds(awardedQuestCount(completions), BADGE_THRESHOLDS.quest),
    teamwork: badgeTierFromThresholds(levelFromXp(xp.teamwork), BADGE_THRESHOLDS.teamwork),
    scholar: badgeTierFromThresholds(levelFromXp(xp.studying), BADGE_THRESHOLDS.scholar),
    campus: badgeTierFromThresholds(levelFromXp(xp.collegeSuccess), BADGE_THRESHOLDS.campus),
    raid: badgeTierFromThresholds(
      completedRaidParticipationCount(userId, participations, awards),
      BADGE_THRESHOLDS.raid
    ),
    completionist: completionistBadgeTier(completions, quests, now),
  });
}

async function syncStudentBadges(uid, extras = {}) {
  const [profile, completions, quests, participations, awards] = await Promise.all([
    extras.profile !== undefined ? Promise.resolve(extras.profile) : getUserProfile(uid),
    extras.completions !== undefined ? Promise.resolve(extras.completions) : getUserCompletions(uid),
    extras.quests !== undefined ? Promise.resolve(extras.quests) : getAllQuests(),
    extras.participations !== undefined ? Promise.resolve(extras.participations) : getRaidParticipations(),
    extras.awards !== undefined ? Promise.resolve(extras.awards) : getRaidAwards(),
  ]);
  if (!profile) {
    return { changed: false, badges: normalizeBadges({}), gained: [], profile: null };
  }

  const next = computeStudentBadges({
    uid,
    profile,
    completions,
    quests,
    participations,
    awards,
  });
  const previous = normalizeBadges(profile.badges);
  const gained = badgeGains(previous, next);
  if (badgesEqual(previous, next)) {
    return { changed: false, badges: next, gained, profile };
  }

  await saveStudentCosmetics(uid, { badges: next });
  const updated = await getUserProfile(uid);
  return { changed: true, badges: next, gained, profile: updated };
}

function sortCompletions(completions, limit = 100) {
  return [...completions]
    .sort((a, b) => {
      const pendingDelta = Number(isPendingCompletion(b)) - Number(isPendingCompletion(a));
      if (pendingDelta) return pendingDelta;
      const aTime = a.completedAt?.toMillis?.() || 0;
      const bTime = b.completedAt?.toMillis?.() || 0;
      return bTime - aTime;
    })
    .slice(0, limit);
}

async function getRecentCompletions(limit = 100) {
  const snap = await db.collection('completions').get();
  return sortCompletions(
    snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    limit
  );
}

function subscribeCompletions(callback, limit = 100) {
  return db.collection('completions').onSnapshot(
    (snap) => {
      callback(
        sortCompletions(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })),
          limit
        )
      );
    },
    (err) => console.error('Completions subscription error:', err)
  );
}

function subscribeStudents(callback) {
  return db.collection('publicProfiles').onSnapshot(
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error('Leaderboard subscription error:', err);
      const tbody = document.getElementById('leaderboard-body');
      if (tbody) {
        tbody.innerHTML = `<p class="empty-state">Could not load leaderboard: ${err.message}</p>`;
      }
    }
  );
}

async function commitBatches(ops, chunkSize = 400) {
  for (let i = 0; i < ops.length; i += chunkSize) {
    const batch = db.batch();
    ops.slice(i, i + chunkSize).forEach((apply) => apply(batch));
    await batch.commit();
  }
}

async function publishRosterToLeaderboard(students) {
  const rosterIds = new Set((students || []).map((s) => s.id));
  const publicSnap = await db.collection('publicProfiles').get();
  const ops = [];

  (students || []).forEach((s) => {
    ops.push((batch) => {
      batch.set(
        db.collection('publicProfiles').doc(s.id),
        {
          characterName: s.characterName || '',
          classId: s.classId || '',
          className: classLabel(s.classId),
          frameTier: normalizeFrameTier(s.frameTier),
          badges: normalizeBadges(s.badges),
          xp: s.xp || emptyXp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
  });

  // Remove leaderboard rows for students no longer on the roster (including after deletes).
  publicSnap.docs.forEach((doc) => {
    if (!rosterIds.has(doc.id)) {
      ops.push((batch) => batch.delete(doc.ref));
    }
  });

  if (!ops.length) return;
  await commitBatches(ops);
}

async function updateStudentByInstructor(studentId, { characterName, classId, xp, rewardKeys }) {
  const profile = await getUserProfile(studentId);
  const xpMap = {
    teamwork: Math.max(0, Number(xp.teamwork) || 0),
    studying: Math.max(0, Number(xp.studying) || 0),
    collegeSuccess: Math.max(0, Number(xp.collegeSuccess) || 0),
  };
  const name = (characterName || '').trim();
  const rewardFields = rewardProgressFromXp(profile || {}, xpMap);
  const previousKeys = Math.max(0, Number(profile?.rewardKeys) || 0);
  const typedKeys = Math.max(0, Math.floor(Number(rewardKeys)));
  const keysUnchanged = !Number.isFinite(Number(rewardKeys)) || typedKeys === previousKeys;
  await db.collection('users').doc(studentId).set(
    {
      characterName: name,
      classId: classId || '',
      className: classLabel(classId),
      xp: xpMap,
      rewardKeys: keysUnchanged ? rewardFields.rewardKeys : typedKeys,
      rewardKeysEarned: rewardFields.rewardKeysEarned,
      rewardChests: rewardFields.rewardChests,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await syncPublicProfile(studentId, {
    characterName: name,
    classId,
    xp: xpMap,
  });
  await syncStudentBadges(studentId);
}

function subscribeRoster(callback) {
  return db
    .collection('users')
    .where('role', '==', 'student')
    .onSnapshot(
      async (snap) => {
        try {
          const students = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const withIdentity = typeof attachPrivateIdentities === 'function'
            ? await attachPrivateIdentities(students)
            : students;
          withIdentity.sort((a, b) =>
            (a.realName || a.characterName || '').localeCompare(b.realName || b.characterName || '')
          );
          callback(withIdentity);
        } catch (err) {
          console.error('Roster identity merge error:', err);
          callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        }
      },
      (err) => console.error('Roster subscription error:', err)
    );
}

const TEST_STUDENTS_BY_CLASS = {
  math142: [
    { realName: 'Test Aria', characterName: 'Sigma Seeker' },
    { realName: 'Test Blake', characterName: 'Calc Crusader' },
    { realName: 'Test Casey', characterName: 'Pi Pilot' },
    { realName: 'Test Drew', characterName: 'Tangent Tiger' },
    { realName: 'Test Ellis', characterName: 'Radical Raven' },
  ],
  math151: [
    { realName: 'Test Finn', characterName: 'Limit Lynx' },
    { realName: 'Test Gray', characterName: 'Derivative Drake' },
    { realName: 'Test Harper', characterName: 'Integral Ibis' },
    { realName: 'Test Jordan', characterName: 'Chain Rule Fox' },
    { realName: 'Test Kelly', characterName: 'Slope Sparrow' },
  ],
  math238: [
    { realName: 'Test Logan', characterName: 'DiffEQ Dolphin' },
    { realName: 'Test Morgan', characterName: 'Phase Phoenix' },
    { realName: 'Test Noel', characterName: 'Eigen Eagle' },
    { realName: 'Test Parker', characterName: 'Laplace Lion' },
    { realName: 'Test Quinn', characterName: 'Vector Viper' },
  ],
};

function sampleSeedBadges() {
  return normalizeBadges({});
}

async function seedTestStudents() {
  const batch = db.batch();
  let count = 0;

  CLASS_OPTIONS.forEach((cls, classIndex) => {
    const specs = TEST_STUDENTS_BY_CLASS[cls.id];
    specs.forEach((spec, index) => {
      const slot = index + 1;
      const id = `test-${cls.id}-${String(slot).padStart(2, '0')}`;
      const xp = {
        teamwork: 40 * slot,
        studying: 25 * slot,
        collegeSuccess: 35 * slot,
      };
      const frameTier = (classIndex * 2 + index) % 10;
      const badges = sampleSeedBadges(classIndex, index);
      const userData = {
        characterName: spec.characterName,
        role: 'student',
        classId: cls.id,
        className: cls.name,
        xp,
        frameTier,
        badges,
        rewardKeys: 0,
        rewardKeysEarned: lifetimeRewardKeysFromXp(xp),
        rewardChests: freshRewardChests(),
        isTestStudent: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      batch.set(db.collection('users').doc(id), userData, { merge: true });
      batch.set(
        db.collection('privateProfiles').doc(id),
        {
          realName: spec.realName,
          email: `test+${cls.id}${slot}@example.test`,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      batch.set(
        db.collection('publicProfiles').doc(id),
        {
          characterName: spec.characterName,
          classId: cls.id,
          className: cls.name,
          frameTier,
          badges,
          xp,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      count++;
    });
  });

  await batch.commit();
  return count;
}

const TEST_QUESTS = [
  {
    id: 'test-quest-instructions',
    name: 'TEST: Read the instructions',
    description:
      'Instructions appear under the quest name. Read this paragraph, then tap Complete. This is a one-time honor-system quest.',
    xpTeamwork: 0,
    xpStudying: 5,
    xpCollegeSuccess: 0,
    active: true,
    oneTime: true,
    weekly: false,
    weekLabel: '',
    requiresText: false,
    textPrompt: '',
    requiresValidation: false,
    requiredCount: 1,
    requireUniqueDays: false,
  },
  {
    id: 'test-quest-weekly',
    name: 'TEST: Weekly check-in',
    description:
      'Complete this once per week. After you finish, it should disappear until next Monday, then come back.',
    xpTeamwork: 0,
    xpStudying: 0,
    xpCollegeSuccess: 10,
    active: true,
    oneTime: false,
    weekly: true,
    weekLabel: '',
    requiresText: false,
    textPrompt: '',
    requiresValidation: false,
    requiredCount: 1,
    requireUniqueDays: false,
  },
  {
    id: 'test-quest-text',
    name: 'TEST: Short written answer',
    description:
      'Type a few sentences in the box (400 character max), then submit. Your answer should show on the instructor Recent completions table.',
    xpTeamwork: 10,
    xpStudying: 0,
    xpCollegeSuccess: 0,
    active: true,
    oneTime: false,
    weekly: false,
    weekLabel: '',
    requiresText: true,
    textPrompt: 'What is one study habit that worked for you this week?',
    requiresValidation: false,
    requiredCount: 1,
    requireUniqueDays: false,
  },
  {
    id: 'test-quest-review',
    name: 'TEST: Instructor approval',
    description:
      'Tap Complete. This dashboard should show Pending and you should not get XP until the instructor taps Approve on Recent completions.',
    xpTeamwork: 0,
    xpStudying: 15,
    xpCollegeSuccess: 0,
    active: true,
    oneTime: false,
    weekly: false,
    weekLabel: '',
    requiresText: false,
    textPrompt: '',
    requiresValidation: true,
    requiredCount: 1,
    requireUniqueDays: false,
  },
  {
    id: 'test-quest-streak',
    name: 'TEST: Two-day streak',
    description:
      'Log twice on two different days. No XP until both days are logged. A second tap today should be blocked. Production math streak will use 5 days; this test uses 2 so you can verify sooner.',
    xpTeamwork: 0,
    xpStudying: 25,
    xpCollegeSuccess: 0,
    active: true,
    oneTime: false,
    weekly: false,
    weekLabel: '',
    requiresText: false,
    textPrompt: '',
    requiresValidation: false,
    requiredCount: 2,
    requireUniqueDays: true,
  },
];

function testQuestPayload(spec) {
  const payload = { ...spec };
  delete payload.id;
  return {
    ...payload,
    isTestQuest: true,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
}

async function seedTestQuests() {
  let created = 0;
  const batch = db.batch();

  for (const spec of TEST_QUESTS) {
    const ref = db.collection('quests').doc(spec.id);
    const snap = await ref.get();
    if (snap.exists) continue;
    const payload = testQuestPayload(spec);
    payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    batch.set(ref, payload);
    created++;
  }

  if (created) await batch.commit();
  return created;
}

async function deleteAllDocsInCollection(collectionName) {
  const snap = await db.collection(collectionName).get();
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    docs.slice(i, i + 400).forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
  }
  return docs.length;
}

function catalogItemPayload(spec) {
  const payload = { ...spec };
  delete payload.id;
  payload.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
  payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
  return payload;
}

async function writeCatalogDocs(collectionName, specs) {
  for (let i = 0; i < specs.length; i += 400) {
    const chunk = specs.slice(i, i + 400);
    const batch = db.batch();
    chunk.forEach((spec) => {
      batch.set(db.collection(collectionName).doc(spec.id), catalogItemPayload(spec));
    });
    await batch.commit();
  }
}

async function getQuestCatalogVersion() {
  const snap = await db.collection('quests').doc('_catalogVersion').get();
  return snap.exists ? snap.data().version : null;
}

async function replaceQuestCatalog({ force = false } = {}) {
  if (!force) {
    const current = await getQuestCatalogVersion();
    if (current === QUEST_CATALOG_VERSION) {
      return { skipped: true, quests: QUEST_CATALOG.length, raids: RAID_CATALOG.length };
    }
  }

  const deletedQuests = await deleteAllDocsInCollection('quests');
  const deletedRaids = await deleteAllDocsInCollection('raids');
  await writeCatalogDocs('quests', QUEST_CATALOG);
  await writeCatalogDocs('raids', RAID_CATALOG);
  await db.collection('quests').doc('_catalogVersion').set({
    version: QUEST_CATALOG_VERSION,
    isCatalogMeta: true,
    week1Start: TERM_WEEK1_START,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });

  return {
    skipped: false,
    quests: QUEST_CATALOG.length,
    raids: RAID_CATALOG.length,
    deletedQuests,
    deletedRaids,
  };
}

async function deleteStudentByInstructor(studentId) {
  const id = String(studentId || '').trim();
  if (!id) throw new Error('Missing student id.');

  const [
    completionsSnap,
    participationsSnap,
    redemptionsSnap,
  ] = await Promise.all([
    db.collection('completions').where('userId', '==', id).get(),
    db.collection('raidParticipations').where('userId', '==', id).get(),
    db.collection('redemptions').where('userId', '==', id).get(),
  ]);

  const ops = [];
  ops.push((batch) => batch.delete(db.collection('users').doc(id)));
  ops.push((batch) => batch.delete(db.collection('publicProfiles').doc(id)));
  ops.push((batch) => batch.delete(db.collection('privateProfiles').doc(id)));
  completionsSnap.docs.forEach((doc) => ops.push((batch) => batch.delete(doc.ref)));
  participationsSnap.docs.forEach((doc) => ops.push((batch) => batch.delete(doc.ref)));
  redemptionsSnap.docs.forEach((doc) => ops.push((batch) => batch.delete(doc.ref)));

  await commitBatches(ops);
}

function subscribeQuests(onChange) {
  let skipFirst = true;
  return db.collection('quests').onSnapshot(
    () => {
      if (skipFirst) {
        skipFirst = false;
        return;
      }
      onChange();
    },
    (err) => console.error('Quest subscription error:', err)
  );
}

function raidRequiredParticipants(raid) {
  const n = Number(raid?.requiredParticipants);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return DEFAULT_RAID_PARTICIPANTS;
}

function raidParticipationId(raidId, userId) {
  return `${raidId}_${userId}`;
}

function raidAwardId(raidId, classId) {
  return `${raidId}_${classId}`;
}

function uniqueRaidParticipantIds(participations, raidId, classId) {
  const ids = new Set();
  (participations || []).forEach((p) => {
    if (p.raidId === raidId && p.classId === classId && p.userId) ids.add(p.userId);
  });
  return [...ids];
}

function uniqueRaidParticipantCount(participations, raidId, classId) {
  return uniqueRaidParticipantIds(participations, raidId, classId).length;
}

function raidAwardForClass(awards, raidId, classId) {
  return (awards || []).find((a) => a.raidId === raidId && a.classId === classId && a.status !== 'rejected') || null;
}

function raidParticipantsForClass(participations, raidId, classId) {
  const byUser = new Map();
  (participations || []).forEach((p) => {
    if (p.raidId !== raidId || p.classId !== classId || !p.userId) return;
    if (!byUser.has(p.userId)) byUser.set(p.userId, p);
  });
  return [...byUser.values()].sort((a, b) =>
    (a.realName || a.characterName || '').localeCompare(b.realName || b.characterName || '')
  );
}

async function getActiveRaids() {
  const snap = await db.collection('raids').get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.active !== false)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

async function getAllRaids() {
  const snap = await db.collection('raids').get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

async function getRaidParticipations() {
  const snap = await db.collection('raidParticipations').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function getRaidAwards() {
  const snap = await db.collection('raidAwards').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function saveRaid(raidId, data) {
  const payload = {
    name: data.name.trim(),
    description: (data.description || '').trim(),
    xpTeamwork: Number(data.xpTeamwork) || 0,
    xpStudying: Number(data.xpStudying) || 0,
    xpCollegeSuccess: Number(data.xpCollegeSuccess) || 0,
    active: Boolean(data.active),
    requiredParticipants: raidRequiredParticipants(data),
    requiresValidation: true,
    weekLabel: (data.weekLabel || '').trim(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  if (raidId) {
    await db.collection('raids').doc(raidId).set(payload, { merge: true });
    return raidId;
  }

  payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
  const ref = await db.collection('raids').add(payload);
  return ref.id;
}

async function setRaidActive(raidId, active) {
  await db.collection('raids').doc(raidId).set(
    {
      active: Boolean(active),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function joinRaid(userId, raid, profile) {
  if (!profile?.classId) {
    throw new Error('Choose your class before joining a raid.');
  }
  if (raid.active === false) {
    throw new Error('This raid is not active.');
  }

  const awards = await getRaidAwards();
  if (raidAwardForClass(awards, raid.id, profile.classId)) {
    throw new Error('Your class already completed this raid.');
  }

  const ref = db.collection('raidParticipations').doc(raidParticipationId(raid.id, userId));
  const existing = await ref.get();
  if (existing.exists) {
    throw new Error('You already joined this raid.');
  }

  await ref.set({
    raidId: raid.id,
    raidName: raid.name,
    userId,
    classId: profile.classId,
    characterName: profile.characterName || '',
    joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

async function joinRaidForTestStudents(raidId, classId) {
  const raidSnap = await db.collection('raids').doc(raidId).get();
  if (!raidSnap.exists) {
    throw new Error('Raid not found.');
  }
  const raid = { id: raidSnap.id, ...raidSnap.data() };
  if (raidAwardForClass(await getRaidAwards(), raidId, classId)) {
    throw new Error('This class already completed this raid.');
  }

  const students = await getAllStudents();
  const testers = students.filter((s) => s.classId === classId && s.isTestStudent);
  if (!testers.length) {
    throw new Error('No test students in this class. Add test students first.');
  }

  const batch = db.batch();
  let added = 0;
  testers.forEach((student) => {
    const ref = db.collection('raidParticipations').doc(raidParticipationId(raidId, student.id));
    batch.set(
      ref,
      {
        raidId,
        raidName: raid.name,
        userId: student.id,
        classId,
        characterName: student.characterName || '',
        isTestStudent: true,
        joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    added++;
  });
  await batch.commit();
  return added;
}

async function approveRaidForClass(raidId, classId) {
  const raidSnap = await db.collection('raids').doc(raidId).get();
  if (!raidSnap.exists) {
    throw new Error('Raid not found.');
  }
  const raid = { id: raidSnap.id, ...raidSnap.data() };
  const required = raidRequiredParticipants(raid);
  const awardRef = db.collection('raidAwards').doc(raidAwardId(raidId, classId));
  const awardSnap = await awardRef.get();
  if (awardSnap.exists) {
    throw new Error('This class already received XP for this raid.');
  }

  const [participations, students] = await Promise.all([getRaidParticipations(), getAllStudents()]);
  const participantCount = uniqueRaidParticipantCount(participations, raidId, classId);
  if (participantCount < required) {
    throw new Error(`Need ${required} students from this class to join first (${participantCount} so far).`);
  }

  const classStudents = students.filter((s) => s.classId === classId);
  if (!classStudents.length) {
    throw new Error('No students found in this class.');
  }

  const xpAward = questXpAwardMap(raid);
  const awardPayload = {
    raidId,
    raidName: raid.name,
    classId,
    className: classLabel(classId),
    status: 'awarded',
    participantCount,
    studentCount: classStudents.length,
    xpAward,
    awardedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  const CHUNK = 150;
  for (let i = 0; i < classStudents.length; i += CHUNK) {
    const chunk = classStudents.slice(i, i + CHUNK);
    const isLast = i + CHUNK >= classStudents.length;
    const batch = db.batch();
    chunk.forEach((student) => {
      const xp = applyXpAward(student, xpAward);
      const rewardFields = rewardProgressFromXp(student, xp);
      batch.set(
        db.collection('users').doc(student.id),
        {
          xp,
          rewardKeys: rewardFields.rewardKeys,
          rewardKeysEarned: rewardFields.rewardKeysEarned,
          rewardChests: rewardFields.rewardChests,
          completedRaidIds: firebase.firestore.FieldValue.arrayUnion(raidId),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      batch.set(
        db.collection('publicProfiles').doc(student.id),
        publicProfileXpPayload(student, xp),
        { merge: true }
      );
    });
    if (isLast) batch.set(awardRef, awardPayload);
    await batch.commit();
  }

  const [quests, parts, awards] = await Promise.all([getAllQuests(), getRaidParticipations(), getRaidAwards()]);
  await Promise.all(
    classStudents.map((student) =>
      syncStudentBadges(student.id, { quests, participations: parts, awards })
    )
  );

  return { studentCount: classStudents.length, participantCount };
}

function subscribeCollectionChanges(collectionName, onChange, errorLabel) {
  let skipFirst = true;
  return db.collection(collectionName).onSnapshot(
    () => {
      if (skipFirst) {
        skipFirst = false;
        return;
      }
      onChange();
    },
    (err) => console.error(errorLabel, err)
  );
}

function subscribeRaids(onChange) {
  return subscribeCollectionChanges('raids', onChange, 'Raid subscription error:');
}

function subscribeRaidParticipations(onChange) {
  return subscribeCollectionChanges('raidParticipations', onChange, 'Raid participation subscription error:');
}

function subscribeRaidAwards(onChange) {
  return subscribeCollectionChanges('raidAwards', onChange, 'Raid award subscription error:');
}

const TEST_RAIDS = [
  {
    id: 'test-raid-class-effort',
    name: 'TEST: Class raid',
    description:
      'Join this raid (honor system). When 2 students in your class have joined, your instructor can approve it. XP goes to everyone in the class, not only people who joined. New raids default to 10 joiners.',
    xpTeamwork: 20,
    xpStudying: 0,
    xpCollegeSuccess: 10,
    active: true,
    requiredParticipants: 2,
    requiresValidation: true,
    weekLabel: '',
  },
];

function testRaidPayload(spec) {
  const payload = { ...spec };
  delete payload.id;
  return {
    ...payload,
    isTestRaid: true,
    requiresValidation: true,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
}

async function seedTestRaids() {
  let created = 0;
  const batch = db.batch();

  for (const spec of TEST_RAIDS) {
    const ref = db.collection('raids').doc(spec.id);
    const snap = await ref.get();
    if (snap.exists) continue;
    const payload = testRaidPayload(spec);
    payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    batch.set(ref, payload);
    created++;
  }

  if (created) await batch.commit();
  return created;
}

const REWARD_CATALOG = [
  {
    id: 'quiz-point',
    name: '1 point on quiz (all) — repeatable goal',
    description: 'One extra point on a quiz, applied to everyone.',
    requiresText: false,
    textPrompt: '',
    automated: false,
    automatedType: '',
    poolSize: 0,
    automatedXp: 0,
  },
  {
    id: 'jason-tie',
    name: 'Jason wears a tie to class',
    description: 'Jason wears a tie to a class meeting.',
    requiresText: false,
    textPrompt: '',
    automated: false,
    automatedType: '',
    poolSize: 0,
    automatedXp: 0,
  },
  {
    id: 'cat-pic-videos',
    name: 'Add a cat pic to videos page',
    description: 'A cat picture gets added to the videos page.',
    requiresText: false,
    textPrompt: '',
    automated: false,
    automatedType: '',
    poolSize: 0,
    automatedXp: 0,
  },
  {
    id: 'announcement-accent',
    name: 'Next announcement has an accent',
    description: 'The next class announcement is written in an accent.',
    requiresText: false,
    textPrompt: '',
    automated: false,
    automatedType: '',
    poolSize: 0,
    automatedXp: 0,
  },
  {
    id: 'extra-dropped-hw',
    name: 'Extra dropped HW score',
    description: 'An extra homework score is dropped. Needs 5 redemptions before Jason fulfills it.',
    requiresText: false,
    textPrompt: '',
    automated: false,
    automatedType: '',
    poolSize: 5,
    automatedXp: 0,
  },
  {
    id: 'solutions-video',
    name: 'Solutions video for a problem of your choice',
    description: 'Jason records a solutions video for one problem you pick.',
    requiresText: true,
    textPrompt: 'Which problem and section would you like?',
    automated: false,
    automatedType: '',
    poolSize: 0,
    automatedXp: 0,
  },
  {
    id: 'upgrade-profile-frame',
    name: 'Upgrade profile frame',
    description: 'Your profile frame upgrades one tier. Applied immediately.',
    requiresText: false,
    textPrompt: '',
    automated: true,
    automatedType: 'upgradeFrame',
    poolSize: 0,
    automatedXp: 0,
  },
  {
    id: 'honorific-for-class',
    name: 'Jason refers to you as “wise one” (or similar) for one class',
    description: 'Jason uses your chosen honorific for one class meeting.',
    requiresText: true,
    textPrompt: 'What honorific would you prefer?',
    automated: false,
    automatedType: '',
    poolSize: 0,
    automatedXp: 0,
  },
  {
    id: 'classmate-xp-boost',
    name: 'Add 150 experience to a classmate (random tree)',
    description: 'Give +150 XP to a classmate in a random tree. Applied immediately.',
    requiresText: false,
    textPrompt: 'Which classmate?',
    automated: true,
    automatedType: 'addXpToClassmate',
    poolSize: 0,
    automatedXp: 150,
  },
  {
    id: 'application-theme',
    name: 'Choose a theme for the next application problem',
    description: 'The next application problem uses a theme you choose.',
    requiresText: true,
    textPrompt: 'What theme would you prefer?',
    automated: false,
    automatedType: '',
    poolSize: 0,
    automatedXp: 0,
  },
  {
    id: 'in-application-problem',
    name: 'You’re in the next application problem',
    description: 'You appear in the next application problem.',
    requiresText: false,
    textPrompt: '',
    automated: false,
    automatedType: '',
    poolSize: 0,
    automatedXp: 0,
  },
  {
    id: 'word-in-class',
    name: 'Choose a word for Jason to try to naturally use in class',
    description: 'Jason tries to use your word naturally in class.',
    requiresText: true,
    textPrompt: 'What word should he use?',
    automated: false,
    automatedType: '',
    poolSize: 0,
    automatedXp: 0,
  },
  {
    id: 'canvas-course-image',
    name: 'Add an image to the side of our course picture in Canvas',
    description: 'An image is added beside the Canvas course picture.',
    requiresText: true,
    textPrompt: 'What kind of image?',
    automated: false,
    automatedType: '',
    poolSize: 0,
    automatedXp: 0,
  },
  {
    id: 'custom-variable',
    name: 'Choose a variable to be used instead of x',
    description: 'Class uses your variable (picture, word, letter, or symbol) instead of x.',
    requiresText: true,
    textPrompt: 'What variable?',
    automated: false,
    automatedType: '',
    poolSize: 0,
    automatedXp: 0,
  },
  {
    id: 'class-quiz-hint',
    name: 'Unlock a hint for the next quiz for the whole class',
    description: 'The whole class gets a hint on the next quiz. Needs 3 redemptions before Jason fulfills it.',
    requiresText: false,
    textPrompt: '',
    automated: false,
    automatedType: '',
    poolSize: 3,
    automatedXp: 0,
  },
  {
    id: 'jason-exercise-now',
    name: 'Jason has to do pushups (or something) right now',
    description: 'When Jason reads this, he does the exercise you choose.',
    requiresText: true,
    textPrompt: 'What exercise should he do?',
    automated: false,
    automatedType: '',
    poolSize: 0,
    automatedXp: 0,
  },
  {
    id: 'request-fun-award',
    name: 'Request a “fun” award (with approval)',
    description: 'Pitch a fun award. Jason decides whether to approve it.',
    requiresText: true,
    textPrompt: 'What’s your idea? Type it here or talk to him in person.',
    automated: false,
    automatedType: '',
    poolSize: 0,
    automatedXp: 0,
  },
  {
    id: 'extra-student-hour',
    name: 'Extra student hour this week',
    description: 'Jason adds an extra student hour this week.',
    requiresText: true,
    textPrompt: 'Any date/time preferences?',
    automated: false,
    automatedType: '',
    poolSize: 0,
    automatedXp: 0,
  },
  {
    id: 'jason-youre-awesome',
    name: 'Jason tells you that you’re awesome',
    description: 'Jason tells you that you’re awesome.',
    requiresText: false,
    textPrompt: '',
    automated: false,
    automatedType: '',
    poolSize: 0,
    automatedXp: 0,
  },
];

const RETIRED_TEST_REWARD_IDS = [
  'test-reward-solutions-video',
  'test-reward-homework-extension',
  'test-reward-office-hours',
  'test-reward-classmate-boost',
  'test-reward-quiz-retake',
];

function rewardPoolSize(reward) {
  const n = Number(reward?.poolSize);
  if (!Number.isFinite(n) || n <= 1) return 0;
  return Math.floor(n);
}

function rewardCatalogPayload(spec) {
  const payload = { ...spec };
  delete payload.id;
  return {
    ...payload,
    isTestReward: false,
    active: true,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
}

async function seedRewards() {
  const batch = db.batch();
  let upserted = 0;

  REWARD_CATALOG.forEach((spec) => {
    const payload = rewardCatalogPayload(spec);
    payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    batch.set(db.collection('rewards').doc(spec.id), payload, { merge: true });
    upserted++;
  });

  let deactivated = 0;
  RETIRED_TEST_REWARD_IDS.forEach((id) => {
    batch.set(
      db.collection('rewards').doc(id),
      {
        active: false,
        isTestReward: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    deactivated++;
  });

  await batch.commit();
  return { upserted, deactivated };
}

async function seedTestRewards() {
  return seedRewards();
}

function pickRandomRewards(rewards, count = REWARD_OFFER_COUNT, excludeIds = []) {
  const need = Math.max(0, Number(count) || 0);
  const active = (rewards || []).filter((r) => r && r.id && r.active !== false);
  if (!need || active.length <= need) return shuffleList(active);

  const exclude = new Set(normalizeRecentOfferedIds(excludeIds));
  let pool = active.filter((r) => !exclude.has(r.id));
  if (pool.length < need) pool = active;
  return shuffleList(pool).slice(0, need);
}

function rewardAutomatedXp(reward) {
  if (reward?.automatedType === 'addXpToClassmate') {
    const amount = Number(reward.automatedXp) > 0 ? Number(reward.automatedXp) : 150;
    const tree = XP_TREES[randomInt(XP_TREES.length)];
    const xpAward = emptyXp();
    xpAward[tree] = amount;
    return xpAward;
  }
  return {
    teamwork: Number(reward?.automatedXpTeamwork) || 0,
    studying: Number(reward?.automatedXpStudying) || 0,
    collegeSuccess: Number(reward?.automatedXpCollegeSuccess) || 0,
  };
}

async function getActiveRewards() {
  const snap = await db.collection('rewards').get();
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .filter((r) => r.active !== false && r.isTestReward !== true);
}

async function getAllRewards() {
  const snap = await db.collection('rewards').get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.isTestReward !== true)
    .sort((a, b) => {
      const activeDelta = Number(b.active !== false) - Number(a.active !== false);
      if (activeDelta) return activeDelta;
      return (a.name || '').localeCompare(b.name || '');
    });
}

async function saveReward(rewardId, data) {
  const automatedType = String(data.automatedType || '').trim();
  const automated = Boolean(data.automated) || Boolean(automatedType);
  const payload = {
    name: String(data.name || '').trim(),
    description: String(data.description || '').trim(),
    requiresText: Boolean(data.requiresText),
    textPrompt: String(data.textPrompt || '').trim(),
    automated,
    automatedType: automated ? automatedType : '',
    poolSize: automated ? 0 : rewardPoolSize({ poolSize: data.poolSize }),
    automatedXp: automatedType === 'addXpToClassmate' ? Math.max(0, Number(data.automatedXp) || 150) : 0,
    active: Boolean(data.active),
    isTestReward: false,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  if (!payload.name) {
    throw new Error('Give the reward a name.');
  }

  if (rewardId) {
    await db.collection('rewards').doc(rewardId).set(payload, { merge: true });
    return rewardId;
  }

  payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
  const ref = await db.collection('rewards').add(payload);
  return ref.id;
}

async function setRewardActive(rewardId, active) {
  await db.collection('rewards').doc(rewardId).set(
    {
      active: Boolean(active),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function getRewardsByIds(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return [];
  const snaps = await Promise.all(unique.map((id) => db.collection('rewards').doc(id).get()));
  return snaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }));
}

async function ensureStudentRewardState(userId) {
  const profile = await getUserProfile(userId);
  if (!profile) return null;
  const afterXp = snapshotXp(profile);
  const rewardFields = rewardProgressFromXp(profile, afterXp);
  const hasKeys = Number.isFinite(Number(profile.rewardKeys));
  const hasChests = Boolean(profile.rewardChests && Array.isArray(profile.rewardChests.slots));
  const hasEarned = Number.isFinite(Number(profile.rewardKeysEarned));
  if (hasKeys && hasChests && hasEarned && rewardFields.keysGained === 0) {
    return {
      ...profile,
      rewardKeys: rewardFields.rewardKeys,
      rewardKeysEarned: rewardFields.rewardKeysEarned,
      rewardChests: rewardFields.rewardChests,
    };
  }
  await db.collection('users').doc(userId).set(
    {
      rewardKeys: rewardFields.rewardKeys,
      rewardKeysEarned: rewardFields.rewardKeysEarned,
      rewardChests: rewardFields.rewardChests,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return getUserProfile(userId);
}

async function getClassmatePublicProfiles(classId, excludeUserId) {
  if (!classId) return [];
  const snap = await db.collection('publicProfiles').where('classId', '==', classId).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => p.id !== excludeUserId)
    .sort((a, b) => (a.characterName || '').localeCompare(b.characterName || ''));
}

async function openRewardChest(userId, chestIndex) {
  const index = Number(chestIndex);
  if (!Number.isInteger(index) || index < 0 || index >= REWARD_CHEST_COUNT) {
    throw new Error('That chest could not be found.');
  }

  const catalog = await getActiveRewards();
  const userRef = db.collection('users').doc(userId);
  let outcome = 'empty';
  let pendingOffer = null;
  let rewardKeys = 0;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) {
      throw new Error('Your profile could not be loaded. Try signing in again.');
    }
    const profile = { id: snap.id, ...snap.data() };
    const chests = normalizeRewardChests(profile.rewardChests);
    if (chests.pendingOffer) {
      throw new Error('Choose your reward before opening another chest.');
    }
    const keys = Math.max(0, Number(profile.rewardKeys) || 0);
    if (keys < 1) {
      throw new Error('You need a key from a level-up to open a chest.');
    }
    if (chests.slots[index] !== 'locked') {
      throw new Error('That chest is already open.');
    }

    const foundPrize = index === chests.prizeIndex;
    chests.slots[index] = foundPrize ? 'prize' : 'empty';
    pendingOffer = null;

    if (foundPrize) {
      const picked = pickRandomRewards(catalog, REWARD_OFFER_COUNT, chests.recentOfferedIds);
      if (!picked.length) {
        throw new Error('No rewards are available yet. Ask your instructor.');
      }
      const rewardIds = shuffleList(picked.map((r) => r.id));
      pendingOffer = { rewardIds };
      chests.pendingOffer = pendingOffer;
      chests.recentOfferedIds = normalizeRecentOfferedIds([
        ...(chests.recentOfferedIds || []),
        ...rewardIds,
      ]);
      outcome = 'prize';
    } else {
      chests.pendingOffer = null;
      outcome = 'empty';
    }

    rewardKeys = keys - 1;
    tx.update(userRef, {
      rewardKeys,
      rewardChests: chests,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { outcome, rewardKeys, pendingOffer };
}

async function claimRewardOffer(userId, rewardId, options = {}) {
  const chosenId = String(rewardId || '').trim();
  if (!chosenId) {
    throw new Error('Choose one of the four rewards.');
  }

  const responseText = String(options.responseText || '').trim();
  const classmateId = String(options.classmateId || '').trim();
  const userRef = db.collection('users').doc(userId);
  const rewardRef = db.collection('rewards').doc(chosenId);
  const redemptionRef = db.collection('redemptions').doc();
  const classmateRef = classmateId ? db.collection('users').doc(classmateId) : null;
  const classmatePublicRef = classmateId ? db.collection('publicProfiles').doc(classmateId) : null;

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      throw new Error('Your profile could not be loaded. Try signing in again.');
    }
    const profile = { id: userSnap.id, ...userSnap.data() };
    const chests = normalizeRewardChests(profile.rewardChests);
    const offerIds = chests.pendingOffer?.rewardIds || [];
    if (!offerIds.includes(chosenId)) {
      throw new Error('That reward is not one of your current choices.');
    }

    const rewardSnap = await tx.get(rewardRef);
    if (!rewardSnap.exists) {
      throw new Error('That reward is no longer available.');
    }
    const reward = { id: rewardSnap.id, ...rewardSnap.data() };

    if (reward.requiresText) {
      if (!responseText) {
        throw new Error(reward.textPrompt || 'Please write a short note for this reward.');
      }
      if (responseText.length > REWARD_RESPONSE_MAX_CHARS) {
        throw new Error(`Keep your answer to ${REWARD_RESPONSE_MAX_CHARS} characters or fewer.`);
      }
    }

    const isClassmateBoost = Boolean(reward.automated) && reward.automatedType === 'addXpToClassmate';
    const isFrameUpgrade = Boolean(reward.automated) && reward.automatedType === 'upgradeFrame';
    let classmate = null;
    let classmatePublic = null;
    let classmatePublicExists = false;
    let nextFrame = normalizeFrameTier(profile.frameTier);
    if (isClassmateBoost) {
      if (!classmateId || classmateId === userId) {
        throw new Error('Pick a classmate to receive the XP.');
      }
      const cSnap = await tx.get(classmateRef);
      const pSnap = await tx.get(classmatePublicRef);
      if (!cSnap.exists) {
        throw new Error('That classmate could not be found.');
      }
      classmate = { id: cSnap.id, ...cSnap.data() };
      if (classmate.role && classmate.role !== 'student') {
        throw new Error('Pick a classmate in your class.');
      }
      if ((classmate.classId || '') !== (profile.classId || '')) {
        throw new Error('You can only boost someone in your class.');
      }
      classmatePublicExists = pSnap.exists;
      classmatePublic = pSnap.exists ? { id: pSnap.id, ...pSnap.data() } : null;
    }

    const automated = Boolean(reward.automated);
    const status = automated ? 'fulfilled' : 'pending';
    const redemption = {
      userId,
      realName: profile.realName || '',
      characterName: profile.characterName || '',
      classId: profile.classId || '',
      className: classLabel(profile.classId),
      isTestStudent: Boolean(profile.isTestStudent),
      rewardId: reward.id,
      rewardName: reward.name || 'Reward',
      rewardDescription: reward.description || '',
      automated,
      automatedType: reward.automatedType || '',
      poolSize: rewardPoolSize(reward),
      responseText: reward.requiresText ? responseText : '',
      status,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (automated) {
      redemption.fulfilledAt = firebase.firestore.FieldValue.serverTimestamp();
    }

    if (isFrameUpgrade) {
      const currentFrame = normalizeFrameTier(profile.frameTier);
      nextFrame = Math.min(FRAME_TIER_MAX, currentFrame + 1);
      redemption.automatedResult = {
        frameTier: nextFrame,
        frameName: frameTierName(nextFrame),
        alreadyMax: currentFrame >= FRAME_TIER_MAX,
      };
    }

    if (isClassmateBoost && classmate) {
      const xpAward = rewardAutomatedXp(reward);
      const xp = applyXpAward(classmate, xpAward);
      const rewardFields = rewardProgressFromXp(classmate, xp);
      redemption.automatedResult = {
        classmateId: classmate.id,
        classmateName:
          (classmatePublic && classmatePublic.characterName) ||
          classmate.characterName ||
          'Classmate',
        xpAward,
      };
      tx.update(classmateRef, {
        xp,
        rewardKeys: rewardFields.rewardKeys,
        rewardChests: rewardFields.rewardChests,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      if (classmatePublicExists) {
        tx.update(classmatePublicRef, {
          xp,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    tx.set(redemptionRef, redemption);
    const userUpdate = {
      rewardChests: freshRewardChests(chests.recentOfferedIds),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (isFrameUpgrade) {
      userUpdate.frameTier = nextFrame;
    }
    tx.update(userRef, userUpdate);
    if (isFrameUpgrade) {
      tx.set(
        db.collection('publicProfiles').doc(userId),
        {
          frameTier: nextFrame,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }).catch((err) => {
    const permissionDenied =
      err?.code === 'permission-denied' || /permission|insufficient/i.test(err?.message || '');
    if (permissionDenied && String(options.classmateId || '').trim()) {
      throw new Error(
        'Missing permission to add XP to that classmate. Publish the latest firestore.rules, hard-refresh, and try again.'
      );
    }
    throw err;
  });

  return { redemptionId: redemptionRef.id };
}

async function getUserRedemptions(userId) {
  const snap = await db.collection('redemptions').where('userId', '==', userId).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() || 0;
      const bTime = b.createdAt?.toMillis?.() || 0;
      return bTime - aTime;
    });
}

function subscribeUserRedemptions(userId, callback) {
  return db.collection('redemptions').where('userId', '==', userId).onSnapshot(
    (snap) => {
      callback(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
          })
      );
    },
    (err) => console.error('Redemptions subscription error:', err)
  );
}

function sortRedemptions(redemptions, limit = 100) {
  return [...redemptions]
    .sort((a, b) => {
      const pendingDelta = Number(b.status === 'pending') - Number(a.status === 'pending');
      if (pendingDelta) return pendingDelta;
      const aTime = a.createdAt?.toMillis?.() || 0;
      const bTime = b.createdAt?.toMillis?.() || 0;
      return bTime - aTime;
    })
    .slice(0, limit);
}

async function getRecentRedemptions(limit = 100) {
  const snap = await db.collection('redemptions').get();
  return sortRedemptions(
    snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    limit
  );
}

function subscribeRedemptions(callback, limit = 100) {
  return db.collection('redemptions').onSnapshot(
    (snap) => {
      callback(
        sortRedemptions(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })),
          limit
        )
      );
    },
    (err) => console.error('Redemptions subscription error:', err)
  );
}

async function fulfillRedemption(redemptionId) {
  const ref = db.collection('redemptions').doc(redemptionId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error('That reward could not be found.');
  }
  const redemption = snap.data();
  if (redemption.status === 'fulfilled') {
    throw new Error('That reward is already marked fulfilled.');
  }
  await ref.set(
    {
      status: 'fulfilled',
      fulfilledAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function fulfillRewardPool(rewardId, poolSize) {
  const needed = Math.max(2, Number(poolSize) || 0);
  const snap = await db.collection('redemptions').where('rewardId', '==', rewardId).get();
  const pending = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.status === 'pending')
    .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
  if (pending.length < needed) {
    throw new Error(`Need ${needed} redemptions first (${pending.length} so far).`);
  }
  const batch = db.batch();
  pending.slice(0, needed).forEach((r) => {
    batch.set(
      db.collection('redemptions').doc(r.id),
      {
        status: 'fulfilled',
        fulfilledAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
  await batch.commit();
  return needed;
}

function classesFromSnapshot(snap) {
  return snap.docs.map((d) => normalizeClassRecord(d.id, d.data()));
}

async function getAllClasses() {
  const snap = await db.collection('classes').get();
  return setClassOptions(classesFromSnapshot(snap));
}

async function ensureClassesSeeded() {
  const snap = await db.collection('classes').get();
  if (!snap.empty) {
    return setClassOptions(classesFromSnapshot(snap));
  }
  const batch = db.batch();
  DEFAULT_CLASS_OPTIONS.forEach((cls, index) => {
    batch.set(db.collection('classes').doc(cls.id), {
      name: cls.name,
      rosterSize: cls.rosterSize,
      sortOrder: index,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
  return setClassOptions(DEFAULT_CLASS_OPTIONS.map((c) => ({ ...c, sortOrder: DEFAULT_CLASS_OPTIONS.indexOf(c) })));
}

async function ensureClassesLoaded() {
  try {
    return await ensureClassesSeeded();
  } catch (err) {
    console.error('Could not load classes from Firestore; using defaults.', err);
    return setClassOptions(DEFAULT_CLASS_OPTIONS);
  }
}

function subscribeClasses(callback) {
  return db.collection('classes').onSnapshot(
    (snap) => {
      if (snap.empty) {
        ensureClassesSeeded()
          .then((list) => callback(list))
          .catch((err) => {
            console.error('Class seed error:', err);
            callback(setClassOptions(DEFAULT_CLASS_OPTIONS));
          });
        return;
      }
      callback(setClassOptions(classesFromSnapshot(snap)));
    },
    (err) => {
      console.error('Classes subscription error:', err);
      callback(setClassOptions(DEFAULT_CLASS_OPTIONS));
    }
  );
}

async function saveClass({ id, name, rosterSize, sortOrder }, { isNew = false } = {}) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    throw new Error('Class name is required.');
  }
  let classId = String(id || '').trim();
  if (isNew) {
    if (!classId) classId = suggestClassId(trimmedName);
    if (!/^[a-zA-Z0-9_-]+$/.test(classId)) {
      throw new Error('Class ID can only use letters, numbers, hyphens, and underscores.');
    }
    const existing = await db.collection('classes').doc(classId).get();
    if (existing.exists) {
      throw new Error('That class ID already exists. Choose a different ID.');
    }
  } else if (!classId) {
    throw new Error('Missing class ID.');
  }

  const size = Math.max(1, Math.round(Number(rosterSize) || 20));
  const order = Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : CLASS_OPTIONS.length;
  const payload = {
    name: trimmedName,
    rosterSize: size,
    sortOrder: order,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  if (isNew) {
    payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
  }

  await db.collection('classes').doc(classId).set(payload, { merge: true });

  // Keep stored className labels in sync when renaming.
  if (!isNew) {
    const [usersSnap, publicSnap] = await Promise.all([
      db.collection('users').where('classId', '==', classId).get(),
      db.collection('publicProfiles').where('classId', '==', classId).get(),
    ]);
    const batch = db.batch();
    let writes = 0;
    usersSnap.docs.forEach((doc) => {
      batch.set(doc.ref, { className: trimmedName, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      writes++;
    });
    publicSnap.docs.forEach((doc) => {
      batch.set(doc.ref, { className: trimmedName, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      writes++;
    });
    if (writes) await batch.commit();
  }

  await getAllClasses();
  return classId;
}

async function deleteClass(classId) {
  const id = String(classId || '').trim();
  if (!id) throw new Error('Missing class ID.');

  const enrolled = await db.collection('users').where('classId', '==', id).limit(1).get();
  if (!enrolled.empty) {
    throw new Error('Cannot delete a class that still has students. Reassign or delete those students first.');
  }

  await db.collection('classes').doc(id).delete();
  await getAllClasses();
}

