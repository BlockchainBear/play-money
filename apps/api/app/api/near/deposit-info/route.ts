// apps/api/app/api/near/deposit-info/route.ts
import { NextResponse, NextRequest } from 'next/server';
import { getAuthUser } from '@play-money/auth';

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const assetIdQuery = searchParams.get('assetId'); // e.g., "USDC" or "PRIMARY" (for native NEAR)

    const platformDepositAccountId = process.env.PLATFORM_NEAR_ACCOUNT_ID;
    const usdcTokenAccountId = process.env.USDC_TOKEN_ACCOUNT_ID_NEAR;
    const platformPrimaryAssetId = process.env.PLATFORM_PRIMARY_ASSET_ID || 'PRIMARY';
    const platformUsdcAssetId = process.env.PLATFORM_USDC_ASSET_ID || 'USDC';

    if (!platformDepositAccountId) {
      console.error('PLATFORM_NEAR_ACCOUNT_ID is not set in environment variables.');
      return NextResponse.json({ error: 'Deposit information is currently unavailable (config error).' }, { status: 503 });
    }

    let depositAddress = platformDepositAccountId; // Platform's main NEAR account always receives
    let instructions = '';
    let effectiveAssetId = assetIdQuery || platformPrimaryAssetId; // Default to primary/native NEAR
    let tokenContractForAsset: string | null = null;

    if (effectiveAssetId === platformUsdcAssetId) {
      if (!usdcTokenAccountId) {
        console.error('USDC_TOKEN_ACCOUNT_ID_NEAR is not set for USDC deposit info request.');
        return NextResponse.json({ error: `Deposit information for ${platformUsdcAssetId} is currently unavailable (config error).` }, { status: 503 });
      }
      tokenContractForAsset = usdcTokenAccountId;
      instructions = `To deposit ${platformUsdcAssetId}, send your tokens to the platform's main NEAR account address displayed above. This must be done via an \`ft_transfer_call\` to the USDC token contract (${usdcTokenAccountId}). The \`receiver_id\` in the \`ft_transfer_call\` arguments must be the platform's main NEAR account address. Ensure your calling NEAR account (signer of the ft_transfer_call) is linked in your user profile for identification. You may include a memo in the \`ft_transfer_call\` for your own records (this will be stored with your deposit). Example: near call ${usdcTokenAccountId} ft_transfer_call '{"receiver_id": "${platformDepositAccountId}", "amount": "1000000", "msg": "Deposit for user XYZ"}' --accountId your-sender.testnet --depositYocto 1 --gas 50000000000000.`;
      // Note: The 'msg' in ft_transfer_call is what our monitor currently picks up as 'memo'.
      // Updated example to use --depositYocto 1 and a more common gas like 50 TGas.
    } else if (effectiveAssetId === platformPrimaryAssetId) {
      instructions = `To deposit native NEAR (${platformPrimaryAssetId}), please ensure you have linked your depositing NEAR account ID in your user profile before sending funds. This is required to correctly associate the deposit with your account. Send only native NEAR directly to the platform account address displayed above.`;
    } else {
      return NextResponse.json({ error: `Unsupported asset ID "${effectiveAssetId}" for deposit info.` }, { status: 400 });
    }

    return NextResponse.json({
      platformDepositAccountId: depositAddress,
      assetId: effectiveAssetId,
      tokenContractId: tokenContractForAsset,
      instructions,
    });
  } catch (error: any) {
    console.error('Error fetching deposit info:', error.message, error.stack);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
