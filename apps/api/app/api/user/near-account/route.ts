// apps/api/app/api/user/near-account/route.ts
import { NextResponse } from 'next/server';
import { getAuthUser } from '@play-money/auth';
import db from '@play-money/database';
import { z } from 'zod';

const linkAccountSchema = z.object({
  nearAccountId: z.string().min(2).max(64)
    .regex(/^(([a-z0-9]+[-_])*[a-z0-9]+\.)*([a-z0-9]+[-_])*[a-z0-9]+$/i, 'Invalid NEAR account format (e.g., yourname.near or yourname.testnet or a 64-char hex string)'),
    // Basic regex for NEAR accounts: allows sub-accounts and implicit accounts (.near, .testnet)
    // or 64-character hexadecimal string for implicit accounts not yet on chain.
});

export async function POST(req: Request) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const validation = linkAccountSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid input', details: validation.error.flatten() }, { status: 400 });
    }

    const { nearAccountId } = validation.data;

    // Optional: Check if another user already has this nearAccountId linked
    const existingLink = await db.user.findUnique({ where: { nearAccountId } });
    if (existingLink && existingLink.id !== user.id) {
        return NextResponse.json({ error: 'This NEAR account ID is already linked to another user.' }, { status: 409 });
    }

    await db.user.update({
      where: { id: user.id },
      data: { nearAccountId },
    });

    return NextResponse.json({ success: true, message: 'NEAR account linked successfully.' });
  } catch (error: any) {
    console.error('Error linking NEAR account:', error);
    if (error.code === 'P2002' && error.meta?.target?.includes('nearAccountId')) {
         // Prisma unique constraint violation
        return NextResponse.json({ error: 'This NEAR account ID is already linked to another user (P2002).' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // User object from getAuthUser might already have nearAccountId if it's refetched
    // Otherwise, fetch fresh from DB to be sure
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { nearAccountId: true },
    });

    return NextResponse.json({ nearAccountId: dbUser?.nearAccountId || null });
  } catch (error) {
    console.error('Error fetching user NEAR account:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
