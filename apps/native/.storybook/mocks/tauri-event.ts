import { tauriEvent } from "./tauri-runtime";

export type Event<T> = {
  payload: T;
};

export const listen = tauriEvent.listen;
export const once = tauriEvent.once;
