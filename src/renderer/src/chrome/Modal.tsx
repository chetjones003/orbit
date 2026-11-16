import type { ReactNode } from 'react';
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@ui-sdk/react/dialog';
import { Icon } from '../icons';

export interface ModalProps {
  title: string;
  /** A line under the title, such as the name of the thing being edited. */
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /** Extra classes for the panel, such as a wider size. */
  className?: string;
}

/**
 * A dialog centred over the window, built on ui-sdk's Dialog. It traps focus, closes on Escape or a press on the
 * backdrop, and returns focus to whatever opened it. The owner unmounts it when it closes.
 */
export function Modal({ title, subtitle, onClose, children, className }: ModalProps) {
  return (
    <Dialog defaultOpen modal onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogBackdrop className="modal-backdrop" />
      <DialogContent
        container={document.body}
        className={className ? `modal-panel ${className}` : 'modal-panel'}
      >
        <header className="modal-head">
          <div className="modal-title">
            <DialogTitle>{title}</DialogTitle>
            {subtitle && <DialogDescription>{subtitle}</DialogDescription>}
          </div>
          <DialogClose aria-label="Close" className="icon-button">
            <Icon name="close" size={14} />
          </DialogClose>
        </header>
        <div className="modal-body">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
