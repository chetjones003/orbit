import { useEffect, useRef, useState } from 'react';
import type { ItemRef } from './SideList';
import { SidePanel, type SidePanelState } from './SidePanel';
import type { MotionMode } from './motion';

/** The narrowest a side panel can be, in pixels. */
export const SIDE_PANEL_MIN_WIDTH = 320;
/** Room left beside the panels, so the workspace behind them stays visible. */
const MIN_MAIN_WIDTH = 160;
/**
 * How long the close and expand animations run, in milliseconds. Keep these in step with the CSS in index.css:
 * the slide and grow timings, and the fade timings used when motion is set to fade.
 */
const TIMING: Record<MotionMode, { closeMs: number; expandMs: number }> = {
  full: { closeMs: 160, expandMs: 260 },
  fade: { closeMs: 140, expandMs: 180 }
};

interface Leaving {
  key: string;
  mode: 'close' | 'expand';
  item: ItemRef;
}

export interface SidePanelStackProps {
  items: ItemRef[];
  signedInLogin: string;
  width: number;
  motion: MotionMode;
  onWidth(width: number): void;
  /** Called when the expand animation ends: the item opens full screen. */
  onExpand(item: ItemRef): void;
  /** Called when the close animation ends: the item is removed. */
  onClose(item: ItemRef): void;
  onOpenItem(item: ItemRef): void;
}

const keyOf = (item: ItemRef): string => `${item.repoFullName}#${item.number}#${item.kind}`;

/**
 * The side panels, floating over the workspace above it in z-order. They are rounded cards with a shadow, and their
 * left edge drags to resize. Opening, closing and expanding each animate; the item changes only when the animation
 * ends.
 */
export function SidePanelStack({
  items,
  signedInLogin,
  width,
  motion,
  onWidth,
  onExpand,
  onClose,
  onOpenItem
}: SidePanelStackProps) {
  const stackRef = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState<Leaving | null>(null);

  useEffect(() => {
    if (leaving === null) return undefined;
    const timing = TIMING[motion];
    const timer = setTimeout(
      () => {
        setLeaving(null);
        if (leaving.mode === 'close') onClose(leaving.item);
        else onExpand(leaving.item);
      },
      leaving.mode === 'close' ? timing.closeMs : timing.expandMs
    );
    return () => clearTimeout(timer);
  }, [leaving, motion]);

  // Keeps a width between the minimum and the room left beside the workspace. Before the stack is laid out there
  // is no room to measure, so only the minimum applies.
  const clampWidth = (next: number): number => {
    const room = stackRef.current?.clientWidth ?? 0;
    const max = room > 0 ? Math.max(SIDE_PANEL_MIN_WIDTH, room - MIN_MAIN_WIDTH) : Infinity;
    return Math.min(max, Math.max(SIDE_PANEL_MIN_WIDTH, Math.round(next)));
  };

  return (
    <div ref={stackRef} className={`side-panel-stack ${leaving?.mode === 'expand' ? 'is-expanding' : ''}`}>
      {items.map((item) => {
        const key = keyOf(item);
        const state: SidePanelState =
          leaving?.key === key ? (leaving.mode === 'close' ? 'closing' : 'expanding') : 'open';
        return (
          <SidePanel
            key={key}
            item={item}
            signedInLogin={signedInLogin}
            state={state}
            width={width}
            motion={motion}
            onResize={(next) => onWidth(clampWidth(next))}
            onExpand={() => setLeaving({ key, mode: 'expand', item })}
            onClose={() => setLeaving({ key, mode: 'close', item })}
            onOpenItem={onOpenItem}
          />
        );
      })}
    </div>
  );
}
