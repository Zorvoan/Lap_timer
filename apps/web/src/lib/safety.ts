import { getKv, setKv } from './repo';

/** What every driver confirms: at registration, and once before their first timed run. */
export const SAFETY_TEXT = 'I will only drive legally: within speed limits and traffic rules on public roads, flat out only on closed roads or tracks.';
export const SAFETY_DETAIL =
  'Official tracks are public roads unless closed for an event. Lap Timer does not make driving on them safe or legal; you drive at your own risk and responsibility.';

const KEY = 'safetyAck';

export async function hasAcceptedSafety(): Promise<boolean> {
  return (await getKv<boolean>(KEY)) === true;
}

export async function acceptSafety(): Promise<void> {
  await setKv(KEY, true);
}
