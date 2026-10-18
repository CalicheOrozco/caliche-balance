import { useSyncExternalStore } from "react";

/** Whether to show Xiaomi's values next to Caliche Balance's. Off until turned on; remembered on this device. */
const KEY = "compare-xiaomi";
const EVENT = "compare-xiaomi-change";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export function useCompareXiaomi(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => false);
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
