import { useEffect } from 'react';
import { Menu, MenuContent, MenuItem } from '@ui-sdk/react/menu';

export interface ItemMenuProps {
  x: number;
  y: number;
  onOpenFull(): void;
  onOpenSide(): void;
  onClose(): void;
}

/** The menu for an item in the list: open it full screen, or in a side panel. Closes on Escape or outside press. */
export function ItemMenu({ x, y, onOpenFull, onOpenSide, onClose }: ItemMenuProps) {
  // A pointer-opened menu does not move focus into itself, so keyboard users would press keys on the list. Focus the
  // first action once it is open; the menu then handles the arrow keys.
  useEffect(() => {
    document.querySelector<HTMLElement>('.item-menu [role="menuitem"]')?.focus();
  }, []);
  return (
    <Menu open modal="pointer" onOpenChange={(open) => (open ? undefined : onClose())}>
      <MenuContent className="item-menu" anchor={{ x, y }} aria-label="Item actions">
        <MenuItem value="full" onClick={onOpenFull}>
          Open full screen
        </MenuItem>
        <MenuItem value="side" onClick={onOpenSide}>
          Open in side panel
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
