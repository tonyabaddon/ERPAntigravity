import React from 'react';

export type AvatarGender = 'M' | 'F' | 'N';

interface Props {
  name: string;
  gender?: AvatarGender;
  avatarUrl?: string;
  size?: number;
  className?: string;
}

// Caleo brand palette (verbatim from design tokens)
const C = {
  navy: 'var(--color-caleo-primary)',
  gold: '#F9B233',
  cream: '#FAF7F0',
  emerald: '#2d8a4e',
};

/** Deterministic initial-color from name hash. Reuses palette style from SalesInboxScreen. */
function getInitialsColor(name: string): string {
  const palette = ['#2d8a4e', 'var(--color-caleo-primary)', '#F9B233', '#7C3AED', '#EA580C'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function getInitial(name: string): string {
  return (name?.trim().charAt(0) || '?').toUpperCase();
}

/** Flat friendly Caleo-style male avatar — navy hair + shirt + gold V-neck stripe */
function MaleAvatarSvg({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Avatar cowok">
      <circle cx="20" cy="20" r="20" fill="#DBEAFE" />
      <path d="M 10 15 Q 20 6 30 15 L 30 19 Q 20 15 10 19 Z" fill={C.navy} />
      <rect x="12" y="14" width="16" height="16" rx="8" fill={C.cream} />
      <circle cx="16.5" cy="21" r="1.1" fill={C.navy} />
      <circle cx="23.5" cy="21" r="1.1" fill={C.navy} />
      <path d="M 17 25 Q 20 27 23 25" stroke={C.navy} strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <path d="M 8 40 Q 8 32 14 30 L 20 34 L 26 30 Q 32 32 32 40 Z" fill={C.navy} />
      <path d="M 19 33 L 20 36 L 21 33" stroke={C.gold} strokeWidth="0.8" fill="none" />
    </svg>
  );
}

/** Flat friendly Caleo-style female avatar — flowing hair + gold top with navy neckline */
function FemaleAvatarSvg({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Avatar cewek">
      <circle cx="20" cy="20" r="20" fill="#FCE7F3" />
      <path d="M 8 30 Q 8 12 20 8 Q 32 12 32 30 L 30 30 Q 30 15 20 12 Q 10 15 10 30 Z" fill={C.navy} />
      <rect x="13" y="14" width="14" height="16" rx="7" fill={C.cream} />
      <circle cx="16.5" cy="21" r="1.2" fill={C.navy} />
      <circle cx="23.5" cy="21" r="1.2" fill={C.navy} />
      <path d="M 17 25 Q 20 27 23 25" stroke={C.navy} strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <path d="M 6 40 Q 6 32 12 30 L 20 32 L 28 30 Q 34 32 34 40 Z" fill={C.gold} />
      <ellipse cx="20" cy="31" rx="4" ry="1.5" fill={C.navy} />
    </svg>
  );
}

/** Flat friendly Caleo-style neutral avatar — emerald hair + top */
function NeutralAvatarSvg({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Avatar netral">
      <circle cx="20" cy="20" r="20" fill="#D1FAE5" />
      <path d="M 11 16 Q 20 8 29 16 L 29 20 Q 20 16 11 20 Z" fill={C.emerald} />
      <rect x="12" y="14" width="16" height="16" rx="8" fill={C.cream} />
      <circle cx="16.5" cy="21" r="1.1" fill={C.navy} />
      <circle cx="23.5" cy="21" r="1.1" fill={C.navy} />
      <path d="M 17 25 Q 20 26 23 25" stroke={C.navy} strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <path d="M 8 40 Q 8 32 14 30 L 20 34 L 26 30 Q 32 32 32 40 Z" fill={C.emerald} />
    </svg>
  );
}

function InitialsAvatar({ name, size }: { name: string; size: number }) {
  const color = getInitialsColor(name);
  const initial = getInitial(name);
  return (
    <div
      role="img"
      aria-label={`Avatar ${name || 'unknown'}`}
      style={{
        width: size, height: size, borderRadius: '20%',
        background: color, color: 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.floor(size * 0.4), fontWeight: 800,
      }}
    >
      {initial}
    </div>
  );
}

export function AvatarBadge({
  name, gender, avatarUrl, size = 40, className,
}: Props) {
  if (avatarUrl && avatarUrl.trim().length > 0) {
    return (
      <div className={className}>
        <img
          alt={`Avatar ${name}`}
          src={avatarUrl}
          width={size} height={size}
          referrerPolicy="no-referrer"
          style={{ width: size, height: size, objectFit: 'cover' }}
        />
      </div>
    );
  }
  if (gender === 'M') return <div className={className}><MaleAvatarSvg size={size} /></div>;
  if (gender === 'F') return <div className={className}><FemaleAvatarSvg size={size} /></div>;
  if (gender === 'N') return <div className={className}><NeutralAvatarSvg size={size} /></div>;
  return <div className={className}><InitialsAvatar name={name} size={size} /></div>;
}
