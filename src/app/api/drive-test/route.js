// src/app/api/drive-test/route.js  ← delete after confirmed working
import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import path from 'path';

export async function GET() {
  const results = {};
  results.folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || 'NOT SET';

  try {
    const auth  = new google.auth.GoogleAuth({
      keyFile: path.join(process.cwd(), 'service-account.json'),
      scopes:  ['https://www.googleapis.com/auth/drive'],
    });
    const drive = google.drive({ version: 'v3', auth });

    const folder = await drive.files.get({
      fileId: process.env.GOOGLE_DRIVE_FOLDER_ID,
      fields: 'id, name, mimeType',
    });

    results.authSuccess    = true;
    results.folderFound    = true;
    results.folderName     = folder.data.name;
    results.folderMimeType = folder.data.mimeType;
  } catch (err) {
    results.authSuccess = false;
    results.error       = err.message;
    results.errorCode   = err.code;
  }

  return NextResponse.json(results);
}
