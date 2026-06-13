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
}

export default function ChannelIcon({ code, size = 20, className = '' }: ChannelIconProps) {
  const def = getChannelDef(code);
  if (def.iconType === 'lucide') {
    const Icon = LUCIDE_REGISTRY[def.iconAsset];
    if (!Icon) return null;
    return <Icon size={size} className={className} />;
  }
  // SVG asset — render <img> with white tint via filter
  // (Background brand color is set by parent container.)
  return (
    <img
      src={def.iconAsset}
      alt={def.label}
      style={{ width: size, height: size, filter: 'brightness(0) invert(1)' }}
      className={className}
    />
  );
}
