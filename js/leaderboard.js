function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function displayName(student) {
  return student.characterName || 'Unnamed adventurer';
}

function renderLeaderboard(students) {
  const container = document.getElementById('leaderboard-body');
  if (!container) return;

  const ranked = [...students].sort((a, b) => totalXp(b) - totalXp(a));

  if (!ranked.length) {
    container.innerHTML = '<p class="empty-state">No classmates yet.</p>';
    return;
  }

  container.innerHTML = ranked
    .map((student, index) => {
      const rank = index + 1;
      const rankClass = rank <= 3 ? `rank rank-${rank}` : 'rank';
      const xp = student.xp || emptyXp();
      const total = totalXp(student);
      const frameClass = frameTierClass(student.frameTier);
      return `
        <div class="leaderboard-row-card ${frameClass}">
          <div class="leaderboard-row-grid">
            <span class="${rankClass}">${rank}</span>
            <span><strong>${escapeHtml(displayName(student))}</strong></span>
            <span>${total}</span>
            ${renderBadgeRow(student.badges, 'leaderboard-badges')}
            <span>L${levelFromXp(xp.teamwork || 0)} (${xp.teamwork || 0})</span>
            <span>L${levelFromXp(xp.studying || 0)} (${xp.studying || 0})</span>
            <span>L${levelFromXp(xp.collegeSuccess || 0)} (${xp.collegeSuccess || 0})</span>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderClassTotals(students) {
  const tbody = document.getElementById('class-totals-body');
  if (!tbody) return;

  const totals = CLASS_OPTIONS.map((course) => {
    const members = students.filter((s) => s.classId === course.id);
    const xp = members.reduce((sum, s) => sum + totalXp(s), 0);
    const signedUp = members.length;
    const rosterSize = classRosterSize(course.id);
    const scaledXp = scaledClassXp(xp, course.id);
    return { ...course, xp, signedUp, rosterSize, scaledXp };
  }).sort((a, b) => b.scaledXp - a.scaledXp || b.xp - a.xp);

  tbody.innerHTML = totals
    .map((row, index) => {
      const rank = index + 1;
      const rankClass = rank <= 3 ? `rank rank-${rank}` : 'rank';
      return `
        <tr>
          <td class="${rankClass}">${rank}</td>
          <td><strong>${escapeHtml(row.name)}</strong></td>
          <td>${row.signedUp} / ${row.rosterSize}</td>
          <td>${row.xp}</td>
          <td><strong>${row.scaledXp}</strong></td>
        </tr>
      `;
    })
    .join('');
}

function startLeaderboard(viewerProfile) {
  let selectedClassId =
    viewerProfile?.role === 'instructor'
      ? CLASS_OPTIONS[0]?.id || ''
      : viewerProfile?.classId || '';
  let latestStudents = [];

  const filter = document.getElementById('leaderboard-class-filter');
  if (filter) {
    fillClassSelect(filter, selectedClassId, false);
    filter.addEventListener('change', () => {
      selectedClassId = filter.value;
      renderLeaderboard(latestStudents.filter((s) => s.classId === selectedClassId));
    });
  }

  function refresh() {
    if (filter) {
      if (!CLASS_OPTIONS.some((c) => c.id === selectedClassId)) {
        selectedClassId = CLASS_OPTIONS[0]?.id || '';
      }
      fillClassSelect(filter, selectedClassId, false);
    }
    renderClassTotals(latestStudents);
    renderLeaderboard(latestStudents.filter((s) => s.classId === selectedClassId));
  }

  subscribeStudents((students) => {
    latestStudents = students;
    refresh();
  });

  return refresh;
}

async function initLeaderboardPage(user) {
  const session = await requireAuth({ allowedRoles: ['student', 'instructor'], user });
  if (!session) return;

  await ensureClassesLoaded();

  const dashboardLink = document.getElementById('dashboard-link');
  if (dashboardLink) {
    dashboardLink.href =
      session.profile.role === 'instructor' ? 'instructor-dashboard.html' : 'student-dashboard.html';
  }

  document.getElementById('sign-out')?.addEventListener('click', () => signOutUser());
  const refresh = startLeaderboard(session.profile);
  subscribeClasses(() => refresh());
}

if (document.body?.dataset.page === 'leaderboard') {
  onAuthReady((user) => {
    if (!user) {
      window.location.href = 'index.html';
      return;
    }
    initLeaderboardPage(user);
  });
}
