// apps/web/app/(app)/wallet/_components/NearDepositInfo.tsx
'use client';

import React, { useState, useEffect } from 'react';

// Re-using the fetcher from NearAccountLinker or define a similar one.
// For simplicity, let's assume a shared fetcher or define it again.
async function fetcher(url: string, options?: RequestInit) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: 'Request failed with status ' + res.status }));
    throw new Error(errorData.error || 'An error occurred');
  }
  return res.json();
}

interface DepositInfo {
  platformDepositAccountId: string;
  instructions: string;
}

export function NearDepositInfo() {
  const [depositInfo, setDepositInfo] = useState<DepositInfo | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [userLinkedAccount, setUserLinkedAccount] = useState<string | null>(null);

  useEffect(() => {
    let depositInfoFetched = false;
    let linkedAccountFetched = false;

    const checkLoadingDone = () => {
      if (depositInfoFetched && linkedAccountFetched) {
        setIsLoading(false);
      }
    };

    // Fetch deposit info
    fetcher('/api/near/deposit-info')
      .then((data) => {
        setDepositInfo(data);
      })
      .catch((err) => {
        setError('Failed to load deposit information: ' + err.message);
      })
      .finally(() => {
        depositInfoFetched = true;
        checkLoadingDone();
      });

    // Fetch user's linked NEAR account
    fetcher('/api/user/near-account')
      .then((data) => {
        setUserLinkedAccount(data.nearAccountId);
      })
      .catch((err) => {
        // Non-critical error, deposit info can still be shown
        console.warn('Failed to load user linked NEAR account for deposit info: ' + err.message);
      })
      .finally(() => {
        linkedAccountFetched = true;
        checkLoadingDone();
      });
  }, []);

  if (isLoading) {
    return <div>Loading deposit information...</div>;
  }

  if (error) {
    return <div className="p-4 rounded bg-red-100 text-red-700">{error}</div>;
  }

  if (!depositInfo) {
    return <div>No deposit information available.</div>;
  }

  return (
    <div className="space-y-4 p-4 border rounded-lg">
      <h3 className="text-lg font-semibold">Deposit NEAR</h3>

      <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
        <p className="font-semibold text-blue-700">Platform's Deposit Address:</p>
        <p className="text-lg font-mono break-all text-blue-900">{depositInfo.platformDepositAccountId}</p>
      </div>

      <div>
         <h4 className="font-semibold">Instructions:</h4>
         <ul className="list-disc list-inside text-sm space-y-1 mt-1">
             <li>Send only native NEAR tokens to this address. Other tokens will be lost.</li>
             <li>Ensure you have correctly linked your personal NEAR account ID in your profile.
                 The deposit must originate from your linked account: <strong>{userLinkedAccount || 'Not yet linked. Please link your account in settings.'}</strong>
             </li>
             <li>Deposits will be credited after confirmation on the NEAR blockchain. This may take a few minutes.</li>
             <li>Minimum deposit amount: (Specify if any, e.g., 0.1 NEAR).</li>
         </ul>
         <p className="text-sm mt-2 text-muted-foreground">{depositInfo.instructions}</p>
      </div>

      {/* Optionally, include the NearAccountLinker or a link to settings if account is not linked */}
      {!userLinkedAccount && (
         <div className="mt-4 p-3 bg-yellow-50 border border-yellow-300 rounded-md">
             <p className="text-yellow-700 text-sm">
                 Your depositing NEAR account is not linked. Please go to your settings to link your account before depositing.
             </p>
             {/* Example: <Link href="/settings/profile">Go to Settings</Link> */}
         </div>
      )}
    </div>
  );
}
