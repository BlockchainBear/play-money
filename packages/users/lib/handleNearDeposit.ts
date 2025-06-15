import db from '@play-money/database';
import Decimal from 'decimal.js';
import { executeTransaction, getHouseAccount } from '@play-money/finance';
// import { creditUserBalance } from '@play-money/finance'; // Placeholder for actual crediting function

export async function handleNearDeposit({
  nearSenderAccountId,
  amountYoctoNear,
  nearTransactionHash,
}: {
  nearSenderAccountId: string;
  amountYoctoNear: string; // Stored as string, can be converted to Decimal for calculations
  nearTransactionHash: string;
}) {
  console.log(`Handling deposit: ${nearTransactionHash} from ${nearSenderAccountId} for ${amountYoctoNear} yoctoNEAR`);

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
  try {
    await db.nearDeposit.create({
      data: {
        nearTransactionHash,
        nearAccountId: nearSenderAccountId,
        amountYoctoNear,
        platformUserId: user.id,
      },
    });
    console.log(`Recorded NearDeposit for tx ${nearTransactionHash}`);
  } catch (error) {
    console.error(`Failed to record NearDeposit for tx ${nearTransactionHash}:`, error);
    // If this fails (e.g., DB error), we should not proceed to credit the user.
    return { success: false, message: 'Failed to record deposit transaction' };
  }

  // 4. Credit the user's internal platform balance
  try {
    const houseAccount = await getHouseAccount();
    // Assuming PRIMARY currency has same precision as NEAR (e.g. 1 unit = 1 NEAR)
    // If PRIMARY has different decimals, adjust conversion.
    const depositAmountDecimal = new Decimal(amountYoctoNear).div('1e24');

    if (depositAmountDecimal.isZero() || depositAmountDecimal.isNegative()) {
      console.warn(`Attempted to deposit zero or negative amount for tx ${nearTransactionHash}. Amount: ${depositAmountDecimal.toString()}`);
      return { success: false, message: 'Deposit amount must be positive.' };
    }

    const entries = [
      {
        fromAccountId: houseAccount.id,
        toAccountId: user.primaryAccountId, // User's main balance account
        assetType: 'CURRENCY' as const,
        assetId: 'PRIMARY', // Assuming deposit goes into primary currency
        amount: depositAmountDecimal,
      },
    ];

    const financeTransaction = await executeTransaction({
      type: 'PLATFORM_DEPOSIT', // The new transaction type
      initiatorId: user.id,
      entries,
    });

    console.log(`User ${user.id} credited successfully via transaction ${financeTransaction.id} for Near deposit ${nearTransactionHash}.`);
  } catch (creditError) {
    console.error(`CRITICAL: Failed to credit user ${user.id} for Near deposit ${nearTransactionHash} after recording deposit. Error:`, creditError);
    // This is a critical state. The deposit is recorded, but crediting failed.
    // Manual intervention or an automated reconciliation process is needed.
    return { success: false, message: 'Crediting user balance failed after recording deposit.' };
  }

  console.log(`Successfully processed deposit ${nearTransactionHash} for user ${user.id}`);
  return { success: true, message: 'Deposit processed successfully' };
}
