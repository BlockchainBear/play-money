// apps/web/app/(app)/wallet/_components/NearWithdrawalRequest.tsx
'use client';

import React, { useState, useEffect, FormEvent } from 'react';
import { Button } from '@play-money/ui/components/Button';
import { Input } from '@play-money/ui/components/Input';
import { Label } from '@play-money/ui/components/Label';
import Decimal from 'decimal.js';

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
// TODO: Replace with actual API call to fetch user's PRIMARY balance.
async function getUserPrimaryBalance(): Promise<Decimal> {
  // const data = await fetcher('/api/user/balance?assetType=CURRENCY&assetId=PRIMARY');
  // return new Decimal(data.balance.total || 0);
  console.warn("Mocking user's PRIMARY balance. Replace with actual API call.");
  return new Decimal(1000); // Mock balance
}


export function NearWithdrawalRequest() {
  const [targetNearAccountId, setTargetNearAccountId] = useState<string>('');
  const [amount, setAmount] = useState<string>(''); // Store as string for input field
  const [userBalance, setUserBalance] = useState<Decimal | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setIsLoadingBalance(true);
    getUserPrimaryBalance()
      .then(balance => setUserBalance(balance))
      .catch(err => {
        console.error("Failed to fetch user balance:", err);
        setMessage({ type: 'error', text: 'Failed to load your current balance.' });
        setUserBalance(new Decimal(0)); // Set to 0 on error to avoid issues
      })
      .finally(() => setIsLoadingBalance(false));
  }, []);

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
         throw new Error('Withdrawal amount exceeds your available balance.');
      }

      const result = await fetcher('/api/near/withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetNearAccountId, amount: amountDecimal.toString() }),
      });

      setMessage({ type: 'success', text: result.message || 'Withdrawal request submitted successfully!' });
      setTargetNearAccountId('');
      setAmount('');
      // Optionally, refresh user balance after successful withdrawal request
      getUserPrimaryBalance().then(setUserBalance).catch(console.error);

    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to submit withdrawal request.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMaxAmount = () => {
     if (userBalance) {
         // Deduct a small amount for potential transaction fees if those were client-side calculated (not the case here)
         // Or simply set to full balance.
         setAmount(userBalance.toString());
     }
  }

  return (
    <div className="space-y-4 p-4 border rounded-lg">
      <h3 className="text-lg font-semibold">Request NEAR Withdrawal</h3>

      {isLoadingBalance ? (
        <p>Loading your balance...</p>
      ) : userBalance !== null && (
        <p className="text-sm">
          Your available PRIMARY balance: <strong className="font-mono">{userBalance.toDP(2).toString()}</strong>
          {/* TODO: Display currency code if dynamic */}
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
             <Label htmlFor="amount">Amount to Withdraw (PRIMARY)</Label>
             {userBalance && !userBalance.isZero() && (
                 <Button type="button" /*variant="link" size="sm"*/ onClick={handleMaxAmount} disabled={isSubmitting} className="p-0 h-auto text-xs" style={{border: 'none', background: 'none', textDecoration: 'underline', cursor: 'pointer'}}>
                     Max
                 </Button>
             )}
         </div>
          <Input
            id="amount"
            type="text" // Using text for decimal handling, though "number" with step="any" can also work
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g., 100.00"
            disabled={isSubmitting}
            required
          />
        </div>
        <Button type="submit" disabled={isSubmitting || isLoadingBalance || userBalance === null || userBalance.isZero()}>
          {isSubmitting ? 'Submitting...' : 'Request Withdrawal'}
        </Button>
      </form>
    </div>
  );
}
