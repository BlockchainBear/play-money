// apps/web/app/(app)/wallet/_components/NearWithdrawalRequest.tsx
'use client';

import React, { useState, useEffect, FormEvent, useCallback } from 'react';
import { Button } from '@play-money/ui/components/Button';
import { Input } from '@play-money/ui/components/Input';
import { Label } from '@play-money/ui/components/Label';
import Decimal from 'decimal.js';
import { AssetSelector, AssetOption } from './AssetSelector'; // Adjust path

// fetcher function (as defined before)
async function fetcher(url: string, options?: RequestInit) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: 'Request failed with status ' + res.status }));
    throw new Error(errorData.error || 'An error occurred');
  }
  return res.json();
}

// A new endpoint to fetch user's primary balance would be ideal.
// For now, let's assume we might need to fetch all balances or have a dedicated one.
// Placeholder: /api/user/balance?currency=PRIMARY
// If such an endpoint doesn't exist, this part needs adjustment or a mock.
// For this subtask, I'll mock a balance and add a TODO.
// Placeholder env vars for client-side use
const PLATFORM_PRIMARY_ASSET_ID = process.env.NEXT_PUBLIC_PLATFORM_PRIMARY_ASSET_ID || 'PRIMARY';
const PLATFORM_USDC_ASSET_ID = process.env.NEXT_PUBLIC_PLATFORM_USDC_ASSET_ID || 'USDC';

const supportedWithdrawalAssets: AssetOption[] = [
  { id: PLATFORM_PRIMARY_ASSET_ID, name: 'NEAR' },
  { id: PLATFORM_USDC_ASSET_ID, name: 'USDC' },
];

export function NearWithdrawalRequest() {
  const [selectedAssetId, setSelectedAssetId] = useState<string>(PLATFORM_PRIMARY_ASSET_ID);
  const [targetNearAccountId, setTargetNearAccountId] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [userBalance, setUserBalance] = useState<Decimal | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchUserBalanceForAsset = useCallback(async (assetId: string) => {
    setIsLoadingBalance(true);
    setMessage(null); // Clear previous messages when asset changes
    try {
      const data = await fetcher(`/api/user/platform-balance?assetId=${assetId}&assetType=CURRENCY`);
      if (data && typeof data.total === 'string') {
        setUserBalance(new Decimal(data.total));
      } else {
        console.error("Invalid balance data received for " + assetId + ":", data);
        setUserBalance(new Decimal(0));
        setMessage({ type: 'error', text: 'Failed to parse balance for selected asset.' });
      }
    } catch (err: any) {
      console.error("Failed to fetch user balance for " + assetId + ":", err);
      setMessage({ type: 'error', text: `Failed to load balance for ${assetId}: ` + err.message });
      setUserBalance(new Decimal(0));
    } finally {
      setIsLoadingBalance(false);
    }
  }, []);

  useEffect(() => {
    fetchUserBalanceForAsset(selectedAssetId);
  }, [selectedAssetId, fetchUserBalanceForAsset]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    try {
      const amountDecimal = new Decimal(amount);
      if (amountDecimal.isNaN() || !amountDecimal.isFinite() || amountDecimal.isNegative() || amountDecimal.isZero()) {
         throw new Error('Please enter a valid positive amount.');
      }
      if (!userBalance || amountDecimal.gt(userBalance)) { // Check against null userBalance as well
         throw new Error(`Withdrawal amount exceeds your available ${selectedAssetId} balance.`);
      }

      const result = await fetcher('/api/near/withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            targetNearAccountId,
            amount: amountDecimal.toString(),
            assetPlatformId: selectedAssetId // Include selected asset
        }),
      });

      setMessage({ type: 'success', text: result.message || 'Withdrawal request submitted successfully!' });
      setTargetNearAccountId('');
      setAmount('');
      fetchUserBalanceForAsset(selectedAssetId); // Refresh balance for the current asset
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to submit withdrawal request.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMaxAmount = () => {
     if (userBalance) {
         setAmount(userBalance.toString());
     }
  };
  const selectedAssetName = supportedWithdrawalAssets.find(a => a.id === selectedAssetId)?.name || selectedAssetId;

  return (
    <div className="space-y-4 p-4 border rounded-lg">
      <h3 className="text-lg font-semibold">Request Withdrawal</h3>

      <AssetSelector
        assets={supportedWithdrawalAssets}
        selectedAssetId={selectedAssetId}
        onSelectAsset={(assetId) => {
            setSelectedAssetId(assetId);
            setAmount(''); // Clear amount when asset changes
            setMessage(null);
        }}
        disabled={isSubmitting || isLoadingBalance}
      />

      {isLoadingBalance ? (
        <p>Loading your {selectedAssetName} balance...</p>
      ) : userBalance !== null && (
        <p className="text-sm">
          Your available {selectedAssetName} balance: <strong className="font-mono">{userBalance.toDP(selectedAssetId === PLATFORM_USDC_ASSET_ID ? 2 : 4).toString()}</strong>
          {/* Adjust decimal places based on asset */}
        </p>
      )}

      {message && (
        <div className={`p-2 rounded text-sm ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label htmlFor="targetNearAccountId">Recipient NEAR Account ID</Label>
          <Input
            id="targetNearAccountId"
            type="text"
            value={targetNearAccountId}
            onChange={(e) => setTargetNearAccountId(e.target.value)}
            placeholder="your-wallet.testnet"
            disabled={isSubmitting}
            required
          />
        </div>
        <div>
         <div className="flex justify-between items-center">
             <Label htmlFor="amount">Amount to Withdraw ({selectedAssetName})</Label>
             {userBalance && !userBalance.isZero() && (
                 <Button type="button" /*variant="link" size="sm"*/ onClick={handleMaxAmount} disabled={isSubmitting} className="p-0 h-auto text-xs" style={{border: 'none', background: 'none', textDecoration: 'underline', cursor: 'pointer'}}>
                     Max
                 </Button>
             )}
         </div>
          <Input
            id="amount"
            type="text" // Using text for decimal handling
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g., 100.00"
            disabled={isSubmitting}
            required
          />
        </div>
        <Button type="submit" disabled={isSubmitting || isLoadingBalance || userBalance === null || userBalance.isZero()}>
          {isSubmitting ? 'Submitting...' : `Request ${selectedAssetName} Withdrawal`}
        </Button>
      </form>
    </div>
  );
}
