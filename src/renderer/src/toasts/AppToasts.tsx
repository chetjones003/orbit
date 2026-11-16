import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastRegion,
  ToastTitle
} from '@ui-sdk/react/toast';
import { appToaster } from './app-toaster';

/**
 * The app's toast stack, at the top right under the title bar. It renders the shared toaster, so every toast in the
 * app shares one region, one order, and one set of rules for how long each one stays.
 */
export function AppToasts() {
  return (
    <ToastRegion
      toaster={appToaster}
      side="top"
      align="end"
      maxVisible={3}
      expanded
      aria-label="Notifications"
      className="app-toasts"
    >
      {(item) => (
        <Toast className={`app-toast app-toast-${item.type ?? 'info'}`}>
          <div className="app-toast-body">
            <ToastTitle className="app-toast-title" />
            <ToastDescription className="app-toast-text" />
          </div>
          <ToastAction className="app-toast-action" />
          <ToastClose className="app-toast-close" aria-label="Dismiss">
            ✕
          </ToastClose>
        </Toast>
      )}
    </ToastRegion>
  );
}
