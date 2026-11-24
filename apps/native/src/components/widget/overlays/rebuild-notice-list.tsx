import { useState } from "react";
import { AppWindow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tauriAPI } from "@/ipc/api";
import type { RebuildNotice } from "@/types/rebuild";

export function RebuildNoticeList({ notices }: { notices: RebuildNotice[] }) {
  const [requestingPermission, setRequestingPermission] = useState<string | null>(null);

  if (notices.length === 0) {
    return null;
  }

  async function handlePermissionAction(permissionId: string) {
    setRequestingPermission(permissionId);
    try {
      await tauriAPI.permissions.request(permissionId);
      await tauriAPI.permissions.refresh();
    } finally {
      setRequestingPermission(null);
    }
  }

  return (
    <div className="mb-4 flex flex-col gap-3">
      {notices.map((notice) => {
        const permissionId = notice.permissionId;
        const isRequestingPermission = requestingPermission === permissionId;

        return (
          <div
            key={notice.id}
            className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-amber-50 shadow-lg shadow-amber-950/20"
          >
            <div className="flex gap-3">
              <AppWindow className="mt-0.5 size-5 shrink-0 text-amber-200" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm text-amber-100">{notice.title}</p>
                <p className="mt-1 text-amber-50/85 text-xs leading-relaxed">{notice.body}</p>
                {permissionId ? (
                  <Button
                    className="mt-3 border-amber-200/30 text-amber-50 hover:bg-amber-200/10"
                    disabled={isRequestingPermission}
                    onClick={() => handlePermissionAction(permissionId)}
                    size="sm"
                    variant="outline"
                  >
                    {isRequestingPermission
                      ? "Opening…"
                      : (notice.actionLabel ?? "Open System Settings")}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

