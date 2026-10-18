import { useSyncExternalStore } from "react";

/** Whether to show Xiaomi's values next to Caliche Balance's. Remembered on this device. */
const KEY = "compare-xiaomi";
const EVENT = "compare-xiaomi-change";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export function useCompareXiaomi(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => true);
  const set = (next: boolean) => {
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [on, set];
}
