import { useEffect, useRef } from 'react';

export interface ItemMenuProps {
  x: number;
  y: number;
  onOpenFull(): void;
  onOpenSide(): void;
  onClose(): void;
}

/** The menu for an item in the list: open it full screen, or in a side panel. Closes on Escape or outside press. */
export function ItemMenu({ x, y, onOpenFull, onOpenSide, onClose }: ItemMenuProps) {
  const menu = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onPress = (event: MouseEvent): void => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPress);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPress);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div ref={menu} className="item-menu" role="menu" style={{ left: x, top: y }}>
      <button type="button" role="menuitem" onClick={onOpenFull}>
        Open full screen
      </button>
      <button type="button" role="menuitem" onClick={onOpenSide}>
        Open in side panel
      </button>
    </div>
  );
}
