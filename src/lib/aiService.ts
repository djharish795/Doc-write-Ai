/**
 * AI Service — Google Gemini
 * Single model with retry + backoff on 429 rate limit errors
 */

import { GoogleGenerativeAI, GenerativeModel, Part } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

const generationConfig = {
  temperature: 0.1,
  maxOutputTokens: 8192,
};

function getModel(): GenerativeModel {
  return genAI.getGenerativeModel({ model: MODEL, generationConfig });
}

/** Wait for ms milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract retry delay from 429 error message.
 * Gemini returns "Please retry in Xs." in the error body.
 */
function extractRetryDelay(errorMessage: string): number {
  const match = errorMessage.match(/retry in (\d+(\.\d+)?)s/i);
  if (match) {
    return Math.ceil(parseFloat(match[1])) * 1000; // convert to ms
  }
  return 10000; // default 10s
}

/**
 * Call Gemini with automatic retry on 429 (up to 3 attempts)
 */
async function callWithRetry(
  fn: () => Promise<string>,
  maxRetries = 3
): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const is429 = error.message?.includes("429") || error.status === 429;

      if (is429 && attempt < maxRetries) {
        const delay = extractRetryDelay(error.message);
        console.warn(
          `[aiService] 429 Rate limit hit. Retrying in ${delay / 1000}s... (attempt ${attempt}/${maxRetries})`
        );
        await sleep(delay);
        continue;
      }

      // Not a 429 or out of retries — throw clean error
      if (is429) {
        throw new Error(
          `Gemini API quota exceeded. The free tier limit has been reached for model "${MODEL}". ` +
          `Please wait a minute and try again, or upgrade your Google AI Studio plan at https://ai.google.dev/`
        );
      }

      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

/** Text-only prompt */
export async function askAI(prompt: string): Promise<string> {
  console.log(`[aiService] Calling Gemini (${MODEL}) — text prompt`);

  return callWithRetry(async () => {
    const model = getModel();
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    console.log(`[aiService] ✅ Response length: ${text.length}`);
    return text;
  });
}

/** Prompt with an inline document (PDF or image) */
export async function askAIWithDocument(
  prompt: string,
  documentBase64: string,
  mimeType: string
): Promise<string> {
  console.log(`[aiService] Calling Gemini (${MODEL}) — document (${mimeType})`);

  return callWithRetry(async () => {
    const model = getModel();
    const parts: Part[] = [
      { inlineData: { mimeType, data: documentBase64 } },
      { text: prompt },
    ];
    const result = await model.generateContent(parts);
    const text = result.response.text();
    console.log(`[aiService] ✅ Response length: ${text.length}`);
    return text;
  });
}

/** Safely parse JSON from AI response */
export function parseAIJson(text: string): any {
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON object found in AI response");
  return JSON.parse(jsonMatch[0]);
}
