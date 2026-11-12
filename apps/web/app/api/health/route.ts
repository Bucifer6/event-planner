import { NextResponse } from 'next/server';
import { prisma } from '@eventdesk/db';

// Health endpoint feeding deploy health checks and rollback (DEP4/DEP5, LAU5).
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
