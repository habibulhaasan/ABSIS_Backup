const GAS_URL = "YOUR_WEB_APP_URL";
const SECRET = "absis-secret-123";

// 🔹 Convert file → base64
function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
  });
}

// 🔹 Upload (GAS)
export async function uploadFileToGAS(file) {
  const base64 = await toBase64(file);

  const res = await fetch(GAS_URL, {
    method: "POST",
    body: JSON.stringify({
      action: "upload",
      secret: SECRET,
      file: base64.split(",")[1],
      fileName: file.name,
      mimeType: file.type,
    }),
  });

  return await res.json();
}

// 🔹 Delete (GAS)
export async function deleteFileFromGAS(fileId) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    body: JSON.stringify({
      action: "delete",
      secret: SECRET,
      fileId,
    }),
  });

  return await res.json();
}