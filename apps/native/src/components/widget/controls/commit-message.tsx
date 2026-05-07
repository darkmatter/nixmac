interface CommitMessageProps {
  hash: string;
  message: string | null;
  originMessage?: string;
}

export function CommitMessage({ hash, message, originMessage }: CommitMessageProps) {
  return (
    <>
      <span className="text-[13px] font-medium leading-[1.4] text-white">
        {message ?? `Commit ${hash}`}
      </span>
      {originMessage && (
        <p className="mt-0.5 text-[11px] leading-snug text-neutral-500">
          {originMessage}
        </p>
      )}
    </>
  );
}
