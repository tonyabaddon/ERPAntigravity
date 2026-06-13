/**
 * Renders the channel icon: brand SVG (loaded via <img>) for marketplace/social
 * channels, Lucide icon for non-brand channels.
 *
 * Usage: <ChannelIcon code="shopee" size={20} className="text-white" />
 */

import React from 'react';
import { Store, Warehouse, Briefcase, Tent, Globe, type LucideIcon } from 'lucide-react';
import { getChannelDef } from '../../lib/salesChannels';
import type { SalesChannel } from '../../types';

// Lucide icon registry — map ChannelDef.iconAsset string to component
const LUCIDE_REGISTRY: Record<string, LucideIcon> = {
  Store,
  Warehouse,
  Briefcase,
  Tent,
  Globe,
};

interface ChannelIconProps {
  code: SalesChannel;
  size?: number;        // pixel size, default 20
  className?: string;   // extra Tailwind classes (e.g. for tint via currentColor)
  /**
   * When 'white' (default), tint SVG icons to white via filter (assumes icon container
   * has a colored background). When 'none', render SVG as-is (assumes icon container
   * is transparent or default).
   */
  tint?: 'white' | 'none';
}

export default function ChannelIcon({ code, size = 20, className = '', tint = 'white' }: ChannelIconProps) {
  const def = getChannelDef(code);
  if (def.iconType === 'lucide') {
    const Icon = LUCIDE_REGISTRY[def.iconAsset];
    if (!Icon) return null;
    return <Icon size={size} className={className} />;
  }
  // SVG asset — render <img>. Optionally tint to white via filter when sitting on
  // a colored background (caller signals via tint='white').
  return (
    <img
      src={def.iconAsset}
      alt={def.label}
      style={{
        width: size,
        height: size,
        ...(tint === 'white' && { filter: 'brightness(0) invert(1)' }),
      }}
      className={className}
    />
  );
}
