// apps/api/app/api/near/transactions/route.ts
import { NextResponse } from 'next/server';
import { getAuthUser } from '@play-money/auth';
import db from '@play-money/database';
import { NextRequest } from 'next/server';
import Decimal from 'decimal.js'; // Import Decimal

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const deposits = await db.nearDeposit.findMany({
      where: { platformUserId: user.id },
      orderBy: { createdAt: 'desc' },
      // We fetch all and paginate after merging for now, to ensure correct overall order.
      // For very large datasets, cursor-based pagination on a combined view/query would be better.
      // take: limit,
      // skip: offset,
    });

    const withdrawals = await db.nearWithdrawal.findMany({
      where: { platformUserId: user.id },
      orderBy: { createdAt: 'desc' },
      // take: limit,
      // skip: offset,
    });

    const formattedDeposits = deposits.map(d => ({
      id: d.id,
      type: 'deposit' as const,
      status: 'COMPLETED' as const, // Deposits are generally considered completed once recorded by monitor
      amount: new Decimal(d.amountRawUnits).div(new Decimal('1e' + d.assetDecimals)).toString(), // Use assetDecimals
      currency: d.assetPlatformId, // Use assetPlatformId as currency code
      nearAccountId: d.nearAccountId, // Sender
      nearTransactionHash: d.nearTransactionHash,
      memo: d.memo, // Include memo if it exists on the model
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));

    const formattedWithdrawals = withdrawals.map(w => ({
      id: w.id,
      type: 'withdrawal' as const,
      status: w.status,
      amount: new Decimal(w.amountRawUnits).div(new Decimal('1e' + w.assetDecimals)).toString(), // Use assetDecimals
      currency: w.assetPlatformId, // Use assetPlatformId as currency code
      nearAccountId: w.targetNearAccountId, // Recipient
      nearTransactionHash: w.nearTransactionHash,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
      failureReason: w.failureReason,
    }));

    // Combine, sort, and then apply pagination
    // TODO: For users with extremely large transaction volumes,
    // this in-memory sort and slice can be memory intensive.
    // A more scalable solution would involve a raw SQL query with
    // DB-level UNION ALL, ORDER BY, LIMIT, and OFFSET.
    const combinedTransactions = [...formattedDeposits, ...formattedWithdrawals]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit);

    // Get total counts for pagination metadata
    // These counts are for all records, not just the paginated slice.
    const totalDeposits = deposits.length; // Count from already fetched full list
    const totalWithdrawals = withdrawals.length; // Count from already fetched full list
    const totalCount = totalDeposits + totalWithdrawals;


    return NextResponse.json({
        data: combinedTransactions,
        pagination: {
            offset,
            limit,
            totalCount,
        }
    });
  } catch (error) {
    console.error('Error fetching NEAR transactions:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
