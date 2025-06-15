// apps/api/app/api/user/platform-balance/route.ts
import { NextResponse, NextRequest } from 'next/server';
import { getAuthUser } from '@play-money/auth';
import db from '@play-money/database';
import { getBalance } from '@play-money/finance'; // Assuming this path is correct
import { AssetType } from '@prisma/client'; // Import Prisma's AssetType enum for validation
import Decimal from 'decimal.js';

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthUser();
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const assetIdQuery = searchParams.get('assetId');
    const assetTypeQuery = searchParams.get('assetType');

    const assetId = assetIdQuery || 'PRIMARY';
    const assetTypeInput = assetTypeQuery || 'CURRENCY';

    // Validate assetType against Prisma enum
    if (!Object.values(AssetType).includes(assetTypeInput as AssetType)) {
      return NextResponse.json({ error: 'Invalid assetType specified' }, { status: 400 });
    }
    const assetType = assetTypeInput as AssetType;

    // Fetch the user model to get their primaryAccountId
    // getAuthUser might not return the full User model with relations needed
    const user = await db.user.findUnique({
      where: { id: authUser.id },
      select: { primaryAccountId: true }
    });

    if (!user || !user.primaryAccountId) {
      // This case should ideally not happen for a valid, authenticated user if primaryAccountId is mandatory
      console.error(`User ${authUser.id} found, but primaryAccountId is missing.`);
      return NextResponse.json({ error: 'User primary account not configured.' }, { status: 404 });
    }

    const balance = await getBalance({
      accountId: user.primaryAccountId,
      assetId,
      assetType,
    });

    // getBalance returns an object like { total: Decimal, ...otherBalanceData }
    // Ensure the response format is consistent and user-friendly (e.g., string for total)
    return NextResponse.json({
      total: balance.total.toString(), // Convert Decimal to string
      assetId,
      assetType,
      // You could include other balance details if needed, e.g., subtotals
    });

  } catch (error) {
    console.error('Error fetching platform balance:', error);
    // Specific error for balance not found, if getBalance throws a custom error
    // For example, if getBalance might throw an error that should result in a 404 or a 0 balance response:
    // if (error.name === 'BalanceNotFoundError') { // Example custom error
    //   return NextResponse.json({ total: "0", assetId, assetType, message: "Balance not found for this asset." });
    // }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
