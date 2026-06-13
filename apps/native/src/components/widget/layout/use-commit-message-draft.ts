import { commitMessageBody } from "@/components/widget/summaries/markdown-utils";
import { useSummary } from "@/hooks/use-summary";
import type { SemanticChangeMap } from "@/ipc/types";
import { useCallback, useEffect, useRef, useState } from "react";

const STALE_COMMIT_MESSAGE_MS = 8_000;

export type CommitMessageStatus = "loading" | "ready" | "fallback" | "error";

interface CommitMessageDraft {
  subject: string;
  body: string;
  status: CommitMessageStatus;
  setSubject: (subject: string) => void;
  reset: () => void;
}

function splitCommitMessage(message: string): { subject: string; body: string } {
  return {
    subject: message.split(/\r?\n/)[0] ?? "",
    body: commitMessageBody(message),
  };
}

function fallbackCommitSubject(changeMap: SemanticChangeMap | null): string {
  const filenames = [
    ...(changeMap?.groups.flatMap((group) =>
      group.changes.map((change) => change.filename),
    ) ?? []),
    ...(changeMap?.singles.map((change) => change.filename) ?? []),
  ];
  const uniqueFilenames = [...new Set(filenames.filter(Boolean))];

  if (uniqueFilenames.length === 1) {
    return `chore(nix): update ${uniqueFilenames[0]}`;
  }

  return "chore(nix): update configuration";
}

function changeMapFingerprint(changeMap: SemanticChangeMap | null): string | null {
  if (!changeMap) {
    return null;
  }

  const hashes = [
    ...changeMap.groups.flatMap((group) =>
      group.changes.map((change) => change.hash),
    ),
    ...changeMap.singles.map((change) => change.hash),
    ...changeMap.unsummarizedHashes,
  ];

  // NUL cannot appear inside git object hashes, so it is a collision-safe join delimiter.
  return hashes.sort().join("\0");
}

export function useCommitMessageDraft(
  changeMap: SemanticChangeMap | null,
): CommitMessageDraft {
  const { generateCommitMessage } = useSummary();
  const [subject, setSubjectState] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<CommitMessageStatus>("loading");
  const requestIdRef = useRef(0);
  const statusRef = useRef<CommitMessageStatus>("loading");
  const userEditedRef = useRef(false);
  const fingerprintRef = useRef<string | null>(changeMapFingerprint(changeMap));

  const setDraftStatus = useCallback((nextStatus: CommitMessageStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const reset = useCallback(() => {
    userEditedRef.current = false;
    setDraftStatus("loading");
    setSubjectState("");
    setBody("");
  }, [setDraftStatus]);

  const setSubject = useCallback((nextSubject: string) => {
    userEditedRef.current = true;
    setSubjectState(nextSubject);
  }, []);

  useEffect(() => {
    const currentFingerprint = changeMapFingerprint(changeMap);
    const didChangeMap = fingerprintRef.current !== currentFingerprint;
    fingerprintRef.current = currentFingerprint;

    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    let staleTimer: ReturnType<typeof setTimeout> | null = null;

    if (!changeMap) {
      reset();
      return () => {
        requestIdRef.current += 1;
      };
    }

    if (didChangeMap) {
      reset();
    }

    if (
      !didChangeMap &&
      (statusRef.current === "ready" || statusRef.current === "error")
    ) {
      return () => {
        requestIdRef.current += 1;
      };
    }

    const showFallback = (nextStatus: CommitMessageStatus) => {
      if (requestIdRef.current !== requestId || statusRef.current !== "loading") {
        return;
      }

      setDraftStatus(nextStatus);
      setBody("");
      if (!userEditedRef.current) {
        setSubjectState(fallbackCommitSubject(changeMap));
      }
    };

    void generateCommitMessage().then((result) => {
      if (requestIdRef.current !== requestId) {
        return;
      }

      if (result.status === "ready") {
        const parsed = splitCommitMessage(result.message);
        setDraftStatus("ready");
        if (!userEditedRef.current) {
          setSubjectState(parsed.subject);
          setBody(parsed.body);
        }
        return;
      }

      if (result.status === "error") {
        showFallback("error");
        return;
      }

      if (statusRef.current !== "loading") {
        return;
      }

      staleTimer = setTimeout(() => {
        showFallback("fallback");
      }, STALE_COMMIT_MESSAGE_MS);
    });

    return () => {
      requestIdRef.current += 1;
      if (staleTimer) {
        clearTimeout(staleTimer);
      }
    };
  }, [changeMap, generateCommitMessage, reset, setDraftStatus]);

  return { subject, body, status, setSubject, reset };
}
