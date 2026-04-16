// src/app/api/files/delete/route.js

import { NextResponse } from 'next/server';
import { deleteFromDrive } from '@/lib/googleDrive';

export async function DELETE(req) {
  try {
    const { fileId } = await req.json();
    if (!fileId) return NextResponse.json({ error: 'No fileId' }, { status: 400 });

    await deleteFromDrive(fileId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[delete]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
