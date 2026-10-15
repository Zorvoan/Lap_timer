import type { Circuit } from '@laptimer/core';
import { climbText, useElevation } from '../../lib/climb';

/** ", +130 m climb" after a road's length (fetched once for roads saved without a profile). */
export function ClimbSuffix({ circuit }: { circuit: Circuit }) {
  const climb = climbText(useElevation(circuit));
  return climb ? <>, {climb}</> : null;
}
