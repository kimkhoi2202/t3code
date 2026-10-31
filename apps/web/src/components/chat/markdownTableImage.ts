export type TableImageTheme = "dark" | "light";

interface TableImagePalette {
  readonly background: string;
  readonly foreground: string;
  readonly border: string;
}

// The default theme's tokens in index.css, so an image looks the same whichever theme is active.
const TABLE_IMAGE_PALETTES: Record<TableImageTheme, TableImagePalette> = {
  light: {
    background: "var(--color-zinc-25)",
    foreground: "var(--color-zinc-900)",
    border: "var(--color-zinc-200)",
  },
  dark: {
    background: "#000",
    foreground: "var(--color-neutral-100)",
    border: "color-mix(in srgb, var(--color-white) 8%, transparent)",
  },
};

// The mixes `.chat-markdown` applies to table rules and inline code.
const RULE_MIX = "60%";
const CODE_BACKGROUND_MIX = "10%";
const IMAGE_MARGIN_PX = 24;
// Drawn at twice the CSS size so text stays sharp when pasted into a document.
const IMAGE_SCALE = 2;
// The ratio browsers use for `line-height: normal`.
const NORMAL_LINE_HEIGHT = 1.2;

interface TableImageColors {
  readonly background: string;
  readonly text: string;
  readonly rule: string;
  readonly code: string;
}

interface CellLayout {
  readonly left: number;
  readonly width: number;
  readonly padding: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly align: string;
  readonly font: string;
  readonly lineHeight: number;
  readonly lines: readonly string[];
  readonly chip: {
    readonly padding: number;
    readonly radius: number;
    readonly height: number;
  } | null;
  readonly rule: number;
}

function px(value: string): number {
  return Number.parseFloat(value) || 0;
}

// Canvas colors cannot reference CSS variables, so let the browser resolve each one.
function resolveColors(palette: TableImagePalette): TableImageColors {
  const probe = document.createElement("span");
  document.body.append(probe);
  const resolve = (color: string) => {
    probe.style.color = color;
    return getComputedStyle(probe).color;
  };
  try {
    return {
      background: resolve(palette.background),
      text: resolve(palette.foreground),
      rule: resolve(`color-mix(in srgb, ${palette.border} ${RULE_MIX}, transparent)`),
      code: resolve(
        `color-mix(in srgb, ${palette.foreground} ${CODE_BACKGROUND_MIX}, transparent)`,
      ),
    };
  } finally {
    probe.remove();
  }
}

/** A cell holding only inline code, which the image draws as a code chip. */
function soleInlineCode(cell: HTMLTableCellElement): HTMLElement | null {
  const child = cell.firstElementChild;
  return cell.childElementCount === 1 &&
    child instanceof HTMLElement &&
    child.localName === "code" &&
    child.textContent?.trim() === cell.textContent?.trim()
    ? child
    : null;
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (context.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line !== "") lines.push(line);
      // Like `overflow-wrap: break-word`, split a word too wide for a line of its own.
      let rest = Array.from(word);
      while (rest.length > 1 && context.measureText(rest.join("")).width > maxWidth) {
        let fit = rest.length - 1;
        while (fit > 1 && context.measureText(rest.slice(0, fit).join("")).width > maxWidth) {
          fit -= 1;
        }
        lines.push(rest.slice(0, fit).join(""));
        rest = rest.slice(fit);
      }
      line = rest.join("");
    }
    lines.push(line);
  }
  return lines;
}

function layoutCell(
  context: CanvasRenderingContext2D,
  cell: HTMLTableCellElement,
  tableLeft: number,
): CellLayout {
  const style = getComputedStyle(cell);
  const code = soleInlineCode(cell);
  const textStyle = code ? getComputedStyle(code) : style;
  const rect = cell.getBoundingClientRect();
  const chip = code
    ? {
        padding: px(textStyle.paddingLeft),
        radius: px(textStyle.borderTopLeftRadius),
        height: code.getClientRects()[0]?.height ?? 0,
      }
    : null;
  const padding = {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft),
  };
  const font = `${textStyle.fontStyle} ${textStyle.fontWeight} ${textStyle.fontSize} ${textStyle.fontFamily}`;
  const lineHeight = Number.isFinite(Number.parseFloat(style.lineHeight))
    ? px(style.lineHeight)
    : px(style.fontSize) * NORMAL_LINE_HEIGHT;
  context.font = font;
  return {
    left: rect.left - tableLeft,
    width: rect.width,
    padding,
    align: style.textAlign,
    font,
    lineHeight,
    lines: wrapText(
      context,
      cell.innerText.trim(),
      rect.width - padding.left - padding.right - 2 * (chip?.padding ?? 0),
    ),
    chip,
    rule: px(style.borderBottomWidth),
  };
}

function alignedLeft(cell: CellLayout, contentWidth: number): number {
  const start = cell.left + cell.padding.left;
  const free = cell.width - cell.padding.left - cell.padding.right - contentWidth;
  if (cell.align === "center") return start + free / 2;
  if (cell.align === "right" || cell.align === "end") return start + free;
  return start;
}

function drawCell(
  context: CanvasRenderingContext2D,
  cell: CellLayout,
  top: number,
  colors: TableImageColors,
) {
  context.font = cell.font;
  const chipPadding = cell.chip?.padding ?? 0;
  cell.lines.forEach((line, index) => {
    const middle = top + cell.padding.top + index * cell.lineHeight + cell.lineHeight / 2;
    const textWidth = context.measureText(line).width;
    const left = alignedLeft(cell, textWidth + 2 * chipPadding);
    if (cell.chip && line !== "") {
      context.fillStyle = colors.code;
      context.beginPath();
      context.roundRect(
        left,
        middle - cell.chip.height / 2,
        textWidth + 2 * chipPadding,
        cell.chip.height,
        cell.chip.radius,
      );
      context.fill();
    }
    context.fillStyle = colors.text;
    context.fillText(line, left + chipPadding, middle);
  });
}

/**
 * Draws a rendered chat table as a PNG in the given theme. It reads layout, fonts and spacing from
 * the table as shown, so call it while the table is on screen.
 */
export async function renderTableImage(
  table: HTMLTableElement,
  theme: TableImageTheme,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas drawing is unavailable.");
  const tableRect = table.getBoundingClientRect();
  const rows = Array.from(table.rows, (row) => {
    const cells = Array.from(row.cells, (cell) => layoutCell(context, cell, tableRect.left));
    return {
      cells,
      height: Math.max(
        0,
        ...cells.map(
          (cell) => cell.padding.top + cell.lines.length * cell.lineHeight + cell.padding.bottom,
        ),
      ),
      rule: Math.max(0, ...cells.map((cell) => cell.rule)),
    };
  });
  const width = tableRect.width + IMAGE_MARGIN_PX * 2;
  const height = rows.reduce((total, row) => total + row.height, 0) + IMAGE_MARGIN_PX * 2;

  // Resizing the canvas resets its context, so size it before drawing.
  canvas.width = Math.ceil(width * IMAGE_SCALE);
  canvas.height = Math.ceil(height * IMAGE_SCALE);
  const colors = resolveColors(TABLE_IMAGE_PALETTES[theme]);
  context.scale(IMAGE_SCALE, IMAGE_SCALE);
  context.fillStyle = colors.background;
  context.fillRect(0, 0, width, height);
  context.translate(IMAGE_MARGIN_PX, IMAGE_MARGIN_PX);
  context.textBaseline = "middle";
  let top = 0;
  for (const row of rows) {
    for (const cell of row.cells) drawCell(context, cell, top, colors);
    top += row.height;
    if (row.rule > 0) {
      context.fillStyle = colors.rule;
      context.fillRect(0, top - row.rule, tableRect.width, row.rule);
    }
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The table image could not be encoded."))),
      "image/png",
    ),
  );
}
