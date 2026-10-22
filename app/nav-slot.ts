'use client';

import { useSyncExternalStore } from 'react';

// The place in the side menu, under "Dashboard", where the dashboard puts its reports list.
// AppNav registers the element while the menu is expanded on /dashboard; the dashboard portals
// into it, and shows the list in its own panel when there is no slot (menu collapsed).

let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function setNavSlot(element: HTMLElement | null) {
  if (slot === element) return;
  slot = element;
  listeners.forEach((listener) => listener());
}

export function useNavSlot(): HTMLElement | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => slot,
    () => null,
  );
}
