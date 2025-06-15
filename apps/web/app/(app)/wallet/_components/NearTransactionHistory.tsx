// apps/web/app/(app)/wallet/_components/NearTransactionHistory.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@play-money/ui/components/Button'; // Assuming Button component exists

async function fetcher(url: string, options?: RequestInit) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: 'Request failed with status ' + res.status }));
    throw new Error(errorData.error || 'An error occurred');
  }
  return res.json();
}

interface NearTransaction {
  id: string;
  type: 'deposit' | 'withdrawal';
  status: string; // e.g., COMPLETED, PENDING, FAILED
  amount: string; // Already formatted as NEAR string
  currency: 'NEAR';
  nearAccountId: string; // Sender for deposits, Recipient for withdrawals
  nearTransactionHash: string | null;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  failureReason?: string | null;
}

interface ApiResponse {
  data: NearTransaction[];
  pagination: {
    offset: number;
    limit: number;
    totalCount: number;
  };
}

const ITEMS_PER_PAGE = 10;

export function NearTransactionHistory() {
  const [transactions, setTransactions] = useState<NearTransaction[]>([]);
  const [pagination, setPagination] = useState({ offset: 0, limit: ITEMS_PER_PAGE, totalCount: 0 });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTransactions = useCallback(async (offset: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const data: ApiResponse = await fetcher(`/api/near/transactions?limit=${ITEMS_PER_PAGE}&offset=${offset}`);
      setTransactions(data.data);
      setPagination(data.pagination);
    } catch (err: any) {
      setError('Failed to load transaction history: ' + err.message);
      setTransactions([]); // Clear transactions on error
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTransactions(0); // Initial fetch
  }, [fetchTransactions]);

  const handleNextPage = () => {
    if (pagination.offset + pagination.limit < pagination.totalCount) {
      const newOffset = pagination.offset + pagination.limit;
      fetchTransactions(newOffset);
    }
  };

  const handlePreviousPage = () => {
    if (pagination.offset > 0) {
      const newOffset = Math.max(0, pagination.offset - pagination.limit);
      fetchTransactions(newOffset);
    }
  };

  const nearExplorerUrl = (txHash: string) => {
     // Assuming testnet for now. This should be configurable based on environment.
     return `https://explorer.testnet.near.org/transactions/${txHash}`;
  }

  if (isLoading && transactions.length === 0) { // Show initial loading prominently
    return <div>Loading transaction history...</div>;
  }

  return (
    <div className="space-y-4 p-4 border rounded-lg">
      <h3 className="text-lg font-semibold">NEAR Transaction History</h3>

      {error && <div className="p-2 rounded bg-red-100 text-red-700">{error}</div>}

      {transactions.length === 0 && !isLoading && !error && (
        <p>No NEAR transactions found.</p>
      )}

      {transactions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200" style={{ tableLayout: 'auto', width: '100%' }}>
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount (NEAR)</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Account</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tx Hash</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{new Date(tx.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-sm capitalize">{tx.type}</td>
                  <td className={`px-3 py-2 whitespace-nowrap text-sm font-medium ${tx.type === 'deposit' ? 'text-green-600' : 'text-red-600'}`}>
                    {tx.type === 'deposit' ? '+' : '-'} {tx.amount}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-sm">
                     <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                         tx.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                         tx.status === 'PENDING' || tx.status === 'PROCESSING' ? 'bg-yellow-100 text-yellow-800' :
                         tx.status === 'FAILED' || tx.status === 'REQUIRES_MANUAL_INTERVENTION' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'
                     }`}>
                         {tx.status}
                     </span>
                     {tx.failureReason && <p className="text-xs text-red-500 mt-1 break-words" style={{maxWidth: '150px'}}>{tx.failureReason}</p>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 font-mono break-all" style={{maxWidth: '200px'}}>{tx.nearAccountId}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-sm">
                    {tx.nearTransactionHash ? (
                      <a
                        href={nearExplorerUrl(tx.nearTransactionHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                        title={tx.nearTransactionHash}
                      >
                        {`${tx.nearTransactionHash.substring(0, 6)}...${tx.nearTransactionHash.substring(tx.nearTransactionHash.length - 4)}`}
                      </a>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination.totalCount > ITEMS_PER_PAGE && ( // Only show pagination if more than one page
        <div className="flex justify-between items-center mt-4">
          <Button
            onClick={handlePreviousPage}
            disabled={pagination.offset === 0 || isLoading}
          >
            Previous
          </Button>
          <span className="text-sm text-gray-700">
            Page {Math.floor(pagination.offset / pagination.limit) + 1} of {Math.ceil(pagination.totalCount / pagination.limit)}
          </span>
          <Button
            onClick={handleNextPage}
            disabled={pagination.offset + pagination.limit >= pagination.totalCount || isLoading}
          >
            Next
          </Button>
        </div>
      )}
      {isLoading && transactions.length > 0 && <div className="text-center py-2 text-sm text-gray-500">Updating transactions...</div>}
    </div>
  );
}
