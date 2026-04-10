interface FilenameBadgeProps {
  filename: string;
}

export function FilenameBadge({ filename }: FilenameBadgeProps) {
  const basename = filename.split("/").pop() ?? filename;
  return (
    <span className="inline-flex items-center rounded bg-white/[0.04] px-[7px] py-0.5 text-[10px] text-neutral-400">
      {basename}
    </span>
  );
}
