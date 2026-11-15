import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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

/** Dismiss handlers of the open dialogs, outermost first. */
const openDialogs: (() => void)[] = [];

/**
 * A dialog centred over the window. Escape or a click on the backdrop closes it, focus moves into it when it
 * opens, and focus goes back to whatever opened it when it closes.
 */
export function Modal({ title, subtitle, onClose, children, className }: ModalProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    // Dialogs can stack (a dialog opened from settings). Escape closes only the one on top.
    const dismiss = (): void => closeRef.current();
    openDialogs.push(dismiss);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && openDialogs[openDialogs.length - 1] === dismiss) dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      openDialogs.splice(openDialogs.indexOf(dismiss), 1);
      opener?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={className ? `modal-panel ${className}` : 'modal-panel'}
      >
        <header className="modal-head">
          <div className="modal-title">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
