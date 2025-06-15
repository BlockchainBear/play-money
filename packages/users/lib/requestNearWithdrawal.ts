import db from '@play-money/database';
import { executeTransaction, getBalance, getHouseAccount } from '@play-money/finance'; // Assuming getBalance and getHouseAccount exist
import Decimal from 'decimal.js';

// Define a reasonable minimum and maximum withdrawal amount in platform currency (e.g., PRIMARY currency units)
const MIN_WITHDRAWAL_AMOUNT = new Decimal(1); // e.g., 1 PRIMARY token
const MAX_WITHDRAWAL_AMOUNT = new Decimal(10000); // e.g., 10,000 PRIMARY tokens

export async function requestNearWithdrawal({
  userId,
  targetNearAccountId,
  amountPlatformCurrency, // Amount in the platform's primary currency units
}: {
  userId: string;
  targetNearAccountId: string; // User's external NEAR account
  amountPlatformCurrency: Decimal;
}) {
  console.log(`Requesting NEAR withdrawal for user ${userId} to ${targetNearAccountId} for ${amountPlatformCurrency.toString()} platform currency.`);

  // 1. Validate amount
  if (amountPlatformCurrency.isNaN() || amountPlatformCurrency.isLessThan(MIN_WITHDRAWAL_AMOUNT) || amountPlatformCurrency.isGreaterThan(MAX_WITHDRAWAL_AMOUNT)) {
    return { success: false, message: `Withdrawal amount must be between ${MIN_WITHDRAWAL_AMOUNT} and ${MAX_WITHDRAWAL_AMOUNT}.` };
  }

  // 2. Validate targetNearAccountId (basic validation)
  // A more thorough validation would check format (e.g., .near, .testnet, or 64 hex chars)
  if (!targetNearAccountId || targetNearAccountId.length < 2 || targetNearAccountId.length > 64) {
     return { success: false, message: 'Invalid target NEAR account ID format.'};
  }


  // 3. Check user's balance
  const user = await db.user.findUnique({ where: { id: userId }, include: { primaryAccount: true } });
  if (!user || !user.primaryAccount) {
    return { success: false, message: 'User or user primary account not found.' };
  }

  const userBalance = await getBalance({ accountId: user.primaryAccountId, assetType: 'CURRENCY', assetId: 'PRIMARY' });
  if (userBalance.total.lt(amountPlatformCurrency)) {
    return { success: false, message: 'Insufficient balance.' };
  }

  // 4. Debit user's platform balance via executeTransaction
  let platformDebitTx;
  try {
    const houseAccount = await getHouseAccount();
    const entries = [
      {
        fromAccountId: user.primaryAccountId,
        toAccountId: houseAccount.id, // Funds go to house/system account to be paid out
        assetType: 'CURRENCY' as const,
        assetId: 'PRIMARY',
        amount: amountPlatformCurrency,
      },
    ];

    platformDebitTx = await executeTransaction({
      type: 'PLATFORM_WITHDRAWAL',
      initiatorId: userId,
      entries,
    });
    console.log(`Internal platform withdrawal transaction ${platformDebitTx.id} created for user ${userId}.`);
  } catch (error) {
    console.error(`Failed to create internal debit transaction for withdrawal request by user ${userId}:`, error);
    return { success: false, message: 'Failed to process internal debit for withdrawal.' };
  }

  // 5. Create NearWithdrawal record
  try {
    // Convert platform currency amount to yoctoNEAR.
    // Assuming 1 unit of platform's PRIMARY currency = 1 NEAR. Adjust if different.
    const amountYoctoNear = amountPlatformCurrency.mul('1e24').toString();

    const nearWithdrawalRecord = await db.nearWithdrawal.create({
      data: {
        platformUserId: userId,
        platformTransactionId: platformDebitTx.id,
        targetNearAccountId,
        amountYoctoNear,
        status: 'PENDING', // Initial status
      },
    });
    console.log(`NearWithdrawal record ${nearWithdrawalRecord.id} created for user ${userId}.`);
    return { success: true, message: 'Withdrawal request submitted successfully.', withdrawalId: nearWithdrawalRecord.id };
  } catch (error) {
    console.error(`CRITICAL: Failed to create NearWithdrawal record for user ${userId} after internal debit ${platformDebitTx.id}. Error:`, error);
    // This is a critical state: user was debited, but withdrawal record failed. Needs manual intervention.
    // Consider trying to reverse the platformDebitTx or flagging for admin.
    return { success: false, message: 'Failed to record withdrawal request after internal debit. Please contact support.' };
  }
}
