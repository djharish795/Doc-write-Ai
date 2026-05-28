/**
 * AI Service — Anthropic Claude
 */

import Anthropic from "@anthropic-ai/sdk";

const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.CLAUDE_MODEL || "claude-3-5-sonnet-20241022";

// Validate key exists and is not the default placeholder
const isKeyConfigured = API_KEY.trim() !== "" && API_KEY !== "YOUR_CLAUDE_API_KEY_HERE";

if (!isKeyConfigured) {
  console.warn(
    "\x1b[31m[aiService] ❌ WARNING: ANTHROPIC_API_KEY is not configured or is using the default placeholder in your .env file! Please set your actual API key.\x1b[0m"
  );
}

// We initialize the client. To avoid SDK-level crashes at startup, we provide a dummy string if empty.
// We will validate explicitly during calls to provide a friendly, descriptive error.
const client = new Anthropic({
  apiKey: isKeyConfigured ? API_KEY : "missing-api-key-placeholder",
});

function assertApiKeyConfigured() {
  if (!isKeyConfigured) {
    throw new Error(
      "Claude API Key is not configured. Please add your actual Anthropic API Key (starting with 'sk-ant-') to the ANTHROPIC_API_KEY field in the '.env' file at the root of the project, then try again."
    );
  }
}

/** Text-only prompt */
export async function askAI(prompt: string): Promise<string> {
  assertApiKeyConfigured();
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
  assertApiKeyConfigured();
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
