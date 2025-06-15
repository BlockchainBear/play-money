import { connect, transactions, utils, providers } from 'near-api-js';
import { Account } from 'near-api-js/lib/account'; // For types if needed
import { BlockResult, ChunkResult } from 'near-api-js/lib/providers/provider'; // For types
import { handleNearDeposit } from '@play-money/users/lib';
import db from '@play-money/database';

// Configuration - Loaded from environment variables
const NEAR_RPC_URL = process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org';
const PLATFORM_NEAR_ACCOUNT_ID = process.env.PLATFORM_NEAR_ACCOUNT_ID || 'your-platform.testnet'; // Replace with actual testnet account

const MONITOR_ID = 'near-deposit-monitor';

async function getNearProvider() {
  const { keyStores } = utils;
  const keyStore = new keyStores.InMemoryKeyStore();

  const config = {
    networkId: 'testnet', // Assuming testnet, make configurable if needed
    keyStore,
    nodeUrl: NEAR_RPC_URL,
    walletUrl: 'https://wallet.testnet.near.org',
    helperUrl: 'https://helper.testnet.near.org',
    explorerUrl: 'https://explorer.testnet.near.org',
  };

  const near = await connect(config);
  return near.connection.provider;
}

export async function checkDeposits() {
  console.log(`Checking deposits for ${PLATFORM_NEAR_ACCOUNT_ID} on ${NEAR_RPC_URL}`);
  const provider = await getNearProvider();

  try {
    let lastProcessedBlockHeight: number;

    const syncState = await db.blockchainSyncState.findUnique({
      where: { monitorId: MONITOR_ID },
    });

    const latestBlock = await provider.block({ finality: 'final' });
    const latestBlockHeight = latestBlock.header.height;

    if (syncState) {
      lastProcessedBlockHeight = Number(syncState.lastProcessedBlock); // Convert BigInt to number
    } else {
      // If no sync state, start from one block behind the current latest, or a configured default.
      lastProcessedBlockHeight = latestBlockHeight - 1;
      console.log(`No previous sync state found for ${MONITOR_ID}. Starting from block ${lastProcessedBlockHeight}`);
    }

    console.log(`Starting check from block ${lastProcessedBlockHeight + 1} up to ${latestBlockHeight}`);

    // Iterate from the last processed block up to the latest block
    // Note: Iterating many blocks like this can be slow and RPC intensive.
    // An indexer is better for historical data or high volume.
    for (let height = lastProcessedBlockHeight + 1; height <= latestBlockHeight; height++) {
      console.log(`Processing block ${height}`);
      const block = await provider.block({ blockId: height });

      for (const chunkHash of block.chunks.map(c => c.chunk_hash)) {
        // Consider adding retries or error handling for chunk fetching
        const chunk = await provider.chunk(chunkHash);

        for (const tx of chunk.transactions) {
          if (tx.receiver_id === PLATFORM_NEAR_ACCOUNT_ID) {
            console.log(`Transaction to platform account found in block ${height}:`, tx.hash);

            // Iterate through actions to find native NEAR transfers
            for (const action of tx.actions) {
              // Ensure action is an object and has the 'enum' and 'transfer' properties
              if (typeof action === 'object' && action !== null && 'enum' in action && 'transfer' in action) {
                const actionTransfer = action as { enum: string, transfer: any }; // Type assertion
                if (actionTransfer.enum === 'transfer' && actionTransfer.transfer) {
                  const sender_id = tx.signer_id;
                  const amountYoctoNear = actionTransfer.transfer.deposit;
                  const amountNear = utils.format.formatNearAmount(amountYoctoNear.toString(), 4); // Format for readability

                  console.log(`  Native NEAR Transfer:`);
                  console.log(`    Sender: ${sender_id}`);
                  console.log(`    Amount: ${amountNear} NEAR (${amountYoctoNear} yoctoNEAR)`);
                  console.log(`    Receiver: ${tx.receiver_id}`);
                  console.log(`    Transaction Hash: ${tx.hash}`);

                  // ** Memo Handling Challenge for Native Transfers **
                  // Memos for native transfers are not straightforwardly available here.
                  // Options:
                  // 1. Require users to send to a specific function on a simple contract deployed to PLATFORM_NEAR_ACCOUNT_ID.
                  //    The function call arguments would include the memo.
                  // 2. Use an indexer service that pre-parses this data if available.
                  // 3. For now, we'll assume memo needs to be handled via a contract call or an alternative method.
                  const memo = "MEMO_PLACEHOLDER"; // Placeholder

                  // ** Database Interaction Placeholder **
                  // 1. Validate memo format and extract user identifier.
                  // 2. Check if transaction hash has already been processed to prevent double crediting.
                  // 3. Credit user's internal platform account.
                  // Example: await creditUserAccount(sender_id, amountYoctoNear, memo, tx.hash);
                  console.log(`    Memo (Placeholder): ${memo}`);
                  // console.log(`    [TODO: Validate memo, check for duplicates, credit user account in database]`);
                  await handleNearDeposit({
                    nearSenderAccountId: sender_id,
                    amountYoctoNear: amountYoctoNear.toString(),
                    nearTransactionHash: tx.hash,
                  });
                }
              }
            }
          }
        }
      }
      // After successfully processing all transactions in the current block `height`:
      await db.blockchainSyncState.upsert({
        where: { monitorId: MONITOR_ID },
        update: { lastProcessedBlock: BigInt(height) }, // Store as BigInt
        create: { monitorId: MONITOR_ID, lastProcessedBlock: BigInt(height) },
      });
      console.log(`Successfully processed block ${height}. Updated sync state for ${MONITOR_ID}.`);
    }
    console.log('Finished checking blocks.');

  } catch (error) {
    console.error('Error checking deposits:', error);
    // Potentially reset lastProcessedBlockHeight or handle error more gracefully
  }
}

// Example of how to run it (for testing purposes)
// async function main() {
//   // Load .env variables if running standalone for testing
//   // require('dotenv').config({ path: '../../.env' }); // Adjust path as needed
//   await checkDeposits();
// }
// main().catch(console.error);
