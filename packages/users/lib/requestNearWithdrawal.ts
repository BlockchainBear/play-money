import db from '@play-money/database';
import { executeTransaction, getBalance, getHouseAccount } from '@play-money/finance'; // Assuming getBalance and getHouseAccount exist
import Decimal from 'decimal.js';

// Define a reasonable minimum and maximum withdrawal amount in platform currency (e.g., PRIMARY currency units)
const MIN_WITHDRAWAL_AMOUNT_PLATFORM_UNITS = new Decimal(1);
const MAX_WITHDRAWAL_AMOUNT_PLATFORM_UNITS = new Decimal(10000);

// Function to get asset-specific details (could be expanded or moved to a config module)
function getAssetConfig(assetPlatformId: string) {
  const platformPrimaryAssetIdEnv = process.env.PLATFORM_PRIMARY_ASSET_ID || 'PRIMARY';
  const nearNativeDecimalsEnv = parseInt(process.env.NEAR_NATIVE_DECIMALS || '24', 10);

  const platformUsdcAssetIdEnv = process.env.PLATFORM_USDC_ASSET_ID || 'USDC';
  const usdcTokenDecimalsEnv = parseInt(process.env.USDC_TOKEN_DECIMALS_NEAR || '6', 10);

  if (assetPlatformId === platformPrimaryAssetIdEnv) { // Assuming this maps to native NEAR
    return { decimals: nearNativeDecimalsEnv, type: 'NATIVE_NEAR', platformAssetId: platformPrimaryAssetIdEnv };
  } else if (assetPlatformId === platformUsdcAssetIdEnv) {
    return { decimals: usdcTokenDecimalsEnv, type: 'NEP141_USDC', platformAssetId: platformUsdcAssetIdEnv };
  }
  return null; // Asset not configured for withdrawal
}

export async function requestNearWithdrawal({
  userId,
  targetNearAccountId,
  assetPlatformId, // New: e.g., "PRIMARY" or "USDC"
  amountPlatformCurrency, // Amount in the platform's units for the given assetPlatformId
}: {
  userId: string;
  targetNearAccountId: string;
  assetPlatformId: string;
  amountPlatformCurrency: Decimal;
}) {
  console.log(`Requesting withdrawal for user ${userId} to ${targetNearAccountId} of ${amountPlatformCurrency.toString()} ${assetPlatformId}.`);

  const assetConfig = getAssetConfig(assetPlatformId);
  if (!assetConfig) {
    return { success: false, message: `Withdrawals for asset ${assetPlatformId} are not configured.` };
  }

  // 1. Validate amount (using generic platform unit limits for now)
  if (amountPlatformCurrency.isNaN() || amountPlatformCurrency.isLessThan(MIN_WITHDRAWAL_AMOUNT_PLATFORM_UNITS) || amountPlatformCurrency.isGreaterThan(MAX_WITHDRAWAL_AMOUNT_PLATFORM_UNITS)) {
    return { success: false, message: `Withdrawal amount must be between ${MIN_WITHDRAWAL_AMOUNT_PLATFORM_UNITS} and ${MAX_WITHDRAWAL_AMOUNT_PLATFORM_UNITS} ${assetPlatformId}.` };
  }

  // 2. Validate targetNearAccountId (basic validation)
  // A more thorough validation would check format (e.g., .near, .testnet, or 64 hex chars)
  if (!targetNearAccountId || targetNearAccountId.length < 2 || targetNearAccountId.length > 64) {
     return { success: false, message: 'Invalid target NEAR account ID format.'};
  }

  // 3. Check user's balance for the specific asset
  const user = await db.user.findUnique({ where: { id: userId }, include: { primaryAccount: true } }); // Assuming primaryAccount holds all currency balances
  if (!user || !user.primaryAccount) {
    return { success: false, message: 'User or user primary account not found.' };
  }

  const userBalance = await getBalance({
      accountId: user.primaryAccountId,
      assetType: 'CURRENCY', // Assuming all withdrawable assets are CURRENCY type internally
      assetId: assetPlatformId
  });
  if (userBalance.total.lt(amountPlatformCurrency)) {
    return { success: false, message: `Insufficient ${assetPlatformId} balance. Available: ${userBalance.total.toString()}` };
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
        assetId: assetPlatformId, // Use the requested assetPlatformId
        amount: amountPlatformCurrency,
      },
    ];

    platformDebitTx = await executeTransaction({
      type: 'PLATFORM_WITHDRAWAL',
      initiatorId: userId,
      entries,
    });
    console.log(`Internal platform withdrawal transaction ${platformDebitTx.id} for ${assetPlatformId} created for user ${userId}.`);
  } catch (error: any) {
    console.error(`FINANCE_ERROR: Failed to create internal debit transaction for ${assetPlatformId} withdrawal by user ${userId}. Amount: ${amountPlatformCurrency.toString()}, Target: ${targetNearAccountId}. Error:`, error.message, error.stack);
    return { success: false, message: 'Failed to process internal debit for withdrawal.' };
  }

  // 5. Create NearWithdrawal record
  try {
    const amountRawUnits = amountPlatformCurrency.mul(new Decimal('1e' + assetConfig.decimals)).round().toString();

    const nearWithdrawalRecord = await db.nearWithdrawal.create({
      data: {
        platformUserId: userId,
        platformTransactionId: platformDebitTx.id,
        targetNearAccountId,
        assetPlatformId,    // Store this
        amountRawUnits,      // Store this (calculated based on asset's decimals)
        assetDecimals: assetConfig.decimals, // Store this
        status: 'PENDING',
      },
    });
    console.log(`NearWithdrawal record ${nearWithdrawalRecord.id} for ${assetPlatformId} created.`);
    return { success: true, message: 'Withdrawal request submitted successfully.', withdrawalId: nearWithdrawalRecord.id };
  } catch (error: any) {
    console.error(`CRITICAL_DB_ERROR: Failed to create NearWithdrawal record for user ${userId} (Asset: ${assetPlatformId}) after internal debit (Platform Tx: ${platformDebitTx.id}). Amount: ${amountPlatformCurrency.toString()}, Target: ${targetNearAccountId}. Error:`, error.message, error.stack);
    // TODO: Implement a mechanism to flag this platformDebitTx for review/reversal or flag the user's state.
    return { success: false, message: 'Failed to record withdrawal request after internal debit. Please contact support immediately.' };
  }
}
