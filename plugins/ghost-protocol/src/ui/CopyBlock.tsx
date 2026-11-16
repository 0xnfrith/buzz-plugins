import { React } from "../react";
import { WORDS } from "../words";
import { copyText } from "./copy";

/** One command, key or address to put on the clipboard, shown as text with a button that copies it. */
export function CopyBlock({ text, label }: { text: string; label?: string }) {
  const [result, setResult] = React.useState<"copied" | "failed">();
  return (
    <div className="gp-copy">
      <code className="gp-code">{text}</code>
      <button
        type="button"
        className="gp-button"
        aria-label={label === undefined ? undefined : `${WORDS.copy} ${label}`}
        onClick={() => void copyText(text).then((copied) => setResult(copied ? "copied" : "failed"))}
      >
        {result === "copied" ? WORDS.copied : WORDS.copy}
      </button>
      {result === "failed" && <span role="alert">{WORDS.copyFailed}</span>}
    </div>
  );
}
