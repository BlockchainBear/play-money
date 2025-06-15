// apps/api/app/api/near/withdrawals/route.ts
import { NextResponse } from 'next/server';
import { getAuthUser } from '@play-money/auth';
import db from '@play-money/database';
import { requestNearWithdrawal } from '@play-money/users/lib'; // Assuming path is correct
import { z } from 'zod';
import Decimal from 'decimal.js';

const withdrawalRequestSchema = z.object({
  targetNearAccountId: z.string().min(2).max(64)
    .regex(/^(([a-z0-9]+[-_])*[a-z0-9]+\.)*([a-z0-9]+[-_])*[a-z0-9]+$/i, 'Invalid target NEAR account format'),
  amount: z.string().refine((val) => {
    try {
      const d = new Decimal(val);
      return d.isFinite() && d.isPositive() && !d.isZero();
    } catch {
      return false;
    }
  }, { message: 'Amount must be a positive number string.' }),
  assetPlatformId: z.string().min(1), // e.g., "PRIMARY" or "USDC"
});

export async function POST(req: Request) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const validation = withdrawalRequestSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid input', details: validation.error.flatten() }, { status: 400 });
    }

    const { targetNearAccountId, amount, assetPlatformId } = validation.data; // Get new field
    const amountDecimal = new Decimal(amount);

    const result = await requestNearWithdrawal({
      userId: user.id,
      targetNearAccountId,
      assetPlatformId, // Pass it here
      amountPlatformCurrency: amountDecimal,
    });

    if (!result.success) {
      // Consider the type of error message from requestNearWithdrawal to set status
      // For example, insufficient balance might be 400, but a critical failure after debit could be 500.
      // For now, defaulting to 400 for client-side correctable errors or simple failures.
      return NextResponse.json({ error: result.message || 'Withdrawal request failed.' }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: result.message, withdrawalId: result.withdrawalId });
  } catch (error) {
    console.error('Error processing withdrawal request:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
