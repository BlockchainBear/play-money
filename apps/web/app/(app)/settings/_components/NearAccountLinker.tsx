// apps/web/app/(app)/settings/_components/NearAccountLinker.tsx
'use client';

import React, { useState, useEffect, FormEvent } from 'react';
import { Button } from '@play-money/ui/components/Button'; // Assuming Button component exists
import { Input } from '@play-money/ui/components/Input';   // Assuming Input component exists
import { Label } from '@play-money/ui/components/Label'; // Assuming Label component exists
// You might need to create a simple useSWR hook or use fetch directly if not available globally
// For this example, we'll use a simplified fetch wrapper.

async function fetcher(url: string, options?: RequestInit) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: 'Request failed with status ' + res.status }));
    throw new Error(errorData.error || 'An error occurred');
  }
  return res.json();
}

export function NearAccountLinker() {
  const [linkedNearAccountId, setLinkedNearAccountId] = useState<string | null>(null);
  const [inputNearAccountId, setInputNearAccountId] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetcher('/api/user/near-account')
      .then((data) => {
        setLinkedNearAccountId(data.nearAccountId);
        setInputNearAccountId(data.nearAccountId || '');
      })
      .catch((err) => {
        setMessage({ type: 'error', text: 'Failed to load linked NEAR account: ' + err.message });
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setMessage(null);

    try {
      await fetcher('/api/user/near-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nearAccountId: inputNearAccountId }),
      });
      setLinkedNearAccountId(inputNearAccountId);
      setMessage({ type: 'success', text: 'NEAR account linked successfully!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to link NEAR account.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div>Loading NEAR account information...</div>;
  }

  return (
    <div className="space-y-4 p-4 border rounded-lg">
      <h3 className="text-lg font-semibold">Link your NEAR Account</h3>
      <p className="text-sm text-muted-foreground">
        Link your NEAR account ID (e.g., yourname.testnet or yourname.near).
        This account will be used to identify your deposits. Make sure this is an account you control and will send deposits from.
      </p>

      {message && (
        <div className={`p-2 rounded text-sm ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label htmlFor="nearAccountIdInput">NEAR Account ID</Label>
          <Input
            id="nearAccountIdInput"
            type="text"
            value={inputNearAccountId}
            onChange={(e) => setInputNearAccountId(e.target.value)}
            placeholder="yourname.testnet"
            disabled={isSaving}
          />
        </div>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? 'Saving...' : (linkedNearAccountId && linkedNearAccountId === inputNearAccountId) ? 'Update Linked Account' : 'Link Account'}
        </Button>
      </form>
      {linkedNearAccountId && (
         <p className="text-sm">Currently linked: <strong>{linkedNearAccountId}</strong></p>
      )}
    </div>
  );
}
