// Markdown → Slack mrkdwn / Block Kit converter.
// Port of legacy/listeners/slack_listener.py::_md_to_blocks + _md_to_mrkdwn.

export interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

const HEADER_RE = /^(#{1,3})\s+(.+)$/;
const RULE_RE = /^-{3,}$/;
const TABLE_DIVIDER_RE = /^\|[\s\-:|]+\|$/;

export function mdToMrkdwn(text: string): string {
  return text
    // Headings → bold
    .replace(/^#{1,3}\s+(.+)$/gm, "*$1*")
    // **bold** → *bold*
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    // [text](url) → <url|text>
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");
}

export function mdToBlocks(markdown: string): SlackBlock[] {
  const blocks: SlackBlock[] = [];
  const lines = markdown.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Horizontal rule
    if (RULE_RE.test(line.trim())) {
      blocks.push({ type: "divider" });
      i++;
      continue;
    }

    // Markdown table — current line has |, next is the divider |---|
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      TABLE_DIVIDER_RE.test(lines[i + 1].trim())
    ) {
      const headerCells = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      i += 2; // skip header + divider

      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
        rows.push(
          lines[i]
            .split("|")
            .map((c) => c.trim())
            .filter(Boolean)
        );
        i++;
      }

      const fields: { type: "mrkdwn"; text: string }[] = [];
      for (const row of rows) {
        for (let col = 0; col < row.length; col++) {
          const label = (headerCells[col] ?? "").replace(/\*\*(.+?)\*\*/g, "*$1*");
          const cell = row[col].replace(/\*\*(.+?)\*\*/g, "*$1*");
          fields.push({ type: "mrkdwn", text: label ? `*${label}*\n${cell}` : cell });
        }
      }
      // Slack caps section fields at 10 — chunk.
      for (let s = 0; s < fields.length; s += 10) {
        blocks.push({ type: "section", fields: fields.slice(s, s + 10) });
      }
      continue;
    }

    // Heading
    const headerMatch = HEADER_RE.exec(line);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const text = headerMatch[2].replace(/\*\*(.+?)\*\*/g, "$1").trim();
      if (level <= 2) {
        blocks.push({
          type: "header",
          text: { type: "plain_text", text, emoji: true },
        });
      } else {
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `*${text}*` },
        });
      }
      i++;
      continue;
    }

    // Regular text — gather consecutive lines until special.
    const buffer: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (RULE_RE.test(l.trim())) break;
      if (HEADER_RE.test(l)) break;
      if (l.includes("|") && i + 1 < lines.length && TABLE_DIVIDER_RE.test(lines[i + 1].trim())) {
        break;
      }
      buffer.push(l);
      i++;
    }

    let chunk = buffer.join("\n").trim();
    if (chunk) {
      chunk = mdToMrkdwn(chunk);
      while (chunk) {
        const slice = chunk.slice(0, 3000);
        chunk = chunk.slice(3000);
        blocks.push({ type: "section", text: { type: "mrkdwn", text: slice } });
      }
    }
  }

  return blocks.length > 0 ? blocks : [{ type: "section", text: { type: "mrkdwn", text: markdown } }];
}
