import type { ReactNode } from 'react';
import type { IconKind } from '@/lib/types';

/** Flat Meteocons artwork, served from public/icons/weather (MIT, Bas Milius). */
export function Icon({ kind }: { kind: IconKind }) {
  if (kind === 'none') return <span className="icon" aria-hidden="true" />; // no source gave a condition
  return <img className="icon" src={`/icons/weather/${kind}.svg`} alt="" width={32} height={32} />;
}

export function Toggle({ on, label }: { on: boolean; label?: string }) {
  return <span className={`toggle${on ? ' on' : ''}`} aria-label={label}><span /></span>;
}

export function ToggleRow({ on, onClick, children, className = '' }: { on: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`toggle-row ${className}`} onClick={onClick}>
      {children}<Toggle on={on} />
    </button>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange, dark, className = '' }: {
  options: [T, string][]; value: T; onChange: (v: T) => void; dark?: boolean; className?: string;
}) {
  return (
    <div className={`seg${dark ? ' dark' : ''} ${className}`} role="radiogroup">
      {options.map(([v, label]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={v === value} className={v === value ? 'sel' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="label">{children}</div>;
}
