import { connect, transactions, utils, providers } from 'near-api-js';
import { Account } from 'near-api-js/lib/account'; // For types if needed
import { BlockResult, ChunkResult } from 'near-api-js/lib/providers/provider'; // For types
import { handleNearDeposit } from '@play-money/users/lib';
import db from '@play-money/database';

// Configuration - Loaded from environment variables
const NEAR_RPC_URL = process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org';
const PLATFORM_NEAR_ACCOUNT_ID = process.env.PLATFORM_NEAR_ACCOUNT_ID || 'your-platform-deposit.testnet'; // Clarified role

// Native NEAR configuration
const platformPrimaryAssetId = process.env.PLATFORM_PRIMARY_ASSET_ID || 'PRIMARY';
const nearNativeDecimals = parseInt(process.env.NEAR_NATIVE_DECIMALS || '24', 10);

// NEP-141 USDC Token Configuration
const USDC_TOKEN_ACCOUNT_ID = process.env.USDC_TOKEN_ACCOUNT_ID_NEAR;
const USDC_TOKEN_DECIMALS = parseInt(process.env.USDC_TOKEN_DECIMALS_NEAR || '6', 10);
const PLATFORM_USDC_ASSET_ID = process.env.PLATFORM_USDC_ASSET_ID || 'USDC';

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
  console.log(`Deposit monitor started. Monitoring native NEAR deposits to ${PLATFORM_NEAR_ACCOUNT_ID} and USDC deposits to ${USDC_TOKEN_ACCOUNT_ID} (then to ${PLATFORM_NEAR_ACCOUNT_ID}) on ${NEAR_RPC_URL}.`);

  if (!USDC_TOKEN_ACCOUNT_ID) {
    console.warn("USDC_TOKEN_ACCOUNT_ID_NEAR is not configured in environment variables. Skipping USDC deposit checks.");
  }

  const provider = await getNearProvider();

  try { // Outer try for overall process
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
      console.log(`Processing block ${height} for deposits...`);
      try { // Inner try for processing a single block
        const block = await provider.block({ blockId: height });

        for (const chunkHash of block.chunks.map(c => c.chunk_hash)) {
          // Consider adding retries or error handling for chunk fetching
          const chunk = await provider.chunk(chunkHash);

          for (const tx of chunk.transactions) {
            try { // Innermost try for processing a single transaction
              // Native NEAR Transfer Check
              if (tx.receiver_id === PLATFORM_NEAR_ACCOUNT_ID) {
                console.log(`  Transaction to platform account found in block ${height}: ${tx.hash}, receiver: ${tx.receiver_id}`);
                for (const action of tx.actions) {
                  if (action.enum === 'transfer' && action.transfer) { // Native NEAR transfer
                    const sender_id = tx.signer_id;
                    const amountRawUnits = action.transfer.deposit.toString();
                    const amountNear = utils.format.formatNearAmount(amountRawUnits, nearNativeDecimals);
                    console.log(`    Native NEAR Transfer detected: Sender: ${sender_id}, Amount: ${amountNear} NEAR (${amountRawUnits} yoctoNEAR)`);
                    await handleNearDeposit({
                      nearSenderAccountId: sender_id,
                      amountRawUnits: amountRawUnits,
                      assetPlatformId: platformPrimaryAssetId, // Configured native asset ID
                      assetDecimals: nearNativeDecimals,     // Configured native asset decimals
                      nearTransactionHash: tx.hash,
                      memo: null, // Native transfers via this method don't have a parsed memo here
                    });
                  }
                }
              }
              // NEP-141 USDC ft_transfer_call Check
              else if (USDC_TOKEN_ACCOUNT_ID && tx.receiver_id === USDC_TOKEN_ACCOUNT_ID) {
                // Transaction is to the USDC contract
                for (const action of tx.actions) {
                  if (action.enum === 'functionCall' && action.functionCall.method_name === 'ft_transfer_call') {
                    console.log(`    USDC ft_transfer_call detected to token contract ${USDC_TOKEN_ACCOUNT_ID}. Tx Hash: ${tx.hash}`);
                    const argsBase64 = action.functionCall.args;
                    const argsJson = Buffer.from(argsBase64, 'base64').toString('utf-8');
                    const ftArgs = JSON.parse(argsJson);

                    // Check if the ultimate receiver is our platform's deposit account
                    if (ftArgs.receiver_id === PLATFORM_NEAR_ACCOUNT_ID) {
                      const tokenSenderId = tx.signer_id; // The account that called ft_transfer_call
                      const tokenAmountRaw = ftArgs.amount; // Amount in USDC raw units
                      const memo = ftArgs.memo || null;     // Memo from ft_transfer_call

                      console.log(`      USDC Transfer to Platform: Sender: ${tokenSenderId}, Amount: ${tokenAmountRaw}, Receiver (in args): ${ftArgs.receiver_id}, Memo: ${memo}`);

                      await handleNearDeposit({
                        nearSenderAccountId: tokenSenderId, // This is the actual owner of the tokens
                        amountRawUnits: tokenAmountRaw.toString(),
                        assetPlatformId: PLATFORM_USDC_ASSET_ID, // Configured USDC asset ID
                        assetDecimals: USDC_TOKEN_DECIMALS,    // Configured USDC decimals
                        nearTransactionHash: tx.hash,
                        memo: memo,
                      });
                    } else {
                      // Log if ft_transfer_call to USDC contract doesn't target our platform account
                      // console.log(`      USDC ft_transfer_call to ${USDC_TOKEN_ACCOUNT_ID} did not target platform account. Actual receiver: ${ftArgs.receiver_id}. Tx: ${tx.hash}`);
                    }
                  }
                }
              }
            } catch (txError: any) {
              console.error(`Error processing transaction ${tx.hash} in block ${height}:`, txError.message, txError.stack);
              // Continue to next transaction
            }
          } // end for tx
        } // end for chunkHash

        // After successfully processing all transactions in the current block `height`:
        await db.blockchainSyncState.upsert({
          where: { monitorId: MONITOR_ID },
          update: { lastProcessedBlock: BigInt(height) }, // Store as BigInt
          create: { monitorId: MONITOR_ID, lastProcessedBlock: BigInt(height) },
        });
        console.log(`Successfully processed and updated sync state for block ${height}.`);
      } catch (blockError: any) {
        console.error(`Error processing block ${height}:`, blockError.message, blockError.stack);
        // Decide if we should update lastProcessedBlockHeight here or retry the block later.
        // For now, we'll assume the error is transient or related to a specific chunk/tx handled by inner try-catch.
        // If the block fetch itself failed, we might want to break and retry later.
        // If block processing keeps failing, the monitor might get stuck on this block.
      }
    } // end for height
    console.log('Finished checking blocks for this run.');

  } catch (overallError: any) {
    console.error('FATAL: Unhandled error in checkDeposits main loop:', overallError.message, overallError.stack);
  }
}

// Example of how to run it (for testing purposes)
// async function main() {
//   // Load .env variables if running standalone for testing
//   // require('dotenv').config({ path: '../../.env' }); // Adjust path as needed
//   await checkDeposits();
// }
// main().catch(console.error);
