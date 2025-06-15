import db from '@play-money/database';
import { connect, KeyPair, utils, transactions } from 'near-api-js';
import { Account } from 'near-api-js/lib/account'; // For Account type
import Decimal from 'decimal.js'; // Added for amount validation

// Environment variables for the platform's sending account
const NEAR_RPC_URL = process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org';
const PLATFORM_SENDER_ACCOUNT_ID = process.env.PLATFORM_NEAR_SENDER_ACCOUNT_ID; // e.g., your-platform-sender.testnet
const PLATFORM_SENDER_PRIVATE_KEY = process.env.PLATFORM_NEAR_SENDER_PRIVATE_KEY;

const MAX_PROCESSING_ATTEMPTS = 3;

async function getNearAccount(): Promise<Account> {
  if (!PLATFORM_SENDER_ACCOUNT_ID || !PLATFORM_SENDER_PRIVATE_KEY) {
    throw new Error('Platform sender account ID or private key is not configured in environment variables.');
  }

  const keyPair = KeyPair.fromString(PLATFORM_SENDER_PRIVATE_KEY);
  const keyStore = new utils.key_stores.InMemoryKeyStore();
  await keyStore.setKey('testnet', PLATFORM_SENDER_ACCOUNT_ID, keyPair); // Assuming testnet

  const config = {
    networkId: 'testnet', // Make configurable if supporting mainnet later
    keyStore,
    nodeUrl: NEAR_RPC_URL,
    walletUrl: 'https://wallet.testnet.near.org',
    helperUrl: 'https://helper.testnet.near.org',
    explorerUrl: 'https://explorer.testnet.near.org',
  };

  const near = await connect(config);
  return near.account(PLATFORM_SENDER_ACCOUNT_ID);
}

export async function processPendingWithdrawals() {
  console.log('Starting to process pending NEAR withdrawals...');

  if (!PLATFORM_SENDER_ACCOUNT_ID || !PLATFORM_SENDER_PRIVATE_KEY) {
    console.error('CRITICAL: Platform sender account ID or private key not configured. Cannot process withdrawals.');
    return;
  }

  const pendingWithdrawals = await db.nearWithdrawal.findMany({
    where: {
      status: 'PENDING',
      processingAttempts: { lt: MAX_PROCESSING_ATTEMPTS },
    },
    orderBy: { createdAt: 'asc' }, // Process oldest first
    take: 10, // Process in batches
  });

  if (pendingWithdrawals.length === 0) {
    console.log('No pending withdrawals to process.');
    return;
  }

  console.log(`Found ${pendingWithdrawals.length} pending withdrawals to process.`);
  const nearAccount = await getNearAccount();

  for (const withdrawal of pendingWithdrawals) {
    console.log(`Processing withdrawal ID: ${withdrawal.id} for user ${withdrawal.platformUserId} to ${withdrawal.targetNearAccountId}`);

    let updatedStatus: import('@prisma/client').WithdrawalStatus = withdrawal.status;
    let failureReason: string | null = null;
    let nearTxHash: string | null = null;

    try {
      await db.nearWithdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: 'PROCESSING',
          processingAttempts: withdrawal.processingAttempts + 1,
          lastAttemptAt: new Date(),
        },
      });

      const amountYocto = withdrawal.amountYoctoNear; // This is already a string in yoctoNEAR

      // Ensure amount is positive
      if (new Decimal(amountYocto).isNegative() || new Decimal(amountYocto).isZero()) {
         throw new Error('Withdrawal amount must be positive.');
      }

      const transferAction = transactions.transfer(amountYocto); // amountYocto is already a string
      const result = await nearAccount.signAndSendTransaction({
        receiverId: withdrawal.targetNearAccountId,
        actions: [transferAction],
      });

      // Query the transaction outcome
      const outcome = await nearAccount.connection.provider.txStatus(result.transaction.hash, nearAccount.accountId);

      // Check if the transaction was successful
      // The structure of outcome.status for a successful transaction includes a 'SuccessValue' key.
      // For failures, it might be 'Failure', or an object with 'Failure' key.
      if (typeof outcome.status === 'object' && 'SuccessValue' in outcome.status) {
         nearTxHash = result.transaction.hash;
         updatedStatus = 'COMPLETED';
         console.log(`Successfully sent ${amountYocto} yoctoNEAR to ${withdrawal.targetNearAccountId}. Tx hash: ${nearTxHash}`);
      } else {
         // Handle various failure cases from outcome.status
         console.error(`NEAR transaction failed for withdrawal ${withdrawal.id}. Status:`, outcome.status);
         // Attempt to serialize the failure status if it's an object
         const failureDetails = typeof outcome.status === 'object' ? JSON.stringify(outcome.status) : String(outcome.status);
         throw new Error(`NEAR transaction failed. Status: ${failureDetails}`);
      }

    } catch (error: any) {
      console.error(`Failed to process withdrawal ${withdrawal.id}:`, error);
      updatedStatus = 'FAILED';
      failureReason = error.message || 'Unknown error during processing.';
      if (withdrawal.processingAttempts + 1 >= MAX_PROCESSING_ATTEMPTS) {
        updatedStatus = 'REQUIRES_MANUAL_INTERVENTION';
        failureReason = `Max processing attempts reached. Last error: ${failureReason}`;
      }
    }

    await db.nearWithdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: updatedStatus,
        nearTransactionHash: nearTxHash,
        failureReason: failureReason,
      },
    });
    console.log(`Updated withdrawal ${withdrawal.id} status to ${updatedStatus}.`);
  }
  console.log('Finished processing batch of withdrawals.');
}
