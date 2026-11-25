// A window in a terminal: a bordered box that takes the space it needs and
// leaves when you press esc. Pure, so the frame can be asserted without a TUI.
//
// The rows come in as plain text and go out with a `kind`, so the caller colors
// them: borders dim, title accent, content untouched.

import { textWidth } from "./minimal-ui.js";

const BORDER = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
};

function fit(text, width) {
  const value = String(text ?? "");
  const size = textWidth(value);
  if (size > width) {
    let out = "";
    for (const char of value) {
      if (textWidth(`${out}${char}…`) > width) break;
      out += char;
    }
    return `${out.trimEnd()}…`.padEnd(width);
  }
  return `${value}${" ".repeat(width - size)}`;
}

/**
 * `{ kind, text }` rows for a box of `width` columns: a title in the top border,
 * one line per body row, a hint in the footer, and an empty line before it.
 * The minimum width is the title plus the corners, so a title is never cut.
 */
export function windowFrame({ title = "", body = [], hint = "", width = 80 } = {}) {
  const label = String(title);
  const inner = Math.max(
    12,
    Math.min(Math.trunc(Number(width) || 80) - 4, 96),
    textWidth(label) + 2,
  );
  const horizontal = (size) => BORDER.horizontal.repeat(Math.max(0, size));

  const head = label
    ? `${BORDER.topLeft} ${label} ${horizontal(inner - textWidth(label))}${BORDER.topRight}`
    : `${BORDER.topLeft}${horizontal(inner + 2)}${BORDER.topRight}`;

  const rows = (Array.isArray(body) ? body : []).map((line) => ({
    kind: "body",
    text: `${BORDER.vertical} ${fit(line, inner)} ${BORDER.vertical}`,
  }));

  const footer = hint
    ? [
        { kind: "body", text: `${BORDER.vertical} ${fit("", inner)} ${BORDER.vertical}` },
        { kind: "hint", text: `${BORDER.vertical} ${fit(hint, inner)} ${BORDER.vertical}` },
      ]
    : [];

  return [
    { kind: "border", text: head },
    ...rows,
    ...footer,
    { kind: "border", text: `${BORDER.bottomLeft}${horizontal(inner + 2)}${BORDER.bottomRight}` },
  ];
}
