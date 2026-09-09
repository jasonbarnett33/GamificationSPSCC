let studentsById = {};
let rosterStudents = [];
let loadedRaids = [];
let raidParticipations = [];
let raidAwards = [];
let leaderboardRefresh = null;

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

function updateQuestCatalogWeekCopy() {
  const el = document.getElementById('quest-catalog-week-copy');
  if (!el) return;
  const week = currentTermWeek();
  el.textContent = `Term week ${week} of ${TERM_WEEK_COUNT} (week 1 starts ${TERM_WEEK1_START}). Students see every-week quests, 2 rotating weekly quests, and this week's specific quests. Raids stay available.`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) return '—';
  return timestamp.toDate().toLocaleString();
}

function signedUpCount(classId) {
  return rosterStudents.filter((s) => s.classId === classId).length;
}

function renderClasses() {
  const tbody = document.getElementById('classes-body');
  if (!tbody) return;
  if (!CLASS_OPTIONS.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No classes yet. Add one to get started.</td></tr>';
    return;
  }
  tbody.innerHTML = CLASS_OPTIONS.map((cls) => {
    const signedUp = signedUpCount(cls.id);
    return `
      <tr>
        <td><strong>${escapeHtml(cls.name)}</strong></td>
        <td><code>${escapeHtml(cls.id)}</code></td>
        <td>${cls.rosterSize}</td>
        <td>${signedUp}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn btn-secondary btn-sm edit-class-btn" data-id="${escapeHtml(cls.id)}">Edit</button>
            <button type="button" class="btn btn-danger btn-sm delete-class-btn" data-id="${escapeHtml(cls.id)}">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.edit-class-btn').forEach((btn) => {
    btn.addEventListener('click', () => openClassModal(btn.dataset.id));
  });
  tbody.querySelectorAll('.delete-class-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleDeleteClass(btn.dataset.id));
  });
}

function refreshClassSelects() {
  const studentSelect = document.getElementById('student-class-id');
  if (studentSelect && !document.getElementById('student-modal')?.classList.contains('hidden')) {
    fillClassSelect(studentSelect, studentSelect.value, !studentSelect.value);
  }
  const boardFilter = document.getElementById('leaderboard-class-filter');
  if (boardFilter) {
    const current = boardFilter.value || CLASS_OPTIONS[0]?.id || '';
    fillClassSelect(boardFilter, current, false);
  }
  if (typeof leaderboardRefresh === 'function') leaderboardRefresh();
}

const classModal = document.getElementById('class-modal');
const classForm = document.getElementById('class-form');

function openClassModal(classId = '') {
  const existing = CLASS_OPTIONS.find((c) => c.id === classId);
  const isNew = !existing;
  document.getElementById('class-modal-title').textContent = isNew ? 'Add class' : 'Edit class';
  document.getElementById('class-editing-id').value = existing?.id || '';
  const idInput = document.getElementById('class-id-input');
  const idGroup = document.getElementById('class-id-group');
  idInput.value = existing?.id || '';
  idInput.disabled = !isNew;
  idGroup.classList.toggle('hidden', !isNew);
  document.getElementById('class-name-input').value = existing?.name || '';
  document.getElementById('class-roster-size').value = existing?.rosterSize ?? 20;
  document.getElementById('class-sort-order').value =
    existing?.sortOrder ?? CLASS_OPTIONS.length;
  classModal.classList.remove('hidden');
}

function closeClassModal() {
  classModal.classList.add('hidden');
}

async function handleDeleteClass(classId) {
  const cls = CLASS_OPTIONS.find((c) => c.id === classId);
  const label = cls?.name || classId;
  const signedUp = signedUpCount(classId);
  if (signedUp > 0) {
    showToast(`Cannot delete "${label}" while ${signedUp} student(s) are enrolled.`, 'error');
    return;
  }
  if (!window.confirm(`Delete class "${label}"? This cannot be undone.`)) return;
  try {
    await deleteClass(classId);
    renderClasses();
    refreshClassSelects();
    renderRaidProgress();
    showToast('Class deleted.');
  } catch (err) {
    showToast(err.message || 'Could not delete class.', 'error');
  }
}

document.getElementById('add-class-btn')?.addEventListener('click', () => openClassModal(''));
document.getElementById('cancel-class')?.addEventListener('click', closeClassModal);
classModal?.addEventListener('click', (e) => {
  if (e.target === classModal) closeClassModal();
});

classForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const editingId = document.getElementById('class-editing-id').value;
  const isNew = !editingId;
  const name = document.getElementById('class-name-input').value;
  try {
    await saveClass(
      {
        id: isNew ? document.getElementById('class-id-input').value.trim() || suggestClassId(name) : editingId,
        name,
        rosterSize: document.getElementById('class-roster-size').value,
        sortOrder: document.getElementById('class-sort-order').value,
      },
      { isNew }
    );
    closeClassModal();
    renderClasses();
    refreshClassSelects();
    renderRaidProgress();
    showToast(isNew ? 'Class added.' : 'Class saved.');
  } catch (err) {
    showToast(err.message || 'Could not save class.', 'error');
  }
});

function renderStudents(students) {
  rosterStudents = students;
  studentsById = Object.fromEntries(students.map((s) => [s.id, s]));
  renderClasses();
  const tbody = document.getElementById('students-body');

  if (!students.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No students yet.</td></tr>';
    return;
  }

  tbody.innerHTML = students
    .map((s) => {
      const xp = s.xp || emptyXp();
      return `
        <tr>
          <td>${escapeHtml(s.realName)}</td>
          <td>${escapeHtml(s.characterName || '—')}</td>
          <td>${escapeHtml(classLabel(s.classId))}</td>
          <td>${totalXp(s)}</td>
          <td>L${levelFromXp(xp.teamwork || 0)} (${xp.teamwork || 0})</td>
          <td>L${levelFromXp(xp.studying || 0)} (${xp.studying || 0})</td>
          <td>L${levelFromXp(xp.collegeSuccess || 0)} (${xp.collegeSuccess || 0})</td>
          <td>${Math.max(0, Number(s.rewardKeys) || 0)}</td>
          <td>
            <div class="row-actions">
              <button type="button" class="btn btn-secondary btn-sm edit-student-btn" data-id="${s.id}">Edit</button>
              <button type="button" class="btn btn-danger btn-sm delete-student-btn" data-id="${s.id}">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('.edit-student-btn').forEach((btn) => {
    btn.addEventListener('click', () => openStudentModal(btn.dataset.id));
  });

  tbody.querySelectorAll('.delete-student-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleDeleteStudent(btn.dataset.id));
  });

  renderRaidProgress();
}

async function handleDeleteStudent(studentId) {
  const student = studentsById[studentId];
  if (!student) return;

  const label = student.realName || student.characterName || 'this student';
  const warning = student.isTestStudent
    ? `Delete test student "${label}"?`
    : `Delete "${label}"? This cannot be undone.`;
  if (!window.confirm(warning)) return;

  try {
    await deleteStudentByInstructor(studentId);
    showToast('Student deleted.');
  } catch (err) {
    showToast(err.message || 'Could not delete student.', 'error');
  }
}

function renderQuests(quests) {
  const tbody = document.getElementById('quests-body');

  if (!quests.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No quests yet. Add your first quest.</td></tr>';
    return;
  }

  tbody.innerHTML = quests
    .map((q) => {
      const checked = q.active ? 'checked' : '';
      return `
        <tr>
          <td>
            <label class="toggle">
              <input type="checkbox" class="quest-active-toggle" data-id="${q.id}" ${checked} />
              <span class="toggle-track" aria-hidden="true"></span>
              <span class="toggle-label">${q.active ? 'Active' : 'Inactive'}</span>
            </label>
          </td>
          <td>
            <strong>${escapeHtml(q.name)}</strong>
            ${q.description ? `<div class="muted quest-table-desc">${escapeHtml(q.description)}</div>` : ''}
          </td>
          <td>${escapeHtml(questWeekDisplay(q))}</td>
          <td>${q.xpTeamwork || 0} / ${q.xpStudying || 0} / ${q.xpCollegeSuccess || 0}</td>
          <td>${escapeHtml(questFlagLabels(q))}</td>
          <td><button type="button" class="btn btn-secondary btn-sm edit-quest-btn" data-id="${q.id}">Edit</button></td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('.edit-quest-btn').forEach((btn) => {
    btn.addEventListener('click', () => openQuestModal(btn.dataset.id, quests));
  });

  tbody.querySelectorAll('.quest-active-toggle').forEach((input) => {
    input.addEventListener('change', async () => {
      const questId = input.dataset.id;
      const active = input.checked;
      input.disabled = true;
      try {
        await setQuestActive(questId, active);
        const updated = await getAllQuests();
        renderQuests(updated);
        showToast(active ? 'Quest activated.' : 'Quest deactivated.');
      } catch (err) {
        input.checked = !active;
        input.disabled = false;
        showToast(err.message || 'Could not update quest.', 'error');
      }
    });
  });
}

let loadedRewards = [];

function renderRewards(rewards) {
  loadedRewards = rewards;
  const tbody = document.getElementById('rewards-body');
  if (!tbody) return;

  if (!rewards.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No rewards yet. Add one or sync the catalog.</td></tr>';
    return;
  }

  tbody.innerHTML = rewards
    .map((r) => {
      const checked = r.active !== false ? 'checked' : '';
      return `
        <tr>
          <td>
            <label class="toggle">
              <input type="checkbox" class="reward-active-toggle" data-id="${r.id}" ${checked} />
              <span class="toggle-track" aria-hidden="true"></span>
              <span class="toggle-label">${r.active !== false ? 'Active' : 'Inactive'}</span>
            </label>
          </td>
          <td>
            <strong>${escapeHtml(r.name)}</strong>
            ${r.description ? `<div class="muted quest-table-desc">${escapeHtml(r.description)}</div>` : ''}
          </td>
          <td>${escapeHtml(rewardFlagLabels(r))}</td>
          <td><button type="button" class="btn btn-secondary btn-sm edit-reward-btn" data-id="${r.id}">Edit</button></td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('.edit-reward-btn').forEach((btn) => {
    btn.addEventListener('click', () => openRewardModal(btn.dataset.id, loadedRewards));
  });

  tbody.querySelectorAll('.reward-active-toggle').forEach((input) => {
    input.addEventListener('change', async () => {
      const rewardId = input.dataset.id;
      const active = input.checked;
      input.disabled = true;
      try {
        await setRewardActive(rewardId, active);
        renderRewards(await getAllRewards());
        showToast(active ? 'Reward activated.' : 'Reward deactivated.');
      } catch (err) {
        input.checked = !active;
        input.disabled = false;
        showToast(err.message || 'Could not update reward.', 'error');
      }
    });
  });
}

function renderCompletions(completions) {
  const tbody = document.getElementById('completions-body');

  if (!completions.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No completions yet.</td></tr>';
    return;
  }

  tbody.innerHTML = completions
    .map((c) => {
      const student = studentsById[c.userId];
      const studentLabel = student?.realName || student?.characterName || 'Unknown student';
      const answer = (c.responseText || '').trim();
      const pending = isPendingCompletion(c);
      const approveBtn = pending
        ? `<button type="button" class="btn btn-success btn-sm approve-completion-btn" data-id="${c.id}">Approve</button>`
        : '';
      return `
        <tr class="${pending ? 'completion-pending' : ''}">
          <td>${formatDate(c.completedAt)}</td>
          <td>${escapeHtml(c.questName || c.questId)}</td>
          <td class="completion-answer">${answer ? escapeHtml(answer) : '—'}</td>
          <td>${escapeHtml(studentLabel)}</td>
          <td>${escapeHtml(completionStatusLabel(c))}</td>
          <td>${approveBtn}</td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('.approve-completion-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleApproveCompletion(btn.dataset.id));
  });
}

async function handleApproveCompletion(completionId) {
  const btn = document.querySelector(`.approve-completion-btn[data-id="${completionId}"]`);
  if (btn) btn.disabled = true;
  try {
    await approveCompletion(completionId);
    showToast('Quest approved. XP awarded.');
    const updated = await getRecentCompletions();
    renderCompletions(updated);
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast(err.message || 'Could not approve quest.', 'error');
  }
}

function redemptionDetails(redemption) {
  const parts = [];
  const answer = (redemption.responseText || '').trim();
  if (answer) parts.push(answer);
  const boost = redemption.automatedResult;
  if (boost?.classmateName) {
    const xp = boost.xpAward || {};
    const bits = [];
    if (xp.teamwork) bits.push(`+${xp.teamwork} Teamwork`);
    if (xp.studying) bits.push(`+${xp.studying} Studying`);
    if (xp.collegeSuccess) bits.push(`+${xp.collegeSuccess} College`);
    parts.push(`Boosted ${boost.classmateName}${bits.length ? ` (${bits.join(', ')})` : ''}`);
  }
  if (boost?.frameName) {
    parts.push(boost.alreadyMax ? `Frame already ${boost.frameName}` : `Frame → ${boost.frameName}`);
  }
  return parts.length ? parts.join('\n') : '—';
}

function redemptionStatusLabel(redemption, pendingCount = 0) {
  if (redemption.status === 'fulfilled' && redemption.automated) return 'Automated';
  if (redemption.status === 'fulfilled') return 'Fulfilled';
  const poolSize = rewardPoolSize(redemption);
  if (poolSize) return `Pooled ${pendingCount}/${poolSize}`;
  return 'Needs fulfillment';
}

function renderRedemptions(redemptions) {
  const tbody = document.getElementById('redemptions-body');
  if (!tbody) return;

  if (!redemptions.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No reward redemptions yet.</td></tr>';
    return;
  }

  const pendingByReward = {};
  redemptions.forEach((r) => {
    if (r.status !== 'pending') return;
    pendingByReward[r.rewardId] = (pendingByReward[r.rewardId] || 0) + 1;
  });
  const poolButtonShown = {};

  tbody.innerHTML = redemptions
    .map((r) => {
      const student = studentsById[r.userId];
      const studentLabel = r.realName || student?.realName || r.characterName || 'Unknown student';
      const pending = r.status === 'pending';
      const poolSize = rewardPoolSize(r);
      const pendingCount = pendingByReward[r.rewardId] || 0;
      let fulfillBtn = '';
      if (pending && !r.automated) {
        if (poolSize) {
          if (pendingCount >= poolSize && !poolButtonShown[r.rewardId]) {
            poolButtonShown[r.rewardId] = true;
            fulfillBtn = `<button type="button" class="btn btn-success btn-sm fulfill-pool-btn" data-reward-id="${escapeHtml(r.rewardId)}" data-pool-size="${poolSize}">Fulfill pool (${poolSize})</button>`;
          }
        } else {
          fulfillBtn = `<button type="button" class="btn btn-success btn-sm fulfill-redemption-btn" data-id="${r.id}">Mark fulfilled</button>`;
        }
      }
      const typeLabel = r.automated ? 'Automated' : poolSize ? `Pooled (${poolSize})` : 'Instructor';
      return `
        <tr class="${pending ? 'redemption-pending' : ''}">
          <td>${formatDate(r.createdAt)}</td>
          <td>${escapeHtml(studentLabel)}<div class="muted">${escapeHtml(classLabel(r.classId))}</div></td>
          <td>
            <strong>${escapeHtml(r.rewardName || r.rewardId)}</strong>
            ${r.rewardDescription ? `<div class="muted quest-table-desc">${escapeHtml(r.rewardDescription)}</div>` : ''}
          </td>
          <td class="completion-answer">${escapeHtml(redemptionDetails(r))}</td>
          <td>${escapeHtml(typeLabel)}</td>
          <td>${escapeHtml(redemptionStatusLabel(r, pendingCount))}</td>
          <td>${fulfillBtn}</td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('.fulfill-redemption-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleFulfillRedemption(btn.dataset.id));
  });
  tbody.querySelectorAll('.fulfill-pool-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleFulfillPool(btn.dataset.rewardId, btn.dataset.poolSize));
  });
}

async function handleFulfillRedemption(redemptionId) {
  const btn = document.querySelector(`.fulfill-redemption-btn[data-id="${redemptionId}"]`);
  if (btn) btn.disabled = true;
  try {
    await fulfillRedemption(redemptionId);
    showToast('Reward marked fulfilled.');
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast(err.message || 'Could not update that reward.', 'error');
  }
}

async function handleFulfillPool(rewardId, poolSize) {
  const btn = document.querySelector(`.fulfill-pool-btn[data-reward-id="${rewardId}"]`);
  if (btn) btn.disabled = true;
  try {
    const count = await fulfillRewardPool(rewardId, poolSize);
    showToast(`Marked ${count} pooled redemption(s) fulfilled.`);
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast(err.message || 'Could not fulfill that pool.', 'error');
  }
}

function renderRaids(raids) {
  loadedRaids = raids;
  const tbody = document.getElementById('raids-body');
  if (!tbody) return;

  if (!raids.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No raids yet. Add a class raid.</td></tr>';
    renderRaidProgress();
    return;
  }

  tbody.innerHTML = raids
    .map((r) => {
      const checked = r.active ? 'checked' : '';
      const required = raidRequiredParticipants(r);
      return `
        <tr>
          <td>
            <label class="toggle">
              <input type="checkbox" class="raid-active-toggle" data-id="${r.id}" ${checked} />
              <span class="toggle-track" aria-hidden="true"></span>
              <span class="toggle-label">${r.active ? 'Active' : 'Inactive'}</span>
            </label>
          </td>
          <td>
            <strong>${escapeHtml(r.name)}</strong>
            ${r.description ? `<div class="muted quest-table-desc">${escapeHtml(r.description)}</div>` : ''}
          </td>
          <td>${required}</td>
          <td>${r.xpTeamwork || 0} / ${r.xpStudying || 0} / ${r.xpCollegeSuccess || 0}</td>
          <td><button type="button" class="btn btn-secondary btn-sm edit-raid-btn" data-id="${r.id}">Edit</button></td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('.edit-raid-btn').forEach((btn) => {
    btn.addEventListener('click', () => openRaidModal(btn.dataset.id, loadedRaids));
  });

  tbody.querySelectorAll('.raid-active-toggle').forEach((input) => {
    input.addEventListener('change', async () => {
      const raidId = input.dataset.id;
      const active = input.checked;
      input.disabled = true;
      try {
        await setRaidActive(raidId, active);
        const updated = await getAllRaids();
        renderRaids(updated);
        showToast(active ? 'Raid activated.' : 'Raid deactivated.');
      } catch (err) {
        input.checked = !active;
        input.disabled = false;
        showToast(err.message || 'Could not update raid.', 'error');
      }
    });
  });

  renderRaidProgress();
}

function renderRaidProgress() {
  const tbody = document.getElementById('raid-progress-body');
  if (!tbody) return;

  const activeRaids = loadedRaids.filter((r) => r.active !== false);
  if (!activeRaids.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No active raids.</td></tr>';
    return;
  }

  const rosterById = new Map(rosterStudents.map((s) => [s.id, s]));
  const rows = [];
  activeRaids.forEach((raid) => {
    CLASS_OPTIONS.forEach((cls) => {
      const required = raidRequiredParticipants(raid);
      const joined = uniqueRaidParticipantCount(raidParticipations, raid.id, cls.id);
      const people = raidParticipantsForClass(raidParticipations, raid.id, cls.id);
      const awarded = raidAwardForClass(raidAwards, raid.id, cls.id);
      const testers = rosterStudents.filter((s) => s.classId === cls.id && s.isTestStudent);
      const ready = !awarded && joined >= required;
      let status = 'In progress';
      if (awarded) status = 'Awarded';
      else if (ready) status = 'Ready for approval';

      const names = people.length
        ? people
            .map((p) => {
              const fromRoster = rosterById.get(p.userId);
              const label =
                fromRoster?.realName ||
                p.characterName ||
                fromRoster?.characterName ||
                'Student';
              return escapeHtml(label);
            })
            .join(', ')
        : '—';

      const actions = [];
      if (testers.length && !awarded) {
        actions.push(
          `<button type="button" class="btn btn-secondary btn-sm raid-test-join-btn" data-raid-id="${raid.id}" data-class-id="${cls.id}">Add test joins</button>`
        );
      }
      if (ready) {
        actions.push(
          `<button type="button" class="btn btn-success btn-sm approve-raid-btn" data-raid-id="${raid.id}" data-class-id="${cls.id}">Approve</button>`
        );
      }

      rows.push(`
        <tr class="${ready ? 'raid-ready' : ''}">
          <td>${escapeHtml(raid.name)}</td>
          <td>${escapeHtml(cls.name)}</td>
          <td>${joined} / ${required}</td>
          <td class="completion-answer">${names}</td>
          <td>${escapeHtml(status)}</td>
          <td><div class="row-actions">${actions.join('')}</div></td>
        </tr>
      `);
    });
  });

  tbody.innerHTML = rows.join('');

  tbody.querySelectorAll('.approve-raid-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleApproveRaid(btn.dataset.raidId, btn.dataset.classId));
  });
  tbody.querySelectorAll('.raid-test-join-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleTestRaidJoins(btn.dataset.raidId, btn.dataset.classId));
  });
}

async function refreshRaidInstructorState() {
  const [raids, parts, awards] = await Promise.all([getAllRaids(), getRaidParticipations(), getRaidAwards()]);
  raidParticipations = parts;
  raidAwards = awards;
  renderRaids(raids);
}

async function handleApproveRaid(raidId, classId) {
  const raid = loadedRaids.find((r) => r.id === raidId);
  const className = classLabel(classId);
  const classSize = rosterStudents.filter((s) => s.classId === classId).length;
  const label = raid?.name || 'this raid';
  if (!window.confirm(`Approve "${label}" for ${className}? ${classSize} student(s) will receive the XP.`)) return;

  const btn = document.querySelector(`.approve-raid-btn[data-raid-id="${raidId}"][data-class-id="${classId}"]`);
  if (btn) btn.disabled = true;
  try {
    const result = await approveRaidForClass(raidId, classId);
    showToast(`Raid approved. XP awarded to ${result.studentCount} student(s).`);
    await refreshRaidInstructorState();
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast(err.message || 'Could not approve raid.', 'error');
  }
}

async function handleTestRaidJoins(raidId, classId) {
  const btn = document.querySelector(`.raid-test-join-btn[data-raid-id="${raidId}"][data-class-id="${classId}"]`);
  if (btn) btn.disabled = true;
  try {
    const added = await joinRaidForTestStudents(raidId, classId);
    showToast(`Recorded ${added} test student join(s).`);
    raidParticipations = await getRaidParticipations();
    renderRaidProgress();
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast(err.message || 'Could not add test joins.', 'error');
  }
}

const raidModal = document.getElementById('raid-modal');
const raidForm = document.getElementById('raid-form');

function openRaidModal(raidId, raids) {
  document.getElementById('raid-modal-title').textContent = raidId ? 'Edit raid' : 'Add raid';
  document.getElementById('raid-id').value = raidId || '';

  if (raidId) {
    const r = raids.find((item) => item.id === raidId);
    if (!r) return;
    document.getElementById('raid-name').value = r.name || '';
    document.getElementById('raid-description').value = r.description || '';
    document.getElementById('raid-xp-teamwork').value = r.xpTeamwork || 0;
    document.getElementById('raid-xp-studying').value = r.xpStudying || 0;
    document.getElementById('raid-xp-college').value = r.xpCollegeSuccess || 0;
    document.getElementById('raid-required').value = raidRequiredParticipants(r);
    document.getElementById('raid-active').checked = r.active !== false;
  } else {
    raidForm.reset();
    document.getElementById('raid-active').checked = true;
    document.getElementById('raid-required').value = DEFAULT_RAID_PARTICIPANTS;
  }

  raidModal.classList.remove('hidden');
}

function closeRaidModal() {
  raidModal.classList.add('hidden');
}

document.getElementById('add-raid-btn').addEventListener('click', () => {
  openRaidModal(null, loadedRaids);
});
document.getElementById('cancel-raid').addEventListener('click', closeRaidModal);
raidModal.addEventListener('click', (e) => {
  if (e.target === raidModal) closeRaidModal();
});
raidForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raidId = document.getElementById('raid-id').value || null;
  const data = {
    name: document.getElementById('raid-name').value,
    description: document.getElementById('raid-description').value,
    xpTeamwork: document.getElementById('raid-xp-teamwork').value,
    xpStudying: document.getElementById('raid-xp-studying').value,
    xpCollegeSuccess: document.getElementById('raid-xp-college').value,
    requiredParticipants: document.getElementById('raid-required').value,
    active: document.getElementById('raid-active').checked,
  };
  try {
    await saveRaid(raidId, data);
    closeRaidModal();
    showToast('Raid saved.');
    loadedRaids = await getAllRaids();
    renderRaids(loadedRaids);
  } catch (err) {
    showToast(err.message || 'Could not save raid.', 'error');
  }
});

const rewardModal = document.getElementById('reward-modal');
const rewardForm = document.getElementById('reward-form');

function syncRewardModalFields() {
  const requiresText = document.getElementById('reward-requires-text').checked;
  const automated = document.getElementById('reward-automated').checked;
  const type = document.getElementById('reward-automated-type').value;
  document.getElementById('reward-text-prompt-group').hidden = !requiresText;
  document.getElementById('reward-automated-type-group').hidden = !automated;
  document.getElementById('reward-automated-xp-group').hidden = !(automated && type === 'addXpToClassmate');
  document.getElementById('reward-pool-group').hidden = automated;
}

function openRewardModal(rewardId, rewards) {
  document.getElementById('reward-modal-title').textContent = rewardId ? 'Edit reward' : 'Add reward';
  document.getElementById('reward-id').value = rewardId || '';

  if (rewardId) {
    const r = rewards.find((item) => item.id === rewardId);
    if (!r) return;
    document.getElementById('reward-name').value = r.name || '';
    document.getElementById('reward-description').value = r.description || '';
    document.getElementById('reward-active').checked = r.active !== false;
    document.getElementById('reward-requires-text').checked = Boolean(r.requiresText);
    document.getElementById('reward-text-prompt').value = r.textPrompt || '';
    document.getElementById('reward-automated').checked = Boolean(r.automated);
    document.getElementById('reward-automated-type').value = r.automatedType || '';
    document.getElementById('reward-automated-xp').value = Number(r.automatedXp) || 150;
    document.getElementById('reward-pool-size').value = rewardPoolSize(r);
  } else {
    rewardForm.reset();
    document.getElementById('reward-active').checked = true;
    document.getElementById('reward-requires-text').checked = false;
    document.getElementById('reward-automated').checked = false;
    document.getElementById('reward-automated-type').value = '';
    document.getElementById('reward-automated-xp').value = 150;
    document.getElementById('reward-pool-size').value = 0;
  }

  syncRewardModalFields();
  rewardModal.classList.remove('hidden');
}

function closeRewardModal() {
  rewardModal.classList.add('hidden');
}

document.getElementById('add-reward-btn').addEventListener('click', () => {
  openRewardModal(null, loadedRewards);
});
document.getElementById('cancel-reward').addEventListener('click', closeRewardModal);
rewardModal.addEventListener('click', (e) => {
  if (e.target === rewardModal) closeRewardModal();
});
document.getElementById('reward-requires-text').addEventListener('change', syncRewardModalFields);
document.getElementById('reward-automated').addEventListener('change', syncRewardModalFields);
document.getElementById('reward-automated-type').addEventListener('change', () => {
  if (document.getElementById('reward-automated-type').value) {
    document.getElementById('reward-automated').checked = true;
  }
  syncRewardModalFields();
});
rewardForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const rewardId = document.getElementById('reward-id').value || null;
  const data = {
    name: document.getElementById('reward-name').value,
    description: document.getElementById('reward-description').value,
    active: document.getElementById('reward-active').checked,
    requiresText: document.getElementById('reward-requires-text').checked,
    textPrompt: document.getElementById('reward-text-prompt').value,
    automated: document.getElementById('reward-automated').checked,
    automatedType: document.getElementById('reward-automated-type').value,
    automatedXp: document.getElementById('reward-automated-xp').value,
    poolSize: document.getElementById('reward-pool-size').value,
  };
  try {
    await saveReward(rewardId, data);
    closeRewardModal();
    showToast('Reward saved.');
    renderRewards(await getAllRewards());
  } catch (err) {
    showToast(err.message || 'Could not save reward.', 'error');
  }
});

const modal = document.getElementById('quest-modal');
const form = document.getElementById('quest-form');

function ensureQuestWeekPicks() {
  const mount = document.getElementById('quest-week-picks');
  if (!mount || mount.dataset.ready === '1') return mount;
  const n = typeof TERM_WEEK_COUNT === 'number' ? TERM_WEEK_COUNT : 11;
  mount.innerHTML = Array.from({ length: n }, (_, i) => {
    const week = i + 1;
    return `<label class="week-pick"><input type="checkbox" class="quest-week-pick" value="${week}" /> ${week}</label>`;
  }).join('');
  mount.dataset.ready = '1';
  return mount;
}

function syncQuestWeekPickState() {
  const every = document.getElementById('quest-every-week')?.checked;
  document.querySelectorAll('.quest-week-pick').forEach((input) => {
    input.disabled = Boolean(every);
    if (every) input.checked = false;
  });
}

function setQuestWeekPicks({ everyWeek, assignedWeeks }) {
  ensureQuestWeekPicks();
  const every = document.getElementById('quest-every-week');
  if (every) every.checked = Boolean(everyWeek);
  const weeks = normalizeAssignedWeeks(assignedWeeks);
  document.querySelectorAll('.quest-week-pick').forEach((input) => {
    input.checked = !everyWeek && weeks.includes(Number(input.value));
  });
  syncQuestWeekPickState();
}

function readQuestWeekPicks() {
  const everyWeek = Boolean(document.getElementById('quest-every-week')?.checked);
  const assignedWeeks = everyWeek
    ? []
    : [...document.querySelectorAll('.quest-week-pick:checked')].map((el) => Number(el.value));
  return { everyWeek, assignedWeeks };
}

function openQuestModal(questId, quests) {
  document.getElementById('quest-modal-title').textContent = questId ? 'Edit quest' : 'Add quest';
  document.getElementById('quest-id').value = questId || '';
  ensureQuestWeekPicks();

  if (questId) {
    const q = quests.find((item) => item.id === questId);
    if (!q) return;
    document.getElementById('quest-name').value = q.name || '';
    document.getElementById('quest-description').value = q.description || '';
    document.getElementById('quest-xp-teamwork').value = q.xpTeamwork || 0;
    document.getElementById('quest-xp-studying').value = q.xpStudying || 0;
    document.getElementById('quest-xp-college').value = q.xpCollegeSuccess || 0;
    document.getElementById('quest-active').checked = q.active !== false;
    document.getElementById('quest-one-time').checked = Boolean(q.oneTime);
    document.getElementById('quest-weekly').checked = Boolean(q.weekly) && !q.oneTime;
    document.getElementById('quest-requires-validation').checked = Boolean(q.requiresValidation);
    document.getElementById('quest-requires-text').checked = Boolean(q.requiresText);
    document.getElementById('quest-text-prompt').value = q.textPrompt || '';
    document.getElementById('quest-required-count').value = questRequiredCount(q);
    document.getElementById('quest-unique-days').checked = Boolean(q.requireUniqueDays);
    setQuestWeekPicks({
      everyWeek: q.scheduleKind === 'every-week' || (!q.scheduleKind && !(q.assignedWeeks || []).length),
      assignedWeeks: q.assignedWeeks,
    });
  } else {
    form.reset();
    document.getElementById('quest-active').checked = true;
    document.getElementById('quest-one-time').checked = false;
    document.getElementById('quest-weekly').checked = false;
    document.getElementById('quest-requires-validation').checked = false;
    document.getElementById('quest-requires-text').checked = false;
    document.getElementById('quest-required-count').value = 1;
    document.getElementById('quest-unique-days').checked = false;
    setQuestWeekPicks({ everyWeek: true, assignedWeeks: [] });
  }

  modal.classList.remove('hidden');
}

function closeQuestModal() {
  modal.classList.add('hidden');
}

document.getElementById('add-quest-btn').addEventListener('click', async () => {
  const quests = await getAllQuests();
  openQuestModal(null, quests);
});

document.getElementById('cancel-quest').addEventListener('click', closeQuestModal);
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeQuestModal();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const questId = document.getElementById('quest-id').value || null;
  const weekPicks = readQuestWeekPicks();
  const data = {
    name: document.getElementById('quest-name').value,
    description: document.getElementById('quest-description').value,
    xpTeamwork: document.getElementById('quest-xp-teamwork').value,
    xpStudying: document.getElementById('quest-xp-studying').value,
    xpCollegeSuccess: document.getElementById('quest-xp-college').value,
    active: document.getElementById('quest-active').checked,
    oneTime: document.getElementById('quest-one-time').checked,
    weekly: document.getElementById('quest-weekly').checked,
    everyWeek: weekPicks.everyWeek,
    assignedWeeks: weekPicks.assignedWeeks,
    requiresValidation: document.getElementById('quest-requires-validation').checked,
    requiresText: document.getElementById('quest-requires-text').checked,
    textPrompt: document.getElementById('quest-text-prompt').value,
    requiredCount: document.getElementById('quest-required-count').value,
    requireUniqueDays: document.getElementById('quest-unique-days').checked,
  };

  try {
    await saveQuest(questId, data);
    closeQuestModal();
    showToast('Quest saved.');
    const quests = await getAllQuests();
    renderQuests(quests);
  } catch (err) {
    showToast(err.message || 'Could not save quest.', 'error');
  }
});

document.getElementById('quest-one-time').addEventListener('change', (e) => {
  if (e.target.checked) document.getElementById('quest-weekly').checked = false;
});
document.getElementById('quest-weekly').addEventListener('change', (e) => {
  if (e.target.checked) document.getElementById('quest-one-time').checked = false;
});
document.getElementById('quest-every-week').addEventListener('change', syncQuestWeekPickState);

const studentModal = document.getElementById('student-modal');
const studentForm = document.getElementById('student-form');

function openStudentModal(studentId) {
  const student = studentsById[studentId];
  if (!student) return;
  document.getElementById('student-id').value = studentId;
  document.getElementById('student-real-name').textContent = student.realName
    ? student.realName
    : '(not provided — match via email or in person)';
  document.getElementById('student-character-name').value = student.characterName || '';
  fillClassSelect(document.getElementById('student-class-id'), student.classId, !student.classId);
  const xp = student.xp || emptyXp();
  document.getElementById('student-xp-teamwork').value = xp.teamwork || 0;
  document.getElementById('student-xp-studying').value = xp.studying || 0;
  document.getElementById('student-xp-college').value = xp.collegeSuccess || 0;
  document.getElementById('student-reward-keys').value = Math.max(0, Number(student.rewardKeys) || 0);
  studentModal.classList.remove('hidden');
}

function closeStudentModal() {
  studentModal.classList.add('hidden');
}

document.getElementById('cancel-student').addEventListener('click', closeStudentModal);
studentModal.addEventListener('click', (e) => {
  if (e.target === studentModal) closeStudentModal();
});

studentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const studentId = document.getElementById('student-id').value;
  try {
    await updateStudentByInstructor(studentId, {
      characterName: document.getElementById('student-character-name').value,
      classId: document.getElementById('student-class-id').value,
      xp: {
        teamwork: document.getElementById('student-xp-teamwork').value,
        studying: document.getElementById('student-xp-studying').value,
        collegeSuccess: document.getElementById('student-xp-college').value,
      },
      rewardKeys: document.getElementById('student-reward-keys').value,
    });
    closeStudentModal();
    showToast('Student saved.');
  } catch (err) {
    showToast(err.message || 'Could not save student.', 'error');
  }
});

async function init(user) {
  const session = await requireAuth({ allowedRoles: ['instructor'], user });
  if (!session) return;

  document.getElementById('instructor-name').textContent =
    session.profile.realName || session.user.email || 'Instructor';
  document.getElementById('sign-out').addEventListener('click', () => signOutUser());

  const classTab = document.getElementById('tab-class');
  const boardTab = document.getElementById('tab-leaderboard');
  const classView = document.getElementById('view-class');
  const boardView = document.getElementById('view-leaderboard');

  function showView(name) {
    const isBoard = name === 'leaderboard';
    classView.classList.toggle('hidden', isBoard);
    boardView.classList.toggle('hidden', !isBoard);
    classTab.classList.toggle('btn-primary', !isBoard);
    classTab.classList.toggle('btn-secondary', isBoard);
    boardTab.classList.toggle('btn-primary', isBoard);
    boardTab.classList.toggle('btn-secondary', !isBoard);
  }

  classTab.addEventListener('click', () => showView('class'));
  boardTab.addEventListener('click', () => showView('leaderboard'));

  await ensureClassesLoaded();
  renderClasses();
  leaderboardRefresh = startLeaderboard(session.profile);
  subscribeClasses(() => {
    renderClasses();
    refreshClassSelects();
    renderRaidProgress();
  });

  document.getElementById('seed-test-students-btn').addEventListener('click', async () => {
    const btn = document.getElementById('seed-test-students-btn');
    btn.disabled = true;
    try {
      const count = await seedTestStudents();
      showToast(`Ensured ${count} test students (5 per class).`);
    } catch (err) {
      showToast(err.message || 'Could not add test students.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('reload-quest-catalog-btn').addEventListener('click', async () => {
    const btn = document.getElementById('reload-quest-catalog-btn');
    btn.disabled = true;
    try {
      const result = await replaceQuestCatalog({ force: true });
      const quests = await getAllQuests();
      renderQuests(quests);
      await refreshRaidInstructorState();
      updateQuestCatalogWeekCopy();
      showToast(`Reloaded catalog: ${result.quests} quests, ${result.raids} raids.`);
    } catch (err) {
      showToast(err.message || 'Could not reload quest catalog.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  try {
    const result = await replaceQuestCatalog();
    if (!result.skipped) {
      showToast(`Loaded spreadsheet catalog: ${result.quests} quests, ${result.raids} raids.`);
    }
  } catch (err) {
    console.error('Could not apply quest catalog:', err);
    showToast(err.message || 'Could not load quest catalog.', 'error');
  }

  try {
    await seedTestRewards();
  } catch (err) {
    console.error('Could not seed test rewards:', err);
  }

  document.getElementById('seed-test-rewards-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('seed-test-rewards-btn');
    btn.disabled = true;
    try {
      const result = await seedRewards();
      renderRewards(await getAllRewards());
      showToast(`Reward catalog synced (${result.upserted} rewards).`);
    } catch (err) {
      showToast(err.message || 'Could not add test rewards.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  const quests = await getAllQuests();
  renderQuests(quests);
  updateQuestCatalogWeekCopy();
  await refreshRaidInstructorState();
  try {
    renderRewards(await getAllRewards());
  } catch (err) {
    console.error('Could not load rewards:', err);
    const tbody = document.getElementById('rewards-body');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Could not load rewards: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  subscribeCompletions(renderCompletions);
  subscribeRedemptions(renderRedemptions);
  subscribeRaidParticipations(async () => {
    raidParticipations = await getRaidParticipations();
    renderRaidProgress();
  });
  subscribeRaidAwards(async () => {
    raidAwards = await getRaidAwards();
    renderRaidProgress();
  });
  subscribeRaids(async () => {
    loadedRaids = await getAllRaids();
    renderRaids(loadedRaids);
  });

  subscribeRoster((students) => {
    renderStudents(students);
    publishRosterToLeaderboard(students).catch((err) =>
      console.error('Could not publish leaderboard data:', err)
    );
  });
}

onAuthReady((user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }
  init(user);
});
