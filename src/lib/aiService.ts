/**
 * AI Service — Anthropic Claude
 */

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

/** Text-only prompt */
export async function askAI(prompt: string): Promise<string> {
  console.log(`[aiService] Calling Claude (${MODEL}) — text prompt`);

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  console.log(`[aiService] ✅ Response length: ${text.length}`);
  return text;
}

/** Prompt with an inline document (PDF or image) */
export async function askAIWithDocument(
  prompt: string,
  documentBase64: string,
  mimeType: string
): Promise<string> {
  console.log(`[aiService] Calling Claude (${MODEL}) — document (${mimeType})`);

  const content: Anthropic.MessageParam["content"] = [];

  if (mimeType === "application/pdf") {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: documentBase64 },
    } as any);
  } else if (mimeType.startsWith("image/")) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
        data: documentBase64,
      },
    });
  } else {
    // Fallback: send as text
    content.push({ type: "text", text: `Document content (${mimeType}):\n${documentBase64}` });
  }

  content.push({ type: "text", text: prompt });

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    messages: [{ role: "user", content }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  console.log(`[aiService] ✅ Response length: ${text.length}`);
  return text;
}

/** Safely parse JSON from AI response */
export function parseAIJson(text: string): any {
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON object found in AI response");
  return JSON.parse(jsonMatch[0]);
}
