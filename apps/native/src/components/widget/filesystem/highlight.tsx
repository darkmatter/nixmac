import { Fragment, type ReactNode } from "react";

const KW = /\b(let|in|with|inherit|rec|if|then|else|true|false|null|import|builtins)\b/g;
const STR = /"(?:[^"\\]|\\.)*"/g;
const ATTR = /\b[a-zA-Z_][\w-]*(?=\s*=)/g;
const NUM = /\b\d+(?:\.\d+)?\b/g;

type Seg = { text: string; color: string | null };

function applyRegex(segs: Seg[], re: RegExp, color: string): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    if (s.color) {
      out.push(s);
      continue;
    }
    let last = 0;
    re.lastIndex = 0;
    const text = s.text;
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: classic regex iteration
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ text: text.slice(last, m.index), color: null });
      out.push({ text: m[0], color });
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (last < text.length) out.push({ text: text.slice(last), color: null });
  }
  return out;
}

/**
 * Splits a line into (body, comment) at the first `#` that isn't inside
 * a `"..."` string literal. The naive `^(.*?)(#.*)$` regex breaks on
 * common Nix forms like `"github:NixOS/nixpkgs#main"`.
 */
function splitAtComment(line: string): [string, string | null] {
  let inString = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (c === "#" && !inString) {
      return [line.slice(0, i), line.slice(i)];
    }
  }
  return [line, null];
}

export function highlightNix(src: string): ReactNode {
  return src.split("\n").map((line, i) => {
    const [body, comment] = splitAtComment(line);

    let segs: Seg[] = [{ text: body, color: null }];
    segs = applyRegex(segs, new RegExp(STR.source, "g"), "text-emerald-300");
    segs = applyRegex(segs, new RegExp(KW.source, "g"), "text-sky-300");
    segs = applyRegex(segs, new RegExp(ATTR.source, "g"), "text-teal-300");
    segs = applyRegex(segs, new RegExp(NUM.source, "g"), "text-amber-300");

    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: stable per render
      <div key={i} className="whitespace-pre">
        <span className="inline-block w-7 select-none pr-2 text-right text-muted-foreground tabular-nums">
          {i + 1}
        </span>
        {segs.map((s, j) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: stable per render
          <Fragment key={j}>
            {s.color ? <span className={s.color}>{s.text}</span> : s.text}
          </Fragment>
        ))}
        {comment && <span className="text-muted-foreground italic">{comment}</span>}
      </div>
    );
  });
}

// Tiny single-line nix-attr highlighter for the untracked diff preview.
export function highlightNixLine(line: string): ReactNode {
  let segs: Seg[] = [{ text: line, color: null }];
  segs = applyRegex(segs, new RegExp(STR.source, "g"), "text-emerald-300");
  segs = applyRegex(
    segs,
    /\b(homebrew|system|environment|services|programs|launchd|defaults|users|security|networking)\b/g,
    "text-sky-300",
  );
  segs = applyRegex(segs, /\b(true|false|null)\b/g, "text-amber-300");
  return segs.map((s, j) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: stable per render
    <Fragment key={j}>{s.color ? <span className={s.color}>{s.text}</span> : s.text}</Fragment>
  ));
}
