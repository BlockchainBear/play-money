// apps/web/app/(app)/wallet/_components/AssetSelector.tsx
'use client';

import React from 'react';
import { Button } from '@play-money/ui/components/Button';

export interface AssetOption {
  id: string; // Platform's internal asset ID (e.g., "PRIMARY", "USDC")
  name: string; // User-friendly name (e.g., "NEAR", "USDC")
}

interface AssetSelectorProps {
  assets: AssetOption[];
  selectedAssetId: string;
  onSelectAsset: (assetId: string) => void;
  disabled?: boolean;
}

export function AssetSelector({ assets, selectedAssetId, onSelectAsset, disabled }: AssetSelectorProps) {
  if (!assets || assets.length === 0) {
    return null;
  }

  // Simple buttons for now, could be styled as tabs or a dropdown later
  return (
    <div className="flex space-x-2 my-2">
      {assets.map((asset) => (
        <Button
          key={asset.id}
          variant={selectedAssetId === asset.id ? 'default' : 'outline'}
          onClick={() => onSelectAsset(asset.id)}
          disabled={disabled}
          // Assuming Button has these props from placeholder or actual UI lib
          // size="sm"
          // For placeholder, directly style or assume default is fine
          style={{
            padding: '6px 12px', // A bit smaller for "sm"
            // Basic styling for variant differentiation
            backgroundColor: selectedAssetId === asset.id ? '#007bff' : '#f0f0f0',
            color: selectedAssetId === asset.id ? 'white' : 'black',
            borderColor: selectedAssetId === asset.id ? '#007bff' : '#ccc',
            borderWidth: '1px',
            borderStyle: 'solid',
            borderRadius: '4px',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.6 : 1,
          }}
        >
          {asset.name}
        </Button>
      ))}
    </div>
  );
}
