import { storybookDarwinAPI, tauriEvent } from "./tauri-runtime";

export const darwinAPI = storybookDarwinAPI;

export const ipcRenderer = {
  on: tauriEvent.listen,
  once: tauriEvent.once,
};
