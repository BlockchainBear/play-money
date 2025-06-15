import db from '@play-money/database';
import Decimal from 'decimal.js';
import { executeTransaction, getHouseAccount } from '@play-money/finance';
// import { creditUserBalance } from '@play-money/finance'; // Placeholder for actual crediting function

// Access env vars
const platformPrimaryAssetId = process.env.PLATFORM_PRIMARY_ASSET_ID || 'PRIMARY';
const nearNativeDecimals = parseInt(process.env.NEAR_NATIVE_DECIMALS || '24', 10);
const nearDecimalDivisor = new Decimal('1e' + nearNativeDecimals);

export async function handleNearDeposit({
  nearSenderAccountId,
  amountRawUnits, // Renamed from amountYoctoNear in previous plan, ensure consistency
  assetPlatformId,
  assetDecimals,
  nearTransactionHash,
  memo, // New parameter
}: {
  nearSenderAccountId: string;
  amountRawUnits: string;
  assetPlatformId: string;
  assetDecimals: number;
  nearTransactionHash: string;
  memo?: string | null; // Optional memo
}) {
  console.log(`Handling deposit: ${nearTransactionHash} from ${nearSenderAccountId} for ${amountRawUnits} raw units of ${assetPlatformId} (decimals: ${assetDecimals}), Memo: ${memo}`);

  // 1. Check if this transaction has already been processed
  const existingDeposit = await db.nearDeposit.findUnique({
    where: { nearTransactionHash },
  });

  if (existingDeposit) {
    console.warn(`Deposit ${nearTransactionHash} already processed.`);
    return { success: false, message: 'Deposit already processed' };
  }

  // 2. Find the user by their linked Near account ID
  // This assumes the user has already linked their nearAccountId in their profile.
  // If not, this step will fail to find a user.
  const user = await db.user.findUnique({
    where: { nearAccountId: nearSenderAccountId },
  });

  if (!user) {
    console.warn(`No user found with linked nearAccountId: ${nearSenderAccountId} for tx ${nearTransactionHash}`);
    // TODO: Implement a system for handling deposits from unlinked accounts.
    // This might involve creating a temporary record and allowing users to claim it.
    return { success: false, message: 'User not found or Near account not linked' };
  }

  // 3. Record the deposit (before attempting to credit, to ensure idempotency)
  let newDepositRecord; // To capture the created record for logging if needed
  try {
    newDepositRecord = await db.nearDeposit.create({
      data: {
        nearTransactionHash,
        nearAccountId: nearSenderAccountId,
        assetPlatformId, // Store this
        amountRawUnits,   // Store this
        assetDecimals,    // Store this
        memo,             // Store this
        platformUserId: user.id,
      },
    });
    console.log(`Recorded NearDeposit ${newDepositRecord.id} for tx ${nearTransactionHash}`);
  } catch (error: any) {
    console.error(`CRITICAL_DB_ERROR: Failed to record NearDeposit for tx ${nearTransactionHash}. User: ${user?.id}, Sender: ${nearSenderAccountId}, Asset: ${assetPlatformId}. Error:`, error.message, error.stack);
    return { success: false, message: 'Failed to record deposit transaction due to database error.' };
  }

  // 4. Credit the user's internal platform balance
  // This variable needs to be accessible in the catch block for logging
  let entries;
  try {
    const houseAccount = await getHouseAccount();
    const depositAmountDecimal = new Decimal(amountRawUnits).div(new Decimal('1e' + assetDecimals));

    if (depositAmountDecimal.isZero() || depositAmountDecimal.isNegative()) {
      console.warn(`Attempted to deposit zero or negative amount for ${assetPlatformId} tx ${nearTransactionHash}. Amount: ${depositAmountDecimal.toString()}`);
      // TODO: Consider if this should be a critical error that needs manual review, as deposit was recorded.
      // For now, we stop here and don't credit. The NearDeposit record exists.
      return { success: false, message: 'Deposit amount resolves to zero or negative after considering decimals.' };
    }

    entries = [
      {
        fromAccountId: houseAccount.id,
        toAccountId: user.primaryAccountId, // User's main balance account
        assetType: 'CURRENCY' as const, // Assuming all NEP-141s and native map to CURRENCY type internally for now
        assetId: assetPlatformId,      // Use the dynamic assetPlatformId
        amount: depositAmountDecimal,
      },
    ];

    const financeTransaction = await executeTransaction({
      type: 'PLATFORM_DEPOSIT', // The new transaction type
      initiatorId: user.id,
      entries,
    });

    console.log(`User ${user.id} credited ${depositAmountDecimal.toString()} of ${assetPlatformId} via platform transaction ${financeTransaction.id} for Near deposit ${newDepositRecord.id}.`);
  } catch (creditError: any) {
    console.error(`CRITICAL_FINANCE_ERROR: Failed to credit user ${user.id} (Near Acc: ${nearSenderAccountId}) for ${assetPlatformId} deposit ${newDepositRecord.id} after recording. Platform Tx entries: ${JSON.stringify(entries)}. Error:`, creditError.message, creditError.stack);
    // TODO: Implement a mechanism to flag this NearDeposit record for manual review/reconciliation.
    // e.g., await db.nearDeposit.update({ where: { id: newDepositRecord.id }, data: { needsManualReview: true, reviewReason: 'Credit failed' } });
    return { success: false, message: 'Crediting user balance failed after recording deposit. Please contact support.' };
  }

  console.log(`Successfully processed deposit ${nearTransactionHash} for user ${user.id} (Asset: ${assetPlatformId}, Amount Raw: ${amountRawUnits})`);
  return { success: true, message: 'Deposit processed successfully' };
}
