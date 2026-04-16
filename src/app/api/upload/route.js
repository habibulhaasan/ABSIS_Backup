// src/app/api/upload/route.js
import { NextResponse } from 'next/server';
import { uploadToDrive, createDriveFolder } from '@/lib/googleDrive';

export const maxDuration = 60;

export async function POST(req) {
  try {
    const formData       = await req.formData();
    const file           = formData.get('file');
    const orgId          = formData.get('orgId');
    const orgName        = formData.get('orgName');
    const existingFolder = formData.get('driveFolderId'); // from frontend if already saved

    if (!file)  return NextResponse.json({ error: 'No file provided' },  { status: 400 });
    if (!orgId) return NextResponse.json({ error: 'No orgId provided' }, { status: 400 });

    if (file.size > 50 * 1024 * 1024)
      return NextResponse.json({ error: 'File too large. Max 50 MB.' }, { status: 400 });

    const mimeType = file.type || 'application/octet-stream';
    const fileName = file.name || `upload-${Date.now()}`;
    const buffer   = Buffer.from(await file.arrayBuffer());

    // Use existing folder or create a new one
    let folderId     = existingFolder || null;
    let newFolderId  = null;

    if (!folderId) {
      const folderName = `${orgName || orgId} — Capital Sync Files`;
      folderId    = await createDriveFolder(folderName, process.env.GOOGLE_DRIVE_FOLDER_ID || null);
      newFolderId = folderId; // tell frontend to save this to Firestore
    }

    const result = await uploadToDrive(buffer, fileName, mimeType, folderId);

    return NextResponse.json({
      ...result,
      newDriveFolderId: newFolderId, // null if folder already existed
    });
  } catch (err) {
    console.error('[upload]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
