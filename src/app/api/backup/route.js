// src/app/api/backup/route.js
import { NextResponse } from 'next/server';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// ── Firebase Admin init ───────────────────────────────────────────────────────
function getAdminDb() {
  if (!getApps().length) {
    // Vercel mangles \n in private keys — this handles all cases
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ?.replace(/\\n/g, '\n')   // literal \n → real newline
      ?.replace(/^"|"$/g, '');  // strip surrounding quotes if any

    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });
  }
  return getFirestore();
}

const ORG_ID = 'org_1775011423121';

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchCollection(db, ...pathSegments) {
  try {
    const ref  = db.collection(pathSegments.join('/'));
    const snap = await ref.get();
    return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
  } catch { return []; }
}

// ── GET /api/backup ───────────────────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  if (secret !== process.env.BACKUP_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();

    const COLLECTIONS = [
      'members', 'investments', 'entryFees', 'expenses', 'investmentProjects',
      'profitDistributions', 'loans', 'memoranda', 'specialSubscriptions',
      'notifications', 'files', 'income', 'assets', 'penalties',
    ];

    // Fetch org doc
    const orgSnap = await db.collection('organizations').doc(ORG_ID).get();
    const orgData = orgSnap.exists ? orgSnap.data() : {};

    // Fetch all collections in parallel
    const colResults = await Promise.all(
      COLLECTIONS.map(col =>
        fetchCollection(db, 'organizations', ORG_ID, col)
          .then(docs => [col, docs])
      )
    );

    const collections = Object.fromEntries(colResults);

    // Fetch investmentProject subcollections
    const projects = collections['investmentProjects'] || [];
    await Promise.all(projects.map(async proj => {
      for (const sub of ['returns', 'projectExpenses']) {
        const docs = await fetchCollection(
          db, 'organizations', ORG_ID, 'investmentProjects', proj._id, sub
        );
        if (docs.length) {
          collections[`investmentProjects/${proj._id}/${sub}`] = docs;
        }
      }
    }));

    // Fetch user profiles for all members
    const memberDocs = collections['members'] || [];
    const userProfiles = {};
    await Promise.all(memberDocs.map(async m => {
      try {
        const uSnap = await db.collection('users').doc(m._id).get();
        if (uSnap.exists) userProfiles[m._id] = uSnap.data();
      } catch {}
    }));

    const backup = {
      _meta: {
        orgId:       ORG_ID,
        exportedAt:  new Date().toISOString(),
        exportedBy:  'auto-backup',
        version:     '1.0',
        collections: COLLECTIONS,
      },
      org: orgData,
      collections,
      userProfiles,
    };

    const json      = JSON.stringify(backup);
    const sizeBytes = Buffer.byteLength(json, 'utf8');
    const fileName  = `${ORG_ID}_BACKUP_${new Date().toISOString().slice(0, 10)}.json`;

    // Write backup metadata to Firestore (Apps Script will update driveFileId/driveUrl after upload)
    const backupRef = await db
      .collection('organizations').doc(ORG_ID)
      .collection('backups').add({
        fileName,
        driveFileId:  '',
        driveUrl:     '',
        createdAt:    Timestamp.now(),
        status:       'success',
        triggeredBy:  searchParams.get('manual') === '1' ? 'manual' : 'auto',
        sizeBytes,
      });

    return NextResponse.json({
      ok:        true,
      backupId:  backupRef.id,
      fileName,
      sizeBytes,
      data:      backup,
    });

  } catch (e) {
    console.error('Backup API error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ── PATCH /api/backup  — called by Apps Script to save driveFileId + driveUrl ─
export async function PATCH(request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  if (secret !== process.env.BACKUP_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { backupId, driveFileId, driveUrl } = await request.json();
    if (!backupId) return NextResponse.json({ error: 'Missing backupId' }, { status: 400 });

    const db = getAdminDb();
    await db
      .collection('organizations').doc(ORG_ID)
      .collection('backups').doc(backupId)
      .update({ driveFileId, driveUrl });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}