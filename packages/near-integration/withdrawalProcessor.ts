import db from '@play-money/database';
import { connect, KeyPair, utils, transactions } from 'near-api-js';
import { Account } from 'near-api-js/lib/account'; // For Account type
import Decimal from 'decimal.js';
import BN from 'bn.js'; // Import BN

// Environment variables for the platform's sending account
const NEAR_RPC_URL = process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org';
const PLATFORM_SENDER_ACCOUNT_ID = process.env.PLATFORM_NEAR_SENDER_ACCOUNT_ID;
const PLATFORM_SENDER_PRIVATE_KEY = process.env.PLATFORM_NEAR_SENDER_PRIVATE_KEY;

// Platform Asset Configuration
const PLATFORM_PRIMARY_ASSET_ID = process.env.PLATFORM_PRIMARY_ASSET_ID || 'PRIMARY';
const PLATFORM_USDC_ASSET_ID = process.env.PLATFORM_USDC_ASSET_ID || 'USDC';

// NEP-141 USDC Token Configuration
const USDC_TOKEN_ACCOUNT_ID = process.env.USDC_TOKEN_ACCOUNT_ID_NEAR;
// USDC_TOKEN_DECIMALS is not directly used in this processor, but good to be aware of.

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
    console.error('CRITICAL_CONFIG_ERROR: Platform sender account ID or private key not configured. Cannot process withdrawals. Please check environment variables.');
    return;
  }

  const pendingWithdrawals = await db.nearWithdrawal.findMany({
    where: {
      status: 'PENDING',
      processingAttempts: { lt: MAX_PROCESSING_ATTEMPTS },
    },
    orderBy: { createdAt: 'asc' }, // Process oldest first
    take: 10, // Process in batches
  }

  if (pendingWithdrawals.length === 0) {
    console.log('No pending withdrawals to process at this time.');
    return;
  }

  console.log(`Found ${pendingWithdrawals.length} pending withdrawals to process in this batch.`);

  let nearAccount;
  try {
    nearAccount = await getNearAccount();
  } catch (error: any) {
    console.error('CRITICAL_NEAR_CONNECTION_ERROR: Failed to initialize NEAR account for sender. Cannot process withdrawals. Error:', error.message, error.stack);
    return;
  }

  for (const withdrawal of pendingWithdrawals) {
    // Construct human-readable amount for logging, using assetDecimals from the withdrawal record
    const humanReadableAmount = new Decimal(withdrawal.amountRawUnits).div(new Decimal('1e' + withdrawal.assetDecimals)).toString();
    console.log(`Processing withdrawal ID: ${withdrawal.id} for user ${withdrawal.platformUserId} (Asset: ${withdrawal.assetPlatformId}) to ${withdrawal.targetNearAccountId}, amount: ${humanReadableAmount}.`);

    let updatedStatus: import('@prisma/client').WithdrawalStatus = withdrawal.status;
    let failureReason: string | null = withdrawal.failureReason; // Preserve existing reason if retrying
    let nearTxHash: string | null = withdrawal.nearTransactionHash;
    const nextProcessingAttempt = withdrawal.processingAttempts + 1;

    try {
      await db.nearWithdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: 'PROCESSING',
          processingAttempts: nextProcessingAttempt,
          lastAttemptAt: new Date(),
        },
      });
      console.log(`  Withdrawal ${withdrawal.id} (Asset: ${withdrawal.assetPlatformId}) status updated to PROCESSING (Attempt: ${nextProcessingAttempt}).`);

      const rawAmount = withdrawal.amountRawUnits;
      if (new Decimal(rawAmount).isNegative() || new Decimal(rawAmount).isZero()) {
          throw new Error('Withdrawal amount must be positive. This should have been caught earlier during request.');
      }

      let transactionReceiverId: string;
      let transactionActions: transactions.Action[];

      if (withdrawal.assetPlatformId === PLATFORM_USDC_ASSET_ID && USDC_TOKEN_ACCOUNT_ID) {
          // Handle USDC NEP-141 withdrawal
          transactionReceiverId = USDC_TOKEN_ACCOUNT_ID;
          const ftTransferArgs = {
              receiver_id: withdrawal.targetNearAccountId,
              amount: rawAmount, // amountRawUnits is already in token's smallest unit
              memo: `Withdrawal ID: ${withdrawal.id}`,
          };
          transactionActions = [
              transactions.functionCall(
                  'ft_transfer',
                  Buffer.from(JSON.stringify(ftTransferArgs)),
                  new BN('10000000000000'), // 100 TGas
                  new BN(1) // 1 yoctoNEAR deposit
              )
          ];
          console.log(`  Prepared USDC ft_transfer to ${withdrawal.targetNearAccountId} for ${rawAmount} raw USDC units via ${USDC_TOKEN_ACCOUNT_ID}.`);
      } else if (withdrawal.assetPlatformId === PLATFORM_PRIMARY_ASSET_ID) {
          // Handle Native NEAR withdrawal
          transactionReceiverId = withdrawal.targetNearAccountId;
          transactionActions = [transactions.transfer(rawAmount)]; // amountRawUnits is yoctoNEAR here
          console.log(`  Prepared native NEAR transfer to ${withdrawal.targetNearAccountId} for ${rawAmount} yoctoNEAR.`);
      } else {
          throw new Error(`Unsupported assetPlatformId for withdrawal: ${withdrawal.assetPlatformId}`);
      }

      console.log(`  Attempting to send transaction for withdrawal ${withdrawal.id} (Asset: ${withdrawal.assetPlatformId}): To: ${transactionReceiverId}, Actions: ${JSON.stringify(transactionActions.map(a => a.enum))}`);
      const result = await nearAccount.signAndSendTransaction({
          receiverId: transactionReceiverId,
          actions: transactionActions,
      });

      const outcome = await nearAccount.connection.provider.txStatus(result.transaction.hash, nearAccount.accountId);
      console.log(`  NEAR Transaction sent for withdrawal ${withdrawal.id} (Asset: ${withdrawal.assetPlatformId}). Hash: ${result.transaction.hash}. Checking outcome...`);

      const assetTypeForLog = withdrawal.assetPlatformId === PLATFORM_USDC_ASSET_ID ? "USDC" : "NEAR";
      if (typeof outcome.status === 'object' && 'SuccessValue' in outcome.status) {
        nearTxHash = result.transaction.hash;
        updatedStatus = 'COMPLETED';
        failureReason = null;
        console.log(`  SUCCESS: ${assetTypeForLog} Withdrawal ${withdrawal.id} completed. NEAR Tx Hash: ${nearTxHash}`);
      } else {
        const errorDetails = JSON.stringify(outcome.status);
        console.error(`  NEAR_TX_FAILURE: ${assetTypeForLog} transaction failed for withdrawal ${withdrawal.id}. Hash: ${result.transaction.hash}. Outcome Status: ${errorDetails}`);
        throw new Error(`NEAR transaction execution failed. Status: ${errorDetails}`);
      }

    } catch (error: any) {
      console.error(`  PROCESSING_ERROR: Failed to process withdrawal ${withdrawal.id} (Asset: ${withdrawal.assetPlatformId}) during attempt ${nextProcessingAttempt}. Error:`, error.message, error.stack);
      updatedStatus = 'FAILED';
      failureReason = `Attempt ${nextProcessingAttempt}: ${error.message}`.substring(0, 1000);

      if (nextProcessingAttempt >= MAX_PROCESSING_ATTEMPTS) {
        updatedStatus = 'REQUIRES_MANUAL_INTERVENTION';
        failureReason = `Max processing attempts (${MAX_PROCESSING_ATTEMPTS}) reached. Last error: ${failureReason}`.substring(0, 1000);
        console.warn(`  CRITICAL_WITHDRAWAL_FAILURE: Withdrawal ${withdrawal.id} (Asset: ${withdrawal.assetPlatformId}) reached max processing attempts. Status set to REQUIRES_MANUAL_INTERVENTION.`);
      }
    }

    // Update the record with the final status for this attempt
    try {
        await db.nearWithdrawal.update({
            where: { id: withdrawal.id },
            data: {
            status: updatedStatus,
            nearTransactionHash: nearTxHash,
            failureReason: failureReason,
            },
        });
        console.log(`  Withdrawal ${withdrawal.id} (Asset: ${withdrawal.assetPlatformId}) final status for this attempt: ${updatedStatus}.`);
    } catch (dbUpdateError: any) {
        console.error(`  CRITICAL_DB_UPDATE_ERROR: Failed to update final status for withdrawal ${withdrawal.id} (Asset: ${withdrawal.assetPlatformId}) to ${updatedStatus} after processing attempt. Error:`, dbUpdateError.message, dbUpdateError.stack);
        // This is problematic, as the on-chain tx might have occurred but DB state is inconsistent.
    }
  } // End for loop
  console.log('Finished processing batch of withdrawals.');
}
