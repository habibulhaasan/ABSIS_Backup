// code.gs — Google Apps Script

// 🔹 EXISTING (keep your old one)
const ADMIN_BASE_FOLDER = "1xyyTho-yvJ-IEGCaNmxWyGjObZjkrdSU";

// 🔹 NEW (Profile files)
const PROFILE_BASE_FOLDER = "1SpfO1x07nIPdm1LObSjB-wsveFgoUmow";

const SECRET = "absis-secret-123";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.secret !== SECRET) {
      return jsonResponse({ success: false, error: "Unauthorized" });
    }

    switch (data.action) {

      // 🔹 EXISTING ADMIN FILES
      case "upload":
        return uploadFile(data);

      case "delete":
        return deleteFile(data);

      // 🔹 PROFILE FILES
      case "uploadProfileFile":
        return uploadProfileFile(data);

      // 🔹 LEGAL FILES
      case "uploadLegalFile":
        return uploadLegalFile(data);

      default:
        return jsonResponse({ success: false, error: "Invalid action" });
    }

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ─────────────────────────────────────────────
// 🔹 🔹 SHARED HELPERS (ROBUST FIX)
// ─────────────────────────────────────────────

// ✅ Standardized folder naming
function getMemberFolderName(memberId, name) {
  const safeName = (name || "Unknown")
    .trim()
    .replace(/\s+/g, '_');

  return `${memberId}_${safeName}`;
}

// ✅ Find or create user folder (single source of truth)
function getOrCreateUserFolder(baseFolder, memberId, name, existingFolderId) {
  let userFolder = null;

  // 1️⃣ Try using existing folderId (FAST PATH)
  if (existingFolderId) {
    try {
      userFolder = DriveApp.getFolderById(existingFolderId);
      return userFolder;
    } catch (e) {
      userFolder = null; // fallback if invalid
    }
  }

  // 2️⃣ Standardized folder name
  const folderName = getMemberFolderName(memberId, name);

  // 3️⃣ Try to find existing folder
  const existing = baseFolder.getFoldersByName(folderName);

  if (existing.hasNext()) {
    return existing.next();
  }

  // 4️⃣ Create new folder
  return baseFolder.createFolder(folderName);
}

// ─────────────────────────────────────────────
// 🔹 EXISTING (UNCHANGED)
// ─────────────────────────────────────────────
function uploadFile(data) {
  const folder = DriveApp.getFolderById(ADMIN_BASE_FOLDER);

  const blob = Utilities.newBlob(
    Utilities.base64Decode(data.file),
    data.mimeType,
    data.fileName
  );

  const file = folder.createFile(blob);

  return jsonResponse({
    success: true,
    fileId: file.getId(),
    url: file.getUrl(),
    name: file.getName(),
  });
}

function deleteFile(data) {
  const file = DriveApp.getFileById(data.fileId);
  file.setTrashed(true);
  return jsonResponse({ success: true });
}

// ─────────────────────────────────────────────
// ✅ PROFILE FILE HANDLER
// ─────────────────────────────────────────────
function uploadProfileFile(data) {

  const baseFolder = DriveApp.getFolderById(PROFILE_BASE_FOLDER);

  const userFolder = getOrCreateUserFolder(
    baseFolder,
    data.memberId,
    data.userName,
    data.userFolderId
  );

  // 🔹 File naming
  const safeName = data.userName.replace(/\s+/g, '_');

  let prefix = "FILE";
  switch (data.type) {
    case 'nid':          prefix = "NID";            break;
    case 'nomineeNid':   prefix = "Nominee-NID";    break;
    case 'nomineePhoto': prefix = "Nominee-Photo";  break;
    case 'other':        prefix = "Other";          break;
  }

  const ext = data.fileName.includes('.')
    ? data.fileName.split('.').pop()
    : '';

  const finalName = `${prefix}_${data.memberId}_${safeName}${ext ? '.' + ext : ''}`;

  const blob = Utilities.newBlob(
    Utilities.base64Decode(data.file),
    data.mimeType,
    finalName
  );

  const file = userFolder.createFile(blob);

  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return jsonResponse({
    success:  true,
    fileId:   file.getId(),
    url:      file.getUrl(),
    name:     file.getName(),
    folderId: userFolder.getId(),
  });
}

// ─────────────────────────────────────────────
// ✅ LEGAL FILE HANDLER
// ─────────────────────────────────────────────
function uploadLegalFile(data) {

  const baseFolder = DriveApp.getFolderById(PROFILE_BASE_FOLDER);

  const userFolder = getOrCreateUserFolder(
    baseFolder,
    data.memberId,
    data.memberName,
    data.userFolderId
  );

  // 🔹 File name already formatted from frontend
  const blob = Utilities.newBlob(
    Utilities.base64Decode(data.file),
    data.mimeType,
    data.fileName
  );

  const file = userFolder.createFile(blob);

  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return jsonResponse({
    success:  true,
    fileId:   file.getId(),
    url:      file.getUrl(),
    name:     file.getName(),
    folderId: userFolder.getId(),
  });
}

// ─────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}