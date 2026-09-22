let currentUser = null;
let currentProfile = null;
let completions = [];
let redemptions = [];
let loadedQuests = [];
let loadedRaids = [];
let raidParticipations = [];
let raidAwards = [];
let selectedOfferRewardId = null;
let offerRewards = [];
let classmateOptions = [];

function showQuestUpdateNotice() {
  document.getElementById('quest-update-notice')?.classList.remove('hidden');
}

async function refreshQuestsFromServer() {
  document.getElementById('quest-update-notice')?.classList.add('hidden');
  loadedQuests = await getActiveQuests();
  completions = await getUserCompletions(currentUser.uid);
  renderQuests(loadedQuests);
  renderCompleted(loadedQuests);
  await refreshRaidState({ checkXp: true });
  await refreshEarnedBadges();
}

function applyProfileFrame(profile) {
  applyFrameTier(document.getElementById('progress-section'), profile?.frameTier ?? 0);
}

function applyProfileBadges(profile) {
  const mount = document.getElementById('progress-badges');
  if (!mount) return;
  mount.innerHTML = `
    <p class="badge-row-label">Badges</p>
    ${renderBadgeRow(profile?.badges)}
    <p class="badge-row-hint muted">Tap a badge to see what it is and how to earn it.</p>
  `;
}

function applyProfileCosmetics(profile) {
  applyProfileFrame(profile);
  applyProfileBadges(profile);
}

function chestCopy(slot) {
  if (slot === 'empty') return { icon: '📭', label: 'Empty' };
  if (slot === 'prize') return { icon: '✨', label: 'Reward' };
  return { icon: '🧰', label: 'Locked' };
}

async function renderProgressRewards(profile) {
  const mount = document.getElementById('progress-rewards');
  if (!mount) return;

  const keys = Math.max(0, Number(profile?.rewardKeys) || 0);
  const chests = normalizeRewardChests(profile?.rewardChests);
  const pending = chests.pendingOffer;
  const canOpen = keys > 0 && !pending;
  const keyWord = keys === 1 ? 'key' : 'keys';

  if (pending?.rewardIds?.length) {
    offerRewards = await getRewardsByIds(pending.rewardIds);
  } else {
    offerRewards = [];
    selectedOfferRewardId = null;
    classmateOptions = [];
  }

  const orderedOffer = (pending?.rewardIds || [])
    .map((id) => offerRewards.find((r) => r.id === id))
    .filter(Boolean);

  mount.innerHTML = `
    <p class="badge-row-label">Rewards</p>
    <p class="reward-keys-line muted">You have <strong>${keys}</strong> ${keyWord}. Each level-up grants a key. One chest has a reward; empty chests stay open until you find it.</p>
    <div class="chest-row">
      ${chests.slots
        .map((slot, index) => {
          const copy = chestCopy(slot);
          const disabled = slot !== 'locked' || !canOpen;
          return `
            <button type="button" class="chest-btn ${slot}" data-chest-index="${index}" ${disabled ? 'disabled' : ''} aria-label="Chest ${index + 1}: ${copy.label}">
              <span class="chest-icon" aria-hidden="true">${copy.icon}</span>
              <span class="chest-label">${escapeHtml(copy.label)}</span>
            </button>
          `;
        })
        .join('')}
    </div>
    ${pending ? renderRewardOffer(orderedOffer) : ''}
  `;

  mount.querySelectorAll('.chest-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleOpenChest(Number(btn.dataset.chestIndex)));
  });
  bindRewardOffer(mount);
}

function revealProgressRewards() {
  const card = document.getElementById('progress-section');
  if (card?.classList.contains('is-collapsed')) {
    card.querySelector('.collapsible-toggle')?.click();
  }
  document.getElementById('progress-rewards')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderRewardOffer(rewards) {
  if (!rewards.length) {
    return `
      <div class="reward-offer">
        <h3>You found a reward</h3>
        <p class="muted">Rewards are not set up yet. Ask your instructor.</p>
      </div>
    `;
  }

  const selected = rewards.find((r) => r.id === selectedOfferRewardId) || null;
  const choices = rewards
    .map((r) => {
      const selectedClass = r.id === selectedOfferRewardId ? ' selected' : '';
      const tags = [];
      if (r.automated) tags.push('<span class="tag">Automated</span>');
      else tags.push('<span class="tag pending">Instructor fulfills</span>');
      const poolSize = rewardPoolSize(r);
      if (poolSize) tags.push(`<span class="tag">${poolSize}× pooled per class</span>`);
      return `
        <button type="button" class="reward-choice${selectedClass}" data-reward-id="${escapeHtml(r.id)}">
          <strong>${escapeHtml(r.name)}</strong>
          <p class="muted">${escapeHtml(r.description || '')}</p>
          <div class="quest-meta" style="margin-top: 0.4rem">${tags.join('')}</div>
        </button>
      `;
    })
    .join('');

  return `
    <div class="reward-offer">
      <h3>You found a reward — pick one</h3>
      <div class="reward-choice-grid">${choices}</div>
      ${selected ? renderRewardClaimFields(selected) : ''}
    </div>
  `;
}

function renderRewardClaimFields(reward) {
  const needsText = Boolean(reward.requiresText);
  const needsClassmate = Boolean(reward.automated) && reward.automatedType === 'addXpToClassmate';
  let fields = '';
  if (needsText) {
    const prompt = reward.textPrompt || 'Write a short note for this reward.';
    fields += `
      <div class="form-group">
        <label for="reward-response">${escapeHtml(prompt)}</label>
        <textarea id="reward-response" maxlength="${REWARD_RESPONSE_MAX_CHARS}"></textarea>
        <div class="char-count" id="reward-char-count">0 / ${REWARD_RESPONSE_MAX_CHARS}</div>
      </div>
    `;
  }
  if (needsClassmate) {
    const options = classmateOptions
      .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.characterName || 'Classmate')}</option>`)
      .join('');
    const prompt = reward.textPrompt || 'Which classmate?';
    fields += `
      <div class="form-group">
        <label for="reward-classmate">${escapeHtml(prompt)}</label>
        <select id="reward-classmate">
          <option value="">Select a classmate</option>
          ${options}
        </select>
        ${classmateOptions.length ? '' : '<p class="muted form-hint">No classmates found in your class yet.</p>'}
      </div>
    `;
  }
  return `
    <div class="reward-claim-form">
      ${fields}
      <button type="button" class="btn btn-primary" id="claim-reward-btn">Claim this reward</button>
    </div>
  `;
}

function bindRewardOffer(mount) {
  mount.querySelectorAll('.reward-choice').forEach((btn) => {
    btn.addEventListener('click', () => handleSelectOfferReward(btn.dataset.rewardId));
  });

  const textarea = mount.querySelector('#reward-response');
  const counter = mount.querySelector('#reward-char-count');
  if (textarea && counter) {
    const updateCount = () => {
      counter.textContent = `${textarea.value.length} / ${REWARD_RESPONSE_MAX_CHARS}`;
      counter.classList.toggle('warn', textarea.value.length >= REWARD_RESPONSE_MAX_CHARS);
    };
    textarea.addEventListener('input', updateCount);
  }

  mount.querySelector('#claim-reward-btn')?.addEventListener('click', handleClaimReward);
}

async function handleSelectOfferReward(rewardId) {
  selectedOfferRewardId = rewardId;
  const reward = offerRewards.find((r) => r.id === rewardId);
  if (reward?.automatedType === 'addXpToClassmate' && currentProfile?.classId) {
    classmateOptions = await getClassmatePublicProfiles(currentProfile.classId, currentUser.uid);
  }
  await renderProgressRewards(currentProfile);
}

async function handleOpenChest(index) {
  const btn = document.querySelector(`.chest-btn[data-chest-index="${index}"]`);
  if (btn) btn.disabled = true;
  try {
    const result = await openRewardChest(currentUser.uid, index);
    currentProfile = await getUserProfile(currentUser.uid);
    await renderProgressRewards(currentProfile);
    if (result.outcome === 'prize') {
      showToast('You found the reward! Pick one of the options.');
    } else {
      showToast('Empty. That chest stays open for next time.');
    }
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast(err.message || 'Could not open that chest.', 'error');
  }
}

async function handleClaimReward() {
  const reward = offerRewards.find((r) => r.id === selectedOfferRewardId);
  if (!reward) return;
  const btn = document.getElementById('claim-reward-btn');
  if (btn) btn.disabled = true;
  try {
    const responseText = document.getElementById('reward-response')?.value || '';
    const classmateId = document.getElementById('reward-classmate')?.value || '';
    const beforeFrame = normalizeFrameTier(currentProfile.frameTier);
    await claimRewardOffer(currentUser.uid, reward.id, { responseText, classmateId });
    selectedOfferRewardId = null;
    offerRewards = [];
    classmateOptions = [];
    currentProfile = await getUserProfile(currentUser.uid);
    applyProfileCosmetics(currentProfile);
    await renderProgressRewards(currentProfile);
    await refreshRedeemedRewards();
    if (reward.automatedType === 'upgradeFrame') {
      showToast(
        beforeFrame >= FRAME_TIER_MAX
          ? `Frame is already ${frameTierName(currentProfile.frameTier)}.`
          : `Frame upgraded to ${frameTierName(currentProfile.frameTier)}.`
      );
    } else if (reward.automatedType === 'addXpToClassmate') {
      showToast('150 XP sent to your classmate (random tree).');
    } else if (reward.automated) {
      showToast('Reward applied.');
    } else {
      showToast('Reward sent to your instructor.');
    }
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast(err.message || 'Could not claim that reward.', 'error');
  }
}

function toastBadgeGains(gains) {
  if (!gains?.length) return;
  showToast(`Badge earned: ${badgeGainSummary(gains)}`);
}

async function refreshEarnedBadges({ toastOnGain = false } = {}) {
  if (!currentUser) return;
  const result = await syncStudentBadges(currentUser.uid);
  if (result.profile) currentProfile = result.profile;
  applyProfileCosmetics(currentProfile);
  if (toastOnGain) toastBadgeGains(result.gained);
  return result;
}

function showLevelUp(gains, keysGained = 0) {
  const banner = document.getElementById('level-up');
  const list = document.getElementById('level-up-list');
  const keysEl = document.getElementById('level-up-keys');
  if (keysEl) {
    if (keysGained > 0) {
      const keyWord = keysGained === 1 ? 'key' : 'keys';
      keysEl.innerHTML =
        keysGained === 1
          ? '<strong>You got a reward key!</strong> Open a chest under <strong>Your progress → Rewards</strong> to spend it.'
          : `<strong>You got ${keysGained} reward keys!</strong> Open chests under <strong>Your progress → Rewards</strong> to spend them.`;
      keysEl.classList.remove('hidden');
      keysEl.setAttribute('aria-label', `You got ${keysGained} ${keyWord}. Open chests under Your progress Rewards.`);
    } else {
      keysEl.textContent = '';
      keysEl.classList.add('hidden');
      keysEl.removeAttribute('aria-label');
    }
  }
  if (!banner || !list) {
    const keyNote =
      keysGained > 0
        ? keysGained === 1
          ? ' You got a reward key — open a chest in Your progress.'
          : ` You got ${keysGained} reward keys — open chests in Your progress.`
        : '';
    showToast(
      'Level up! ' + gains.map((g) => `${XP_TREE_LABELS[g.tree]} ${g.from} → ${g.to}`).join(', ') + keyNote
    );
    return;
  }
  list.innerHTML = gains
    .map(
      (g) =>
        `<li>${escapeHtml(XP_TREE_LABELS[g.tree])}: Level ${g.from} → Level ${g.to}</li>`
    )
    .join('');
  banner.classList.remove('hidden');
  banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideLevelUp() {
  document.getElementById('level-up').classList.add('hidden');
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

function renderXpGrid(profile) {
  const grid = document.getElementById('xp-grid');
  const xp = profile.xp || emptyXp();

  grid.innerHTML = XP_TREES.map((tree) => {
    const amount = xp[tree] || 0;
    const progress = xpProgressInLevel(amount);
    return `
      <div class="xp-tree ${tree}">
        <div class="tree-name">${XP_TREE_LABELS[tree]}</div>
        <div class="level">Level ${progress.level}</div>
        <div class="xp-amount">${amount} XP</div>
        <div class="progress-bar" aria-hidden="true">
          <div class="progress-bar-fill" style="width: ${progress.percent}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderQuestTags(quest, { includeProgress = true } = {}) {
  const tags = [];
  if (quest.xpTeamwork) tags.push(`<span class="tag xp-teamwork">+${quest.xpTeamwork} Teamwork</span>`);
  if (quest.xpStudying) tags.push(`<span class="tag xp-studying">+${quest.xpStudying} Studying</span>`);
  if (quest.xpCollegeSuccess) tags.push(`<span class="tag xp-college">+${quest.xpCollegeSuccess} College</span>`);
  const weekText = questWeekDisplay(quest);
  if (weekText && weekText !== '—') tags.push(`<span class="tag">${escapeHtml(weekText)}</span>`);
  if (quest.oneTime) tags.push('<span class="tag one-time">One-time</span>');
  if (quest.weekly) tags.push('<span class="tag">Weekly</span>');
  if (quest.requiresValidation) tags.push('<span class="tag pending">Needs review</span>');
  if (quest.requiresText) tags.push('<span class="tag">Written answer</span>');
  const required = questRequiredCount(quest);
  if (required > 1 && includeProgress) {
    const logged = cycleLogCount(completions, quest);
    tags.push(`<span class="tag">${logged}/${required} logged</span>`);
  } else if (required > 1) {
    tags.push(`<span class="tag">${required}×</span>`);
  }
  if (quest.requireUniqueDays) tags.push('<span class="tag">Different days</span>');
  return tags.join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatCompletionDate(timestamp, fallback = 'Completed') {
  if (!timestamp?.toDate) return fallback;
  return timestamp.toDate().toLocaleString();
}

function redemptionStatusLabelForStudent(redemption) {
  if (redemption.status === 'fulfilled' && redemption.automated) return 'Applied';
  if (redemption.status === 'fulfilled') return 'Fulfilled';
  if (rewardPoolSize(redemption)) return 'Waiting for more classmates';
  return 'Waiting for Jason';
}

function redemptionStudentDetails(redemption) {
  const parts = [];
  const answer = (redemption.responseText || '').trim();
  if (answer) parts.push(answer);
  const result = redemption.automatedResult;
  if (result?.classmateName) parts.push(`Gave XP to ${result.classmateName}`);
  if (result?.frameName) {
    parts.push(result.alreadyMax ? `Frame already ${result.frameName}` : `Frame upgraded to ${result.frameName}`);
  }
  return parts.join(' · ');
}

function renderRedeemedRewards(list = redemptions) {
  redemptions = list;
  const el = document.getElementById('redeemed-list');
  if (!el) return;

  if (!redemptions.length) {
    el.innerHTML = '<li class="empty-state">You have not redeemed any rewards yet.</li>';
    return;
  }

  el.innerHTML = redemptions
    .map((entry) => {
      const when = formatCompletionDate(entry.createdAt, 'Just now');
      const status = redemptionStatusLabelForStudent(entry);
      const details = redemptionStudentDetails(entry);
      const description = (entry.rewardDescription || '').trim();
      return `
        <li class="quest-item">
          <div>
            <strong>${escapeHtml(entry.rewardName || 'Reward')}</strong>
            <p class="muted" style="margin: 0.35rem 0 0">${escapeHtml(when)} · ${escapeHtml(status)}</p>
            ${description ? `<p class="muted quest-table-desc">${escapeHtml(description)}</p>` : ''}
            ${details ? `<p class="quest-submitted-answer">${escapeHtml(details)}</p>` : ''}
          </div>
        </li>
      `;
    })
    .join('');
}

async function refreshRedeemedRewards() {
  if (!currentUser) return;
  redemptions = await getUserRedemptions(currentUser.uid);
  renderRedeemedRewards(redemptions);
}

function renderQuests(quests) {
  const list = document.getElementById('quest-list');
  const copy = document.getElementById('quest-week-copy');
  if (copy) {
    const week = currentTermWeek();
    copy.textContent = `Week ${week} of the quarter (starts ${TERM_WEEK1_START}). Honor-system unless a quest asks for a short answer or instructor approval.`;
  }
  const available = quests.filter((quest) => isQuestAvailable(quest, completions));

  if (!available.length) {
    list.innerHTML = '<li class="empty-state">No available quests right now. Check back soon!</li>';
    return;
  }

  list.innerHTML = available
    .map((quest) => {
      const pending = cyclePendingCompletion(completions, quest);
      const required = questRequiredCount(quest);
      const loggedToday = quest.requireUniqueDays && loggedOnDay(completions, quest, localDayKey());
      const blocked = Boolean(pending) || loggedToday;
      let buttonLabel = required > 1 ? 'Log' : 'Complete';
      if (pending) buttonLabel = 'Pending';
      else if (loggedToday) buttonLabel = 'Logged today';

      const prompt = quest.textPrompt || 'Write a short response.';
      const pendingAnswer = (pending?.responseText || '').trim();
      let responseBlock = '';
      if (quest.requiresText && pending && pendingAnswer) {
        responseBlock = `<p class="quest-submitted-answer">${escapeHtml(pendingAnswer)}</p>`;
      } else if (quest.requiresText && !blocked) {
        responseBlock = `
            <div class="quest-response-block" hidden>
              <label class="quest-prompt" for="quest-response-${quest.id}">${escapeHtml(prompt)}</label>
              <textarea
                id="quest-response-${quest.id}"
                class="quest-response-input"
                data-quest-response="${quest.id}"
                maxlength="${QUEST_RESPONSE_MAX_CHARS}"
              ></textarea>
              <div class="char-count" data-char-count="${quest.id}">0 / ${QUEST_RESPONSE_MAX_CHARS}</div>
            </div>
          `;
      }

      return `
        <li class="quest-item" data-quest-id="${quest.id}">
          <div class="quest-item-body">
            <strong>${escapeHtml(quest.name)}</strong>
            ${quest.description ? `<p class="quest-instructions muted">${escapeHtml(quest.description)}</p>` : ''}
            <div class="quest-meta">${renderQuestTags(quest)}</div>
            ${responseBlock}
          </div>
          <div class="quest-item-actions">
            ${
              quest.requiresText && !blocked
                ? `<button type="button" class="btn btn-secondary btn-sm cancel-quest-response-btn" data-quest-id="${quest.id}" hidden>Cancel</button>`
                : ''
            }
            <button
              type="button"
              class="btn ${pending ? 'btn-secondary' : 'btn-success'} btn-sm complete-quest-btn"
              data-quest-id="${quest.id}"
              data-submit-label="${required > 1 ? 'Log' : 'Complete'}"
              ${blocked ? 'disabled' : ''}
            >
              ${buttonLabel}
            </button>
          </div>
        </li>
      `;
    })
    .join('');

  list.querySelectorAll('.complete-quest-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleComplete(btn.dataset.questId, quests));
  });
  list.querySelectorAll('.cancel-quest-response-btn').forEach((btn) => {
    btn.addEventListener('click', () => collapseQuestResponse(btn.dataset.questId));
  });

  list.querySelectorAll('.quest-response-input').forEach((textarea) => {
    const questId = textarea.dataset.questResponse;
    const counter = list.querySelector(`[data-char-count="${questId}"]`);
    const updateCount = () => {
      if (!counter) return;
      const len = textarea.value.length;
      counter.textContent = `${len} / ${QUEST_RESPONSE_MAX_CHARS}`;
      counter.classList.toggle('warn', len >= QUEST_RESPONSE_MAX_CHARS);
    };
    textarea.addEventListener('input', updateCount);
    updateCount();
  });
}

function renderCompleted(quests) {
  const list = document.getElementById('completed-list');
  if (!list) return;

  if (!completions.length) {
    list.innerHTML = '<li class="empty-state">You have not completed any quests yet.</li>';
    return;
  }

  list.innerHTML = completions
    .map((entry) => {
      const quest = quests.find((q) => q.id === entry.questId);
      const name = entry.questName || quest?.name || 'Quest';
      const when = formatCompletionDate(entry.completedAt);
      const status = completionStatusLabel(entry);
      const tags = quest ? renderQuestTags(quest, { includeProgress: false }) : '';
      const answer = (entry.responseText || '').trim();
      return `
        <li class="quest-item">
          <div>
            <strong>${escapeHtml(name)}</strong>
            <p class="muted" style="margin: 0.35rem 0 0">${escapeHtml(when)} · ${escapeHtml(status)}</p>
            ${answer ? `<p class="quest-submitted-answer">${escapeHtml(answer)}</p>` : ''}
            ${tags ? `<div class="quest-meta">${tags}</div>` : ''}
          </div>
        </li>
      `;
    })
    .join('');
}

function renderRaidTags(raid, { joined, required, awarded }) {
  const tags = [];
  if (raid.xpTeamwork) tags.push(`<span class="tag xp-teamwork">+${raid.xpTeamwork} Teamwork</span>`);
  if (raid.xpStudying) tags.push(`<span class="tag xp-studying">+${raid.xpStudying} Studying</span>`);
  if (raid.xpCollegeSuccess) tags.push(`<span class="tag xp-college">+${raid.xpCollegeSuccess} College</span>`);
  tags.push(`<span class="tag raid">${joined} / ${required} joined</span>`);
  if (awarded) tags.push('<span class="tag">Class complete</span>');
  else tags.push('<span class="tag pending">Needs review</span>');
  return tags.join('');
}

function renderRaids(raids) {
  const list = document.getElementById('raid-list');
  if (!list) return;

  const classId = currentProfile?.classId;
  if (!classId) {
    list.innerHTML = '<li class="empty-state">Choose your class to see raids.</li>';
    return;
  }

  if (!raids.length) {
    list.innerHTML = '<li class="empty-state">No raids right now. Check back soon!</li>';
    return;
  }

  list.innerHTML = raids
    .map((raid) => {
      const required = raidRequiredParticipants(raid);
      const joined = uniqueRaidParticipantCount(raidParticipations, raid.id, classId);
      const awarded = Boolean(raidAwardForClass(raidAwards, raid.id, classId));
      const alreadyJoined = uniqueRaidParticipantIds(raidParticipations, raid.id, classId).includes(currentUser.uid);
      const ready = !awarded && joined >= required;

      let buttonLabel = 'Join raid';
      let disabled = false;
      if (awarded) {
        buttonLabel = 'Class complete';
        disabled = true;
      } else if (alreadyJoined && ready) {
        buttonLabel = 'Waiting for instructor';
        disabled = true;
      } else if (alreadyJoined) {
        buttonLabel = 'Joined';
        disabled = true;
      }

      return `
        <li class="quest-item" data-raid-id="${raid.id}">
          <div class="quest-item-body">
            <strong>${escapeHtml(raid.name)}</strong>
            ${raid.description ? `<p class="quest-instructions muted">${escapeHtml(raid.description)}</p>` : ''}
            <div class="quest-meta">${renderRaidTags(raid, { joined, required, awarded })}</div>
          </div>
          <div class="quest-item-actions">
            <button
              type="button"
              class="btn ${awarded || alreadyJoined ? 'btn-secondary' : 'btn-success'} btn-sm join-raid-btn"
              data-raid-id="${raid.id}"
              ${disabled ? 'disabled' : ''}
            >
              ${buttonLabel}
            </button>
          </div>
        </li>
      `;
    })
    .join('');

  list.querySelectorAll('.join-raid-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleJoinRaid(btn.dataset.raidId));
  });
}

async function refreshRaidState({ checkXp = false } = {}) {
  const beforeXp = snapshotXp(currentProfile);
  const [raids, parts, awards] = await Promise.all([getActiveRaids(), getRaidParticipations(), getRaidAwards()]);
  loadedRaids = raids;
  raidParticipations = parts;
  raidAwards = awards;
  if (checkXp && currentUser) {
    currentProfile = await getUserProfile(currentUser.uid);
    renderXpGrid(currentProfile);
    applyProfileCosmetics(currentProfile);
    const afterXp = snapshotXp(currentProfile);
    const gains = XP_TREES.map((tree) => {
      const from = levelFromXp(beforeXp[tree]);
      const to = levelFromXp(afterXp[tree] || 0);
      return { tree, from, to };
    }).filter((g) => g.to > g.from);
    if (gains.length) {
      showLevelUp(gains, countLevelUps(beforeXp, afterXp));
      revealProgressRewards();
    }
    await renderProgressRewards(currentProfile);
    await refreshEarnedBadges({ toastOnGain: true });
  }
  renderRaids(loadedRaids);
}

async function handleJoinRaid(raidId) {
  const raid = loadedRaids.find((r) => r.id === raidId);
  if (!raid || !currentUser) return;

  const btn = document.querySelector(`.join-raid-btn[data-raid-id="${raidId}"]`);
  if (btn) btn.disabled = true;

  try {
    await joinRaid(currentUser.uid, raid, currentProfile);
    await refreshRaidState();
    showToast('You joined the raid. XP waits until your instructor approves.');
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast(err.message || 'Could not join raid.', 'error');
  }
}

function expandQuestResponse(questId) {
  const item = document.querySelector(`.quest-item[data-quest-id="${questId}"]`);
  if (!item) return;
  const block = item.querySelector('.quest-response-block');
  const btn = item.querySelector('.complete-quest-btn');
  const cancel = item.querySelector('.cancel-quest-response-btn');
  if (block) {
    block.hidden = false;
    item.classList.add('has-response');
    const textarea = block.querySelector('textarea');
    if (textarea) {
      textarea.focus();
      textarea.dispatchEvent(new Event('input'));
    }
  }
  if (btn) {
    btn.textContent = 'Submit';
    btn.dataset.readyToSubmit = '1';
  }
  if (cancel) cancel.hidden = false;
}

function collapseQuestResponse(questId) {
  const item = document.querySelector(`.quest-item[data-quest-id="${questId}"]`);
  if (!item) return;
  const block = item.querySelector('.quest-response-block');
  const btn = item.querySelector('.complete-quest-btn');
  const cancel = item.querySelector('.cancel-quest-response-btn');
  const textarea = block?.querySelector('textarea');
  if (textarea) {
    textarea.value = '';
    textarea.dispatchEvent(new Event('input'));
  }
  if (block) block.hidden = true;
  item.classList.remove('has-response');
  if (btn) {
    btn.textContent = btn.dataset.submitLabel || 'Complete';
    delete btn.dataset.readyToSubmit;
    btn.disabled = false;
  }
  if (cancel) cancel.hidden = true;
}

async function handleComplete(questId, quests) {
  const quest = quests.find((q) => q.id === questId);
  if (!quest || !currentUser) return;

  const btn = document.querySelector(`.complete-quest-btn[data-quest-id="${questId}"]`);
  if (quest.requiresText && btn?.dataset.readyToSubmit !== '1') {
    expandQuestResponse(questId);
    return;
  }
  if (btn) btn.disabled = true;

  const responseEl = document.querySelector(`[data-quest-response="${questId}"]`);
  const responseText = responseEl?.value || '';

  try {
    const beforeXp = snapshotXp(currentProfile);
    const result = await completeQuest(currentUser.uid, quest, { responseText });
    currentProfile = await getUserProfile(currentUser.uid);
    const afterXp = snapshotXp(currentProfile);
    const gains = XP_TREES.map((tree) => {
      const from = levelFromXp(beforeXp[tree]);
      const to = levelFromXp(afterXp[tree] || 0);
      return { tree, from, to };
    }).filter((g) => g.to > g.from);
    completions = await getUserCompletions(currentUser.uid);
    renderXpGrid(currentProfile);
    applyProfileCosmetics(currentProfile);
    await renderProgressRewards(currentProfile);
    renderQuests(loadedQuests);
    renderCompleted(loadedQuests);
    if (result.status === 'pending') {
      showToast('Submitted — pending instructor approval.');
    } else if (result.status === 'progress') {
      showToast(`Logged ${result.progressIndex} of ${result.requiredCount}. No XP until the streak is finished.`);
    } else if (gains.length) {
      showLevelUp(gains, result.keysGained || 0);
      if (result.keysGained) revealProgressRewards();
      toastBadgeGains(result.badgeGained);
    } else {
      const badgeNote = result.badgeGained?.length ? ` Badge earned: ${badgeGainSummary(result.badgeGained)}.` : '';
      showToast(`Quest complete! +XP earned.${badgeNote}`);
      if (result.keysGained) revealProgressRewards();
    }
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast(err.message || 'Could not complete quest.', 'error');
  }
}

async function init(user) {
  const session = await requireAuth({ allowedRoles: ['student'], user });
  if (!session) return;

  currentUser = session.user;
  currentProfile = session.profile;

  await ensureClassesLoaded();

  const displayName = currentProfile.characterName || 'Adventurer';
  document.getElementById('welcome-text').textContent = `Playing as ${displayName}`;

  document.getElementById('sign-out').addEventListener('click', () => signOutUser());
  document.getElementById('level-up-close').addEventListener('click', hideLevelUp);
  document.getElementById('quest-update-refresh').addEventListener('click', () => {
    refreshQuestsFromServer().catch((err) => {
      showToast(err.message || 'Could not refresh quests.', 'error');
    });
  });

  renderXpGrid(currentProfile);
  applyProfileCosmetics(currentProfile);

  try {
    const beforeKeys = Math.max(0, Number(currentProfile.rewardKeys) || 0);
    currentProfile = await ensureStudentRewardState(currentUser.uid);
    await renderProgressRewards(currentProfile);
    const afterKeys = Math.max(0, Number(currentProfile.rewardKeys) || 0);
    if (afterKeys > beforeKeys) {
      revealProgressRewards();
      showToast(afterKeys === 1 ? 'You have a key. Open a chest below your badges.' : `You have ${afterKeys} keys. Open a chest below your badges.`);
    }
  } catch (err) {
    console.error('Could not load rewards:', err);
    const mount = document.getElementById('progress-rewards');
    if (mount) {
      mount.innerHTML = `<p class="muted">Could not load rewards: ${escapeHtml(err.message)}</p>`;
    }
  }

  try {
    await syncPublicProfile(currentUser.uid, {
      characterName: currentProfile.characterName,
      xp: currentProfile.xp,
      classId: currentProfile.classId,
      frameTier: currentProfile.frameTier ?? 0,
      badges: normalizeBadges(currentProfile.badges),
    });
  } catch (err) {
    console.error('Could not update leaderboard profile:', err);
  }

  try {
    const [quests, userCompletions] = await Promise.all([
      getActiveQuests(),
      getUserCompletions(currentUser.uid),
    ]);
    completions = userCompletions;
    loadedQuests = quests;
    renderQuests(loadedQuests);
    renderCompleted(loadedQuests);
    subscribeQuests(showQuestUpdateNotice);
  } catch (err) {
    console.error(err);
    document.getElementById('quest-list').innerHTML =
      `<li class="empty-state">Could not load quests: ${err.message}</li>`;
    showToast(err.message || 'Could not load quests.', 'error');
  }

  try {
    await refreshRedeemedRewards();
    subscribeUserRedemptions(currentUser.uid, renderRedeemedRewards);
  } catch (err) {
    console.error(err);
    const redeemedList = document.getElementById('redeemed-list');
    if (redeemedList) {
      redeemedList.innerHTML = `<li class="empty-state">Could not load redeemed rewards: ${escapeHtml(err.message)}</li>`;
    }
  }

  try {
    await refreshRaidState();
    await refreshEarnedBadges();
    subscribeRaids(showQuestUpdateNotice);
    subscribeRaidParticipations(() => {
      refreshRaidState().catch((err) => console.error(err));
    });
    subscribeRaidAwards(() => {
      refreshRaidState({ checkXp: true }).catch((err) => console.error(err));
    });
  } catch (err) {
    console.error(err);
    const raidList = document.getElementById('raid-list');
    if (raidList) {
      raidList.innerHTML = `<li class="empty-state">Could not load raids: ${escapeHtml(err.message)}</li>`;
    }
    showToast(err.message || 'Could not load raids.', 'error');
    await refreshEarnedBadges().catch((badgeErr) => console.error(badgeErr));
  }
}

onAuthReady((user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }
  init(user);
});
