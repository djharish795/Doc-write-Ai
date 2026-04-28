import { NextRequest, NextResponse } from "next/server";

/**
 * update-agreement
 *
 * When the user modifies editable fields in the frontend customization step (Step 5),
 * this route re-applies all updated field values to the filled HTML and returns
 * the updated HTML for preview and PDF re-generation.
 *
 * This is a lightweight route — no AI needed, pure string replacement.
 */
export async function POST(req: NextRequest) {
  try {
    const { filledHtml, editableFields } = await req.json();

    if (!filledHtml) {
      return NextResponse.json({ error: "filledHtml is required" }, { status: 400 });
    }

    if (!editableFields || !Array.isArray(editableFields)) {
      return NextResponse.json({ updatedHtml: filledHtml });
    }

    let updatedHtml = filledHtml;

    for (const field of editableFields) {
      const { name, value, oldValue } = field;

      if (value === null || value === undefined) continue;

      // Strategy 1: Replace remaining ${fieldName} placeholders
      const placeholderRegex = new RegExp(`\\$\\{${escapeRegex(name)}\\}`, "g");
      updatedHtml = updatedHtml.replace(placeholderRegex, String(value));

      // Strategy 2: Replace the old value if provided (exact text replacement in HTML)
      if (oldValue && oldValue !== value && oldValue.length > 2) {
        // Only replace whole-word occurrences to avoid partial match corruption
        const safeOld = escapeRegex(oldValue);
        const oldValueRegex = new RegExp(`(?<![a-zA-Z0-9])${safeOld}(?![a-zA-Z0-9])`, "g");
        updatedHtml = updatedHtml.replace(oldValueRegex, String(value));
      }

      // Strategy 3: Replace [TO BE FILLED] placeholders if this field was unfilled
      if (!oldValue || oldValue === "[TO BE FILLED]") {
        updatedHtml = updatedHtml.replace("[TO BE FILLED]", String(value));
      }
    }

    return NextResponse.json({ updatedHtml });
  } catch (error: any) {
    console.error("[update-agreement] Error:", error);
    return NextResponse.json({ error: error.message || "Failed to update agreement" }, { status: 500 });
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
