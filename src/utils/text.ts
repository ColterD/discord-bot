/**
 * Text utility functions
 */

/**
 * Check if the text ends inside a code block
 */
function isInsideCodeBlock(text: string): boolean {
  const matches = text.match(/```/g);
  return matches ? matches.length % 2 !== 0 : false;
}

/**
 * Find the best split index for a chunk of text
 */
function findSplitIndex(text: string, maxLength: number, insideCodeBlock: boolean): number {
  let splitIndex = maxLength;

  if (insideCodeBlock) {
    // Inside code block: prefer splitting at newline
    const lastNewline = text.lastIndexOf("\n", splitIndex);
    if (lastNewline > splitIndex * 0.8) {
      splitIndex = lastNewline;
    }
  } else {
    // Outside code block: prefer newline, then space
    const lastNewline = text.lastIndexOf("\n", splitIndex);
    if (lastNewline > splitIndex * 0.8) {
      splitIndex = lastNewline;
    } else {
      const lastSpace = text.lastIndexOf(" ", splitIndex);
      if (lastSpace > splitIndex * 0.8) {
        splitIndex = lastSpace;
      }
    }
  }

  return splitIndex;
}

/**
 * Get the language of the current open code block
 */
function getOpenBlockLanguage(text: string): string {
  const allBackticks = [...text.matchAll(/```(\w*)/g)];
  const lastOpening = allBackticks.at(-1);
  return lastOpening?.[1] ?? "";
}

/**
 * Split a message into chunks for Discord's character limit, respecting code blocks
 * @param text The text to split
 * @param maxLength The maximum length of each chunk (default 2000)
 * @returns Array of text chunks
 */
export function splitMessage(text: string, maxLength = 2000): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Check if we are inside a code block at the max length
    const potentialChunk = remaining.slice(0, maxLength);
    const insideBlock = isInsideCodeBlock(potentialChunk);

    // Find the best split point
    const splitIndex = findSplitIndex(remaining, maxLength, insideBlock);

    // If we are inside a block at the split point (re-check with actual split index)
    // Note: findSplitIndex might have reduced the length, so we need to check again
    // if the *actual* split point is inside a block.
    // Actually, it's safer to check the chunk we are about to cut.
    const chunkToCut = remaining.slice(0, splitIndex);
    const actuallyInsideBlock = isInsideCodeBlock(chunkToCut);

    let chunk = chunkToCut;
    let nextRemaining = remaining.slice(splitIndex);

    if (actuallyInsideBlock) {
      const language = getOpenBlockLanguage(chunk);

      // Close the block in the current chunk
      chunk += "\n```";

      // Reopen the block in the next chunk
      nextRemaining = `\`\`\`${language}\n${nextRemaining}`;
    }

    chunks.push(chunk);
    remaining = nextRemaining;
  }

  return chunks;
}
