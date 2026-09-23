/**
 * WaveLead — channel page title helper.
 *
 * The audit flagged 2 channel-page titles as excessively long (over 60
 * characters, which SERPs truncate). This helper keeps the WaveLead suffix
 * intact and safely shortens only the channel-name segment of the metadata
 * title. It never truncates the visible on-page channel name.
 */
import { fitTitle } from './metadata';

export function channelMetaTitle(channelName: string): string {
  const clean = (channelName || '').trim() || 'WhatsApp Channel';
  // "{Channel Name} | WaveLead" — target <=60 chars for SERP display.
  return fitTitle(clean, ' | WaveLead', 60);
}
