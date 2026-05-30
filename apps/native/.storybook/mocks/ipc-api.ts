import { storybookTauriAPI, tauriEvent } from "./tauri-runtime";

export const tauriAPI = storybookTauriAPI;

export const ipcRenderer = {
  on: tauriEvent.listen,
  once: tauriEvent.once,
};
