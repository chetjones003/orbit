/**
 * Sign-in status as the renderer sees it. Deliberately contains no token
 * material. `sessionId` changes whenever the signed-in account changes, so the
 * renderer can drop in-memory work that belongs to a previous session.
 */
export type AuthStatus =
  | { kind: 'signed-out'; notice?: string }
  | {
      kind: 'device-pending';
      userCode: string;
      verificationUri: string;
      /** Epoch milliseconds when the code stops working. */
      expiresAt: number;
    }
  | {
      kind: 'signed-in';
      sessionId: number;
      login: string;
      /** False when the credentials could not be saved; sign-in ends when Orbit quits. */
      persistent: boolean;
      notice?: string;
    }
  | {
      kind: 'reauth-required';
      sessionId: number;
      login: string;
      notice: string;
    };

export const SIGNED_OUT: AuthStatus = { kind: 'signed-out' };
