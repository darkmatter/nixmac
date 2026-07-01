export function CommitHashBadge({ hash }: { hash: string }) {
  return (
    <span className="rounded bg-teal-400/8 px-[7px] py-0.5 font-mono text-[10px] text-teal-400">
      {hash.slice(0, 7)}
    </span>
  );
}
