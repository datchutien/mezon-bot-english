/**
 * Safely extracts plain text from a Mezon message content.
 * Content may be a string, a JSON-encoded string, or an object with t/text/content fields.
 */
export function extractMessageText(content: any): string {
  if (!content) return "";
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === "string") return parsed.trim();
        if (parsed && typeof parsed === "object") {
          return (parsed.t || parsed.text || parsed.content || trimmed).trim();
        }
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (typeof content === "object") {
    return (content.t || content.text || content.content || "").trim();
  }
  return String(content).trim();
}

/**
 * Parses command-line style arguments from a text string, respecting quotes.
 * Example: 'register "NCC English" http://localhost:3000 secret secret'
 * => ['register', 'NCC English', 'http://localhost:3000', 'secret', 'secret']
 */
export function parseCommandLineArgs(input: string): string[] {
  if (!input) return [];
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    if (match[1] !== undefined) {
      matches.push(match[1]);
    } else if (match[2] !== undefined) {
      matches.push(match[2]);
    } else {
      matches.push(match[0]);
    }
  }
  return matches;
}
