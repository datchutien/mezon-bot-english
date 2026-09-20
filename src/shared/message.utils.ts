/**
 * Detects standalone URLs and returns Mezon LinkOnMessage { s, e } ranges.
 */
export function extractLinksFromText(
  text: string,
): Array<{ s: number; e: number }> {
  const lk: Array<{ s: number; e: number }> = [];
  const urlRegex = /(https?:\/\/[^\s\)\>]+)/g;
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    lk.push({ s: match.index, e: match.index + match[0].length });
  }
  return lk;
}

/**
 * Builds a ChannelMessageContent object with text, link ranges, and components.
 */
export function buildMessageContent(
  text: string,
  components?: any[],
): any {
  const content: any = { t: text };
  const lk = extractLinksFromText(text);
  if (lk.length > 0) content.lk = lk;
  if (components && components.length > 0) content.components = components;
  return content;
}

/**
 * Splits long text into chunks that fit Mezon's message limit.
 * Prefers splitting at double-newlines or single newlines.
 */
export function splitTextIntoChunks(
  text: string,
  maxChunkLength = 3500,
): string[] {
  if (!text) return [];
  if (text.length <= maxChunkLength) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxChunkLength) {
    let splitIdx = remaining.lastIndexOf('\n\n', maxChunkLength);
    if (splitIdx === -1 || splitIdx < maxChunkLength / 2) {
      splitIdx = remaining.lastIndexOf('\n', maxChunkLength);
    }
    if (splitIdx === -1) splitIdx = maxChunkLength;
    chunks.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

/**
 * Builds a link-style button component for Mezon messages.
 */
export function buildLinkButton(id: string, label: string, url: string) {
  return {
    components: [
      {
        id,
        type: 1, // BUTTON
        component: { label, style: 5, url }, // style 5 = LINK
      },
    ],
  };
}
