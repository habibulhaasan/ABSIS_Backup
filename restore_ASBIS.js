// ─────────────────────────────────────────────────────────────────
// ABSIS Capital Sync — Organization Data Restore Script
// Organization: ASBIS
// Org ID:       org_1775011423121
//
// USAGE:
//   1. Install dependencies:
//        npm install firebase-admin
//
//   2. Download your Firebase service account key:
//        Firebase Console → Project Settings → Service Accounts
//        → Generate new private key → save as serviceAccountKey.json
//
//   3. Place this file, serviceAccountKey.json, and the backup .json
//      in the same folder.
//
//   4. Run:
//        node restore_ASBIS.js path/to/backup.json
//
//   ⚠️  WARNING: This script OVERWRITES existing data in the target org.
//       Run on a test project first if unsure.
// ─────────────────────────────────────────────────────────────────

const admin  = require('firebase-admin');
const fs     = require('fs');
const path   = require('path');

// ── Init ──────────────────────────────────────────────────────────
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ── Helpers ───────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Convert plain objects back to Firestore-compatible values
// (handles timestamps stored as { seconds, nanoseconds })
function toFirestoreValue(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'object' && !Array.isArray(val)) {
    if (typeof val.seconds === 'number' && typeof val.nanoseconds === 'number') {
      return new admin.firestore.Timestamp(val.seconds, val.nanoseconds);
    }
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = toFirestoreValue(v);
    }
    return out;
  }
  if (Array.isArray(val)) return val.map(toFirestoreValue);
  return val;
}

// Write docs in batches of 499 (Firestore limit = 500 ops/batch)
async function batchWrite(colRef, docs) {
  const BATCH_SIZE = 499;
  let written = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + BATCH_SIZE);
    for (const docData of chunk) {
      const { _id, ...rest } = docData;
      const ref = _id ? colRef.doc(_id) : colRef.doc();
      batch.set(ref, toFirestoreValue(rest), { merge: false });
    }
    await batch.commit();
    written += chunk.length;
    process.stdout.write(`  ✓ ${written}/${docs.length} docs`);
    await sleep(200); // avoid rate limits
  }
  console.log(`  ✓ ${written} docs written`);
}

// ── Main restore ──────────────────────────────────────────────────
async function restore() {
  const backupPath = process.argv[2];
  if (!backupPath) {
    console.error('Usage: node restore.js path/to/backup.json');
    process.exit(1);
  }

  console.log('
📂 Loading backup file…');
  const raw    = fs.readFileSync(path.resolve(backupPath), 'utf8');
  const backup = JSON.parse(raw);

  console.log(`
📋 Backup info:`);
  console.log(`   Org:       ${backup._meta?.orgName}`);
  console.log(`   Org ID:    ${backup._meta?.orgId}`);
  console.log(`   Exported:  ${backup._meta?.exportedAt}`);
  console.log(`   By:        ${backup._meta?.exportedBy}`);

  const targetOrgId = backup._meta?.orgId || 'org_1775011423121';
  console.log(`
🎯 Target org ID: ${targetOrgId}`);

  // Confirm before proceeding
  const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => {
    readline.question('
⚠️  This will OVERWRITE all existing data. Type YES to continue: ', answer => {
      readline.close();
      if (answer.trim() !== 'YES') {
        console.log('Aborted.');
        process.exit(0);
      }
      resolve();
    });
  });

  // ── Restore org document ───────────────────────────────────────
  if (backup.org) {
    console.log('
📝 Restoring org settings…');
    await db.collection('organizations').doc(targetOrgId).set(
      toFirestoreValue(backup.org), { merge: true }
    );
    console.log('   ✓ Org document updated');
  }

  // ── Restore collections ────────────────────────────────────────
  const cols = backup.collections || {};
  const topLevel = Object.keys(cols).filter(k => !k.includes('/'));

  for (const col of topLevel) {
    const docs = cols[col];
    if (!docs || docs.length === 0) {
      console.log(`
⏭  Skipping ${col} (empty)`);
      continue;
    }
    console.log(`
📦 Restoring ${col} (${docs.length} docs)…`);
    const colRef = db.collection('organizations').doc(targetOrgId).collection(col);
    await batchWrite(colRef, docs);
  }

  // ── Restore investmentProject subcollections ───────────────────
  const subKeys = Object.keys(cols).filter(k => k.includes('/'));
  for (const key of subKeys) {
    const docs = cols[key];
    if (!docs || docs.length === 0) continue;
    const parts  = key.split('/'); // e.g. ['investmentProjects', 'projId', 'returns']
    const colRef = db.collection('organizations').doc(targetOrgId)
      .collection(parts[0]).doc(parts[1]).collection(parts[2]);
    console.log(`
📦 Restoring ${key} (${docs.length} docs)…`);
    await batchWrite(colRef, docs);
  }

  // ── Restore user profiles ──────────────────────────────────────
  const userProfiles = backup.userProfiles || {};
  const userIds      = Object.keys(userProfiles);
  if (userIds.length > 0) {
    console.log(`
👤 Restoring ${userIds.length} user profiles…`);
    const BATCH_SIZE = 499;
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = db.batch();
      userIds.slice(i, i + BATCH_SIZE).forEach(uid => {
        batch.set(
          db.collection('users').doc(uid),
          toFirestoreValue(userProfiles[uid]),
          { merge: true }
        );
      });
      await batch.commit();
      await sleep(200);
    }
    console.log(`   ✓ ${userIds.length} user profiles restored`);
  }

  console.log(`
✅ Restore complete! Organization data has been restored.`);
  console.log(`   Org ID: ${targetOrgId}`);
  process.exit(0);
}

restore().catch(e => {
  console.error('
❌ Restore failed:', e.message);
  process.exit(1);
});
