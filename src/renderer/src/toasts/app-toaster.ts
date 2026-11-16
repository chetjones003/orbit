import { createToaster } from '@ui-sdk/react/toast';

/** How long an action result or a notification stays before it closes on its own. */
export const TOAST_MS = 6000;

/**
 * The one toaster the app shows through. Action results, notifications and the dev test buttons all go here, and
 * AppToasts renders it once, at the top right.
 */
export const appToaster = createToaster();
