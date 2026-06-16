import { tauriAPI } from "@/ipc/api";

const checkNix = async () => {
  // nix_check writes the NixInstallState cell and emits
  // nix_install_state_changed; viewmodel/nix-install.ts mirrors it into the
  // ViewModel. External nix setup means there is no in-app install flow.
  await tauriAPI.nix.check().catch(() => {});
};

export function useNixInstall() {
  return { checkNix };
}
