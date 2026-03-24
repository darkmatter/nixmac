import { storybookDarwinAPI, tauriEvent } from "./tauri-runtime";

export const DEFAULT_MAX_ITERATIONS = 25;

export const darwinAPI = storybookDarwinAPI;

export const ipcRenderer = {
  on: tauriEvent.listen,
  once: tauriEvent.once,
};
