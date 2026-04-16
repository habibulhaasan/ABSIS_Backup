// src/lib/googleDrive.js

const TOKEN_URL  = 'https://oauth2.googleapis.com/token';
const DRIVE_URL  = 'https://www.googleapis.com/drive/v3';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3';

let _cachedToken = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 60_000) return _cachedToken;

  const res  = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get access token: ' + JSON.stringify(data));

  _cachedToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return _cachedToken;
}

/** Create a folder in Google Drive. Returns the new folder's ID. */
export async function createDriveFolder(folderName, parentFolderId = null) {
  const token    = await getAccessToken();
  const metadata = { name: folderName, mimeType: 'application/vnd.google-apps.folder' };
  if (parentFolderId) metadata.parents = [parentFolderId];

  const res  = await fetch(`${DRIVE_URL}/files?fields=id`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(metadata),
  });
  const data = await res.json();
  if (!data.id) throw new Error('Failed to create Drive folder: ' + JSON.stringify(data));
  return data.id;
}

/** Upload a file to Google Drive inside a specific folder. */
export async function uploadToDrive(buffer, fileName, mimeType, folderId = null) {
  const token    = await getAccessToken();
  const metadata = { name: fileName, mimeType };
  if (folderId) metadata.parents = [folderId];

  const boundary  = '-------314159265358979323846';
  const metaPart  =
    `\r\n--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata);
  const bodyPart  =
    `\r\n--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;
  const closeDelim = `\r\n--${boundary}--`;

  const combined = Buffer.concat([
    Buffer.from(metaPart,    'utf8'),
    Buffer.from(bodyPart,    'utf8'),
    buffer,
    Buffer.from(closeDelim,  'utf8'),
  ]);

  const uploadRes = await fetch(
    `${UPLOAD_URL}/files?uploadType=multipart&fields=id,mimeType,size,webViewLink,thumbnailLink`,
    {
      method:  'POST',
      headers: {
        Authorization:    `Bearer ${token}`,
        'Content-Type':   `multipart/related; boundary="${boundary}"`,
        'Content-Length': combined.length,
      },
      body: combined,
    }
  );
  const file = await uploadRes.json();
  if (!file.id) throw new Error('Drive upload failed: ' + JSON.stringify(file));

  // Make publicly readable
  await fetch(`${DRIVE_URL}/files/${file.id}/permissions`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  // Re-fetch for final URLs
  const infoRes = await fetch(
    `${DRIVE_URL}/files/${file.id}?fields=id,mimeType,size,webContentLink,webViewLink,thumbnailLink`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const info = await infoRes.json();

  const viewUrl  = info.webContentLink
    || `https://drive.google.com/uc?export=download&id=${file.id}`;
  const thumbUrl = info.thumbnailLink
    ? info.thumbnailLink.replace(/=s\d+/, '=s400')
    : null;

  return {
    fileId:   file.id,
    mimeType: info.mimeType || mimeType,
    size:     parseInt(info.size || buffer.length),
    viewUrl,
    thumbUrl,
  };
}

/** Delete a file from Google Drive */
export async function deleteFromDrive(fileId) {
  const token = await getAccessToken();
  await fetch(`${DRIVE_URL}/files/${fileId}`, {
    method:  'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}
