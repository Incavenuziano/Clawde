export interface MarkdownChecklistItem {
  readonly checked: boolean;
  readonly text: string;
}

export interface MarkdownTable {
  readonly headers: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<Readonly<Record<string, string>>>;
}

export function extractChecklistItems(markdown: string): ReadonlyArray<MarkdownChecklistItem> {
  const items: MarkdownChecklistItem[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (match === null) continue;
    items.push({
      checked: (match[1] ?? "").toLowerCase() === "x",
      text: match[2]?.trim() ?? "",
    });
  }
  return items;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

export function extractMarkdownTables(markdown: string): ReadonlyArray<MarkdownTable> {
  const lines = markdown.split(/\r?\n/);
  const tables: MarkdownTable[] = [];

  for (let i = 0; i < lines.length - 1; i++) {
    const headerLine = lines[i];
    const separatorLine = lines[i + 1];
    if (headerLine === undefined || separatorLine === undefined) continue;
    if (!headerLine.includes("|") || !isSeparatorRow(separatorLine)) continue;

    const headers = splitRow(headerLine);
    const rows: Array<Record<string, string>> = [];
    i += 2;
    while (i < lines.length) {
      const line = lines[i];
      if (line === undefined || !line.includes("|") || line.trim().length === 0) {
        i -= 1;
        break;
      }
      const cells = splitRow(line);
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = cells[index] ?? "";
      });
      rows.push(row);
      i += 1;
    }
    tables.push({ headers, rows });
  }

  return tables;
}

export function stripMarkdownFormatting(value: string): string {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}
