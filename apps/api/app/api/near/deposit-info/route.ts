// apps/api/app/api/near/deposit-info/route.ts
import { NextResponse } from 'next/server';
import { getAuthUser } from '@play-money/auth'; // Assuming this is the way to get authenticated user
import db from '@play-money/database';

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const platformDepositAccountId = process.env.PLATFORM_NEAR_ACCOUNT_ID;

    if (!platformDepositAccountId) {
      console.error('PLATFORM_NEAR_ACCOUNT_ID is not set in environment variables.');
      return NextResponse.json({ error: 'Deposit information is currently unavailable.' }, { status: 503 });
    }

    return NextResponse.json({
      platformDepositAccountId,
      instructions: `Please ensure you have linked your depositing NEAR account ID in your user profile before sending funds. This is required to correctly associate the deposit with your account. Send only native NEAR to this address.`,
    });
  } catch (error) {
    console.error('Error fetching deposit info:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
