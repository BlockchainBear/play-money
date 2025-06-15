// apps/web/app/(app)/wallet/_components/NearDepositInfo.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AssetSelector, AssetOption } from './AssetSelector'; // Adjust path if needed

// fetcher function (as defined before)
async function fetcher(url: string, options?: RequestInit) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: 'Request failed with status ' + res.status }));
    throw new Error(errorData.error || 'An error occurred');
  }
  return res.json();
}

interface DepositInfoApiResponse {
  platformDepositAccountId: string;
  assetId: string; // The assetId this info pertains to
  tokenContractId: string | null; // e.g., USDC contract address
  instructions: string;
}

// Get platform asset IDs from env (client-side env vars need to be prefixed with NEXT_PUBLIC_)
// For simplicity in this component, we might hardcode or pass them as props if fetched from a higher level context.
// Let's assume we have them (these would ideally come from a shared config or context)
const PLATFORM_PRIMARY_ASSET_ID = process.env.NEXT_PUBLIC_PLATFORM_PRIMARY_ASSET_ID || 'PRIMARY';
const PLATFORM_USDC_ASSET_ID = process.env.NEXT_PUBLIC_PLATFORM_USDC_ASSET_ID || 'USDC';


const supportedAssets: AssetOption[] = [
  { id: PLATFORM_PRIMARY_ASSET_ID, name: 'NEAR' }, // Assuming PRIMARY maps to native NEAR
  { id: PLATFORM_USDC_ASSET_ID, name: 'USDC' },
];

export function NearDepositInfo() {
  const [selectedAssetId, setSelectedAssetId] = useState<string>(PLATFORM_PRIMARY_ASSET_ID);
  const [depositInfo, setDepositInfo] = useState<DepositInfoApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [userLinkedAccount, setUserLinkedAccount] = useState<string | null>(null); // As before

  const fetchDepositData = useCallback(async (assetId: string) => {
    setIsLoading(true);
    setError(null);
    setDepositInfo(null); // Clear previous info

    try {
      // Fetch deposit info for the selected asset
      const newDepositInfo: DepositInfoApiResponse = await fetcher(`/api/near/deposit-info?assetId=${assetId}`);
      setDepositInfo(newDepositInfo);

      // Fetch user's linked NEAR account (independent of selected asset for deposit info)
      // This might already be fetched if this component is part of a larger wallet context
      // No longer fetching userLinkedAccount here as it's done in a separate useEffect
    } catch (err: any) {
      setError('Failed to load deposit information: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  }, []); // Removed userLinkedAccount from dependencies here

  useEffect(() => {
    fetchDepositData(selectedAssetId);
  }, [selectedAssetId, fetchDepositData]);

  // Initial fetch for userLinkedAccount (if not fetched conditionally in fetchDepositData)
  useEffect(() => {
    // Fetch only if not already fetched or to ensure freshness if component remounts
    // For simplicity, fetch once on mount. Could be context-driven.
    fetcher('/api/user/near-account')
        .then(data => setUserLinkedAccount(data.nearAccountId))
        .catch(err => console.warn('Failed to load user linked NEAR account: ' + err.message));
  }, []);


  const handleSelectAsset = (assetId: string) => {
    setSelectedAssetId(assetId);
  };

  let content;
  if (isLoading) {
    content = <div>Loading deposit information for {supportedAssets.find(a => a.id === selectedAssetId)?.name || ''}...</div>;
  } else if (error) {
    content = <div className="p-4 rounded bg-red-100 text-red-700">{error}</div>;
  } else if (!depositInfo) {
    content = <div>No deposit information available for {supportedAssets.find(a => a.id === selectedAssetId)?.name || ''}.</div>;
  } else {
    content = (
      <>
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
          <p className="font-semibold text-blue-700">
            Platform's Deposit Address (for {depositInfo.assetId}):
          </p>
          <p className="text-lg font-mono break-all text-blue-900">{depositInfo.platformDepositAccountId}</p>
          {depositInfo.tokenContractId && (
            <p className="text-sm text-blue-600">
              Token Contract: <span className="font-mono break-all">{depositInfo.tokenContractId}</span>
            </p>
          )}
        </div>
        <div>
          <h4 className="font-semibold mt-2">Instructions for depositing {depositInfo.assetId}:</h4>
          <div className="text-sm space-y-1 mt-1 whitespace-pre-wrap p-2 bg-gray-50 rounded">
            {depositInfo.instructions}
          </div>
          <p className="text-sm mt-2">
            Ensure your depositing NEAR account is linked: <strong>{userLinkedAccount || 'Not yet linked. Please link your account in settings.'}</strong>
          </p>
        </div>
        {!userLinkedAccount && (
           <div className="mt-4 p-3 bg-yellow-50 border border-yellow-300 rounded-md">
               <p className="text-yellow-700 text-sm">
                   Your depositing NEAR account is not linked. Please go to your settings to link your account before depositing.
               </p>
               {/* Example: <Link href="/settings/profile">Go to Settings</Link> */}
           </div>
         )}
      </>
    );
  }

  return (
    <div className="space-y-4 p-4 border rounded-lg">
      <h3 className="text-lg font-semibold">Deposit Crypto</h3>
      <AssetSelector
        assets={supportedAssets}
        selectedAssetId={selectedAssetId}
        onSelectAsset={handleSelectAsset}
        disabled={isLoading}
      />
      {content}
    </div>
  );
             </p>
             {/* Example: <Link href="/settings/profile">Go to Settings</Link> */}
         </div>
      )}
    </div>
  );
}
