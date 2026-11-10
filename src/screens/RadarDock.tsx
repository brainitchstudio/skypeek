import { Check, X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type DockToolProps = {
  label: string;
  ariaLabel?: string;
  icon: LucideIcon;
  /** Class that sets the tool's color. */
  tone: string;
  open?: boolean;
  /** A direct on/off control rather than a button that opens a menu. */
  toggle?: boolean;
  /** The tool's layer or mode is running, whether or not its menu is open. */
  on?: boolean;
  /** First tool of a group: draws the divider before it. */
  groupStart?: boolean;
  onClick: () => void;
  children?: ReactNode;
};

/** One button in the radar's grouped dock. */
export function DockTool({ label, ariaLabel, icon: Icon, tone, open = false, toggle = false, on = false, groupStart = false, onClick, children }: DockToolProps) {
  return (
    <div className={`tool ${tone}${toggle ? ' layer' : ''}${groupStart ? ' group-start' : ''}`}>
      <button type="button" aria-label={ariaLabel ?? (toggle ? label : `${label} menu${on ? ', on' : ''}`)}
        {...(toggle ? { 'aria-pressed': on } : { 'aria-expanded': open })}
        className={`${on ? 'on' : ''}${open ? ' open' : ''}`} onClick={onClick}>
        <Icon size={21} strokeWidth={1.9} aria-hidden />
        {children}
      </button>
      {!open && <span className="tip">{on ? `${label} · On` : label}</span>}
    </div>
  );
}

export function DockMenu({ kicker, title, onClose, children }: { kicker: string; title: string; onClose: () => void; children?: ReactNode }) {
  return (
    <section className="dock-menu" aria-label={`${title} menu`}>
      <div className="dock-menu-head">
        <div><small>{kicker}</small><strong>{title}</strong></div>
        <button type="button" aria-label={`Close ${title} menu`} onClick={onClose}><X size={16} aria-hidden /></button>
      </div>
      <div className="dock-menu-body">{children}</div>
    </section>
  );
}

export function DockCheck({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="dock-check" aria-pressed={checked} onClick={onToggle}>
      <span>{label}</span>
      <i className={checked ? 'checked' : ''}>{checked && <Check size={12} strokeWidth={3} aria-hidden />}</i>
    </button>
  );
}
