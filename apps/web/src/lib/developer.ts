import { config } from './config';

/** Accounts that may use the GPS simulator: the app's owner (Zdeněk Patík). */
const DEVELOPER_UIDS = new Set(['3sWFupdTN9W2n6tAgnCJSU6awtz1']);

/**
 * Whether the GPS simulator is offered. Everyone else only ever times with real GPS, which keeps
 * the app simple; simulated laps never reach a leaderboard either way. Local development keeps it.
 */
export function simulatorAllowed(uid: string | null | undefined): boolean {
  return config.simulatorEnabled && (import.meta.env.DEV || (!!uid && DEVELOPER_UIDS.has(uid)));
}
