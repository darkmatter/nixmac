import { darwinAPI } from "@/tauri-api";
import { useWidgetStore } from "@/stores/widget-store";
import { useCallback, useState } from "react";

export function useDarwinConfig() {
  const [isBootstrapping, setIsBootstrapping] = useState(false);

  const setConfigDir = useWidgetStore((state) => state.setConfigDir);
  const setHosts = useWidgetStore((state) => state.setHosts);
  const setHost = useWidgetStore((state) => state.setHost);
  const setError = useWidgetStore((state) => state.setError);

  const pickDir = useCallback(async () => {
    const dir = (await darwinAPI.config.pickDir()) as string | null;
    if (dir) {
      setConfigDir(dir);

      // Check if flake exists and load hosts
      try {
        const hosts = await darwinAPI.flake.listHosts();
        if (Array.isArray(hosts)) {
          setHosts(hosts);
        } else {
          // shows default config interface
          setHosts([]);
        }
      } catch {
          // shows default config interface
        setHosts([]);
      }
    }
  }, [setConfigDir, setHosts]);

  const saveHost = useCallback(
    async (host: string) => {
      try {
        await darwinAPI.config.setHostAttr(host);
        setHost(host);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setError(`Failed to save host: ${message}`);
      }
    },
    [setHost, setError]
  );

  const bootstrap = useCallback(
    async (hostname: string) => {
      if (!hostname.trim()) {
        return;
      }

      setIsBootstrapping(true);
      try {
        await darwinAPI.flake.bootstrapDefault(hostname);
        const hosts = await darwinAPI.flake.listHosts();
        if (Array.isArray(hosts) && hosts.length > 0) {
          setHosts(hosts);
          if (hosts[0]) {
            await darwinAPI.config.setHostAttr(hosts[0]);
            setHost(hosts[0]);
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setError(`Failed to create configuration: ${message}`);
      } finally {
        setIsBootstrapping(false);
      }
    },
    [setHosts, setHost, setError]
  );

  return { pickDir, saveHost, bootstrap, isBootstrapping };
}