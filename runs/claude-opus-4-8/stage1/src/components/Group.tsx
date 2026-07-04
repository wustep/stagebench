import type { ReactNode } from 'react';

interface GroupProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

/** A labeled sub-panel (bordered group with a caption), matching the panel's
 * silk-screened boxes (ORGAN MODEL, VIB/CHORUS, MOD 1, DELAY, ...). */
export function Group({ title, children, className }: GroupProps) {
  return (
    <div className={`group ${className ?? ''}`}>
      {title ? <span className="group-title">{title}</span> : null}
      <div className="group-body">{children}</div>
    </div>
  );
}
