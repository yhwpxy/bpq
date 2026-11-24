/** Accept JSONL event streams while preserving plain-output CLI compatibility. */
export function parseCliOutput(stdout) {
  const messages = []; let usage;
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    try {
      const frame = JSON.parse(line);
      const text = frame.text ?? frame.content ?? frame.message?.content ?? frame.item?.text;
      if (typeof text === 'string') messages.push(text);
      if (frame.usage) usage = frame.usage;
    } catch { messages.push(line); }
  }
  return { output: messages.join('\n') || stdout, usage: usage ? { inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? 0, cachedTokens: usage.cached_input_tokens ?? 0, outputTokens: usage.output_tokens ?? usage.completion_tokens ?? 0, known: true } : undefined };
}
