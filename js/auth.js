/* global firebase, FIREBASE_CONFIG, INSTRUCTOR_EMAILS */

if (typeof FIREBASE_CONFIG === 'undefined') {
  console.error(
    'FIREBASE_CONFIG is missing. Make sure js/firebase-config.js is deployed and loads before auth.js.'
  );
} else {
  firebase.initializeApp(FIREBASE_CONFIG);
}

const auth = typeof firebase !== 'undefined' ? firebase.auth() : null;
const db = typeof firebase !== 'undefined' ? firebase.firestore() : null;
const googleProvider = typeof firebase !== 'undefined' ? new firebase.auth.GoogleAuthProvider() : null;
if (googleProvider) {
  googleProvider.setCustomParameters({ prompt: 'select_account' });
}
if (auth) {
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
}

function isInstructorEmail(email) {
  return (typeof INSTRUCTOR_EMAILS !== 'undefined' ? INSTRUCTOR_EMAILS : [])
    .map((e) => e.toLowerCase())
    .includes((email || '').toLowerCase());
}

function onAuthReady(callback) {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return auth.onAuthStateChanged(callback);
}

async function signInWithGoogle() {
  if (!auth || !googleProvider) {
    throw new Error('Firebase failed to load. Check js/firebase-config.js is on the server.');
  }
  try {
    await auth.signInWithPopup(googleProvider);
  } catch (err) {
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-closed-by-user') {
      throw err;
    }
    throw err;
  }
}

async function signOutUser() {
  await auth.signOut();
}

/** True when signup/onboarding is finished (real name is optional). */
function isOnboardingComplete(profile) {
  if (!profile || !profile.role) return false;
  if (profile.role === 'instructor') return true;
  return Boolean(profile.classId);
}

async function getPrivateProfile(uid) {
  try {
    const doc = await db.collection('privateProfiles').doc(uid).get();
    return doc.exists ? doc.data() : null;
  } catch (err) {
    return null;
  }
}

/**
 * Merge instructor-only identity fields onto a users doc.
 * Falls back to legacy fields still stored on users until migrated.
 */
function mergeIdentity(userData, privateData) {
  const priv = privateData || {};
  const realName = String(priv.realName ?? userData.realName ?? '').trim();
  return {
    ...userData,
    realName,
    email: priv.email || userData.email || '',
  };
}

async function getUserProfile(uid) {
  const doc = await db.collection('users').doc(uid).get();
  if (!doc.exists) return null;

  const data = { id: doc.id, ...doc.data() };
  const privateData = await getPrivateProfile(uid);
  const merged = mergeIdentity(data, privateData);

  // Migrate legacy realName/email off the shared users doc (own profile only).
  const isOwn = auth.currentUser && auth.currentUser.uid === uid;
  if (isOwn && (data.realName || data.email)) {
    const privPayload = {
      realName: merged.realName || '',
      email: merged.email || data.email || auth.currentUser.email || '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    try {
      await db.collection('privateProfiles').doc(uid).set(privPayload, { merge: true });
      await db.collection('users').doc(uid).update({
        realName: firebase.firestore.FieldValue.delete(),
        email: firebase.firestore.FieldValue.delete(),
      });
    } catch (err) {
      console.warn('Could not migrate private profile fields:', err);
    }
  }

  return merged;
}

/** Attach private realName/email onto student records (instructor roster). */
async function attachPrivateIdentities(students) {
  if (!students.length) return students;
  const snaps = await Promise.all(
    students.map((s) => db.collection('privateProfiles').doc(s.id).get().catch(() => null))
  );
  return students.map((s, i) => {
    const priv = snaps[i]?.exists ? snaps[i].data() : null;
    return mergeIdentity(s, priv);
  });
}

async function saveUserProfile(uid, { realName, characterName, email, classId, privacyAgreed }) {
  const existing = await getUserProfile(uid);
  const role = isInstructorEmail(email) ? 'instructor' : 'student';
  const trimmedReal = (realName || '').trim();
  const trimmedCharacter = (characterName || '').trim();

  const data = {
    characterName: trimmedCharacter,
    role,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  if (privacyAgreed) {
    data.privacyAgreedAt = firebase.firestore.FieldValue.serverTimestamp();
  }

  if (role === 'student') {
    data.classId = classId || '';
    data.className = classLabel(classId);
  }

  if (!existing) {
    data.xp = { teamwork: 0, studying: 0, collegeSuccess: 0 };
    data.frameTier = 0;
    data.badges = normalizeBadges({});
    data.rewardKeys = 0;
    data.rewardKeysEarned = 0;
    data.rewardChests = freshRewardChests();
    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
  }

  const privatePayload = {
    realName: trimmedReal,
    email: email || '',
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('privateProfiles').doc(uid).set(privatePayload, { merge: true });
  await db.collection('users').doc(uid).set(data, { merge: true });

  // Clear legacy PII fields if they still exist on users.
  try {
    await db.collection('users').doc(uid).update({
      realName: firebase.firestore.FieldValue.delete(),
      email: firebase.firestore.FieldValue.delete(),
    });
  } catch (err) {
    /* ignore if fields already absent */
  }

  if (role === 'student') {
    await syncPublicProfile(uid, {
      characterName: trimmedCharacter,
      xp: existing?.xp || data.xp,
      classId: data.classId,
      frameTier: existing?.frameTier ?? 0,
      badges: existing?.badges || data.badges,
    });
  }

  return getUserProfile(uid);
}

async function syncPublicProfile(uid, { characterName, xp, classId, frameTier, badges }) {
  const data = {
    characterName: characterName || '',
    classId: classId || '',
    className: classLabel(classId),
    xp: xp || emptyXp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  if (frameTier !== undefined) {
    data.frameTier = normalizeFrameTier(frameTier);
  }
  if (badges !== undefined) {
    data.badges = normalizeBadges(badges);
  }
  await db.collection('publicProfiles').doc(uid).set(data, { merge: true });
}

function redirectForRole(profile) {
  if (!isOnboardingComplete(profile)) return 'index.html';
  if (profile.role === 'instructor') return 'instructor-dashboard.html';
  return 'student-dashboard.html';
}

async function requireAuth(options = {}) {
  const { requireProfile = true, allowedRoles = null, user: passedUser = null } = options;
  const user = passedUser || auth.currentUser;
  if (!user) {
    window.location.href = 'index.html';
    return null;
  }

  const profile = await getUserProfile(user.uid);
  if (requireProfile && !isOnboardingComplete(profile)) {
    if (!window.location.pathname.endsWith('index.html')) {
      window.location.href = 'index.html';
    }
    return null;
  }

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    window.location.href = redirectForRole(profile);
    return null;
  }

  return { user, profile };
}
