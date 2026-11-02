'use server';

import { refresh } from 'next/cache';
import { turnOffLiveMode, turnOnLiveMode, type LiveSwitchResult } from '@/lib/settings/live-switch';

// The Test / Live switch, saved on its own, at once, apart from the settings form. Like the page,
// these actions sit behind the owner's session (Neon Auth or the built-in login): the proxy never lets a
// Server Action through without it, and an API key never opens one. The rules are in
// lib/settings/live-switch.ts.

export async function turnOnLiveModeAction(confirmation: string): Promise<LiveSwitchResult> {
  try {
    const result = await turnOnLiveMode({ confirmation: String(confirmation ?? '') });
    if (result.ok) refresh();
    return result;
  } catch (error) {
    console.error('Turning live mode on failed', error);
    return { ok: false, error: 'unreadable' };
  }
}

export async function turnOffLiveModeAction(): Promise<LiveSwitchResult> {
  try {
    const result = await turnOffLiveMode();
    refresh();
    return result;
  } catch (error) {
    console.error('Turning live mode off failed', error);
    return { ok: false, error: 'unreadable' };
  }
}
