/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export interface TabDef<T extends string> {
  id: T;
  label: string;
}

interface TabBarProps<T extends string> {
  tabs: TabDef<T>[];
  active: T;
  onChange: (id: T) => void;
}

export default function TabBar<T extends string>({ tabs, active, onChange }: TabBarProps<T>) {
  return (
    <div className="border-b border-[#1e3d60]/10 flex gap-1">
      {tabs.map(tab => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`px-5 py-3 text-sm border-b-2 transition-colors cursor-pointer ${
              isActive
                ? 'font-bold text-[var(--color-caleo-primary)] border-[#2d8a4e]'
                : 'font-semibold text-[#0b1c30]/50 border-transparent hover:text-[#0b1c30]'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
