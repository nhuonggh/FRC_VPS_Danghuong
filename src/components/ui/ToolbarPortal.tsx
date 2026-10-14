"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Keep table state local while placing its controls in the page header. */
export function ToolbarPortal({ targetId, children }: { targetId?: string; children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setTarget(targetId ? document.getElementById(targetId) : null); }, [targetId]);
  return targetId ? (target ? createPortal(children, target) : null) : children;
}
