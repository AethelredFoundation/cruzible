/**
 * WalletButton — Production wallet connection component.
 *
 * Handles all wallet UX states:
 *   - Not connected: "Connect Wallet" button
 *   - Connecting: loading spinner
 *   - Wrong network: "Switch Network" prompt
 *   - Connected: address display with balance dropdown
 *   - Wallet not detected: install prompt
 */

import React, { useCallback, useRef, useState, useEffect } from "react";
import { useAccount, useConnect } from "wagmi";
import { useApp } from "@/contexts/AppContext";
import { truncateAddress, formatNumber } from "@/lib/utils";
import { activeChain } from "@/config/wagmi";

export function WalletButton() {
  const { wallet, connectWallet, disconnectWallet, switchNetwork } = useApp();
  const { connectors } = useConnect();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showConnectorModal, setShowConnectorModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
        setShowConnectorModal(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // --- Wrong Network State ---
  if (wallet.isWrongNetwork) {
    return (
      <button
        onClick={switchNetwork}
        className="flex items-center gap-2 rounded-lg bg-amber-600/20 border border-amber-500/40 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-600/30 transition-colors"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
        Switch to {activeChain.name}
      </button>
    );
  }

  // --- Connecting State ---
  if (wallet.isConnecting) {
    return (
      <button
        disabled
        className="flex items-center gap-2 rounded-lg bg-gray-800 border border-gray-700 px-4 py-2 text-sm font-medium text-gray-400 cursor-wait"
      >
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            className="opacity-25"
          />
          <path
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            fill="currentColor"
            className="opacity-75"
          />
        </svg>
        Connecting...
      </button>
    );
  }

  // --- Connected State ---
  if (wallet.connected) {
    return (
      <div ref={dropdownRef} className="relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-2 rounded-lg bg-gray-800/80 border border-gray-700 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700/80 hover:border-gray-600 transition-colors"
        >
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
          <span className="font-mono text-xs">
            {truncateAddress(wallet.address, 6, 4)}
          </span>
          <svg
            className={`h-3.5 w-3.5 text-gray-400 transition-transform ${showDropdown ? "rotate-180" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {showDropdown && (
          <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-gray-700 bg-gray-900 p-4 shadow-2xl z-50">
            <div className="mb-3 pb-3 border-b border-gray-800">
              <p className="text-xs text-gray-500 mb-1">Connected Address</p>
              <p className="font-mono text-xs text-gray-300 break-all">
                {wallet.address}
              </p>
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">AETHEL</span>
                <span className="text-sm font-medium text-gray-200">
                  {formatNumber(wallet.balance, 4)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">stAETHEL</span>
                <span className="text-sm font-medium text-gray-200">
                  {formatNumber(wallet.stBalance, 4)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Network</span>
                <span className="text-xs text-emerald-400">
                  {activeChain.name}
                </span>
              </div>
            </div>

            <button
              onClick={() => {
                disconnectWallet();
                setShowDropdown(false);
              }}
              className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Disconnect Wallet
            </button>
          </div>
        )}
      </div>
    );
  }

  // --- Disconnected State ---
  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => {
          // If only one connector available, connect directly
          if (connectors.length <= 1) {
            connectWallet();
          } else {
            setShowConnectorModal(!showConnectorModal);
          }
        }}
        className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 transition-colors shadow-lg shadow-red-900/30"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 12V7H5a2 2 0 010-4h14v4" />
          <path d="M3 5v14a2 2 0 002 2h16v-5" />
          <path d="M18 12a1 1 0 100 2 1 1 0 000-2z" />
        </svg>
        CONNECT WALLET
      </button>

      {showConnectorModal && (
        <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-gray-700 bg-gray-900 p-3 shadow-2xl z-50">
          <p className="text-xs text-gray-400 mb-3 font-medium">
            Choose Wallet
          </p>
          <div className="space-y-1.5">
            {connectors.map((connector) => (
              <button
                key={connector.uid}
                onClick={() => {
                  connectWallet();
                  setShowConnectorModal(false);
                }}
                className="w-full flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-800/50 px-3 py-2.5 text-sm text-gray-200 hover:bg-gray-700/50 hover:border-gray-600 transition-colors"
              >
                <span className="h-6 w-6 rounded-full bg-gray-700 flex items-center justify-center text-xs">
                  {connector.name.charAt(0)}
                </span>
                {connector.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
