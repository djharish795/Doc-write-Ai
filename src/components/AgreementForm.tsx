"use client";

import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Loader2,
  Download,
  Sparkles,
  BrainCircuit,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TransactionDetails {
  buyerName: string;
  buyerAddress: string;
  buyerFatherName: string;
  sellerName: string;
  sellerAddress: string;
  sellerFatherName: string;
  agreementDate: string;
  totalAmount: string;
  advanceAmount: string;
  balanceAmount: string;
  transactionNumber: string;
  propertyType: "Land" | "Flat" | "Government" | "POA";
  [key: string]: any; // Allow dynamic fields from extracted data
}

interface AgreementFormProps {
  transactionDetails: TransactionDetails;
  extractedData?: any;
  templateSchema?: any[];
  tailwindTemplate?: string;
  missingFields?: string[];
  onMissingFieldChange?: (field: string, value: string) => void;
  manualFields?: Record<string, string>;
}

// Extended type for form data with dynamic fields
type FormData = TransactionDetails & Record<string, any>;

// Flatten nested objects into single-level key-value pairs
function flattenObject(obj: any, prefix = ""): Record<string, any> {
  const result: Record<string, any> = {};
  if (!obj || typeof obj !== "object") return result;

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;

    if (typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, prefix ? `${prefix}_${key}` : key));
    } else if (Array.isArray(value)) {
      result[key] = JSON.stringify(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// Convert camelCase to Title Case with spaces
function formatFieldLabel(fieldName: string): string {
  return fieldName
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

export default function AgreementForm({
  transactionDetails,
  extractedData,
  templateSchema,
  tailwindTemplate,
  missingFields = [],
  onMissingFieldChange,
  manualFields = {},
}: AgreementFormProps) {
  // Merge all data sources
  const initialData = {
    ...flattenObject(extractedData),
    ...manualFields,
    buyerName: transactionDetails.buyerName,
    buyerAddress: transactionDetails.buyerAddress,
    buyerFatherName: transactionDetails.buyerFatherName,
    sellerName: transactionDetails.sellerName,
    sellerAddress: transactionDetails.sellerAddress,
    sellerFatherName: transactionDetails.sellerFatherName,
    agreementDate: transactionDetails.agreementDate,
    totalAmount: transactionDetails.totalAmount,
    advanceAmount: transactionDetails.advanceAmount,
    balanceAmount: transactionDetails.balanceAmount,
    transactionNumber: transactionDetails.transactionNumber,
    propertyType: transactionDetails.propertyType,
  };

  const { register, handleSubmit, reset, watch } = useForm({
    defaultValues: initialData,
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [showReasoning, setShowReasoning] = useState(true);
  const [generationError, setGenerationError] = useState<string | null>(null);

  useEffect(() => {
    reset(initialData);
  }, [extractedData, transactionDetails]);

  const watchedValues = watch();

  const onSubmit = async (formData: any) => {
    setIsGenerating(true);
    setGenerationError(null);

    try {
      const response = await fetch("/api/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: formData,
          template: tailwindTemplate || undefined,
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Agreement_${formData.buyerName || "Document"}_${
          formData.agreementDate || "Final"
        }.docx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      } else {
        const errorData = await response.json();
        setGenerationError(errorData.error || "Document generation failed. Please try again.");
      }
    } catch (error) {
      console.error("DOCX generation failed:", error);
      setGenerationError("An unexpected error occurred during generation.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Get all editable fields (exclude reasoning and internal fields)
  const allFields = Object.keys(initialData).filter(
    (key) => key !== "reasoning" && (initialData as any)[key] !== undefined
  );

  // Categorize fields
  const propertyFields = allFields.filter((f) =>
    ["surveyNumber", "village", "mandal", "district", "landSize", "propertyDescription", "propertyType"].includes(f)
  );

  const financialFields = allFields.filter((f) =>
    ["totalAmount", "advanceAmount", "balanceAmount", "saleAmount", "marketValue", "landValue"].includes(f)
  );

  const partyFields = allFields.filter((f) =>
    ["buyerName", "buyerAddress", "buyerFatherName", "sellerName", "sellerAddress", "sellerFatherName"].includes(f)
  );

  const otherFields = allFields.filter(
    (f) => !propertyFields.includes(f) && !financialFields.includes(f) && !partyFields.includes(f)
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Main Form Area */}
      <form onSubmit={handleSubmit(onSubmit)} className="lg:col-span-8 space-y-8">
        {/* Header Summary */}
        <div className="glass p-8 rounded-[2rem] border-white/5 relative overflow-hidden group bg-[#1A1A1A] border border-[#404040]">
          <div className="absolute top-0 right-0 w-64 h-64 bg-lime-400/10 blur-[100px] rounded-full -mr-32 -mt-32 group-hover:bg-lime-400/20 transition-all duration-700" />
          <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-lime-400 font-bold text-xs uppercase tracking-[0.2em]">
                <Sparkles className="w-4 h-4" />
                Agreement Ready
              </div>
              <h2 className="text-4xl md:text-5xl font-serif font-black tracking-tight text-[#E5E5E5]">
                {watchedValues.buyerName || "Untitled Agreement"}
              </h2>
              <p className="text-[#A3A3A3] font-medium opacity-60">
                {(watchedValues as any).surveyNumber
                  ? `Survey #${(watchedValues as any).surveyNumber}`
                  : `${watchedValues.propertyType || "Land"} Agreement`}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <p className="text-[10px] uppercase font-bold tracking-widest text-[#737373]">
                Total Amount
              </p>
              <p className="text-3xl font-black text-lime-400 font-mono tracking-tighter">
                ₹{Number(watchedValues.totalAmount || 0).toLocaleString("en-IN")}
              </p>
            </div>
          </div>
        </div>

        {/* Property Identity Section */}
        {propertyFields.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-sm font-black uppercase tracking-[0.3em] text-[#737373] ml-2">
              Property Identity
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {propertyFields.map((field) => (
                <div
                  key={field}
                  className="glass p-6 rounded-2xl border border-[#404040] bg-[#1A1A1A] group hover:border-lime-400/30 transition-all"
                >
                  <label className="text-[10px] uppercase font-black tracking-widest text-[#A3A3A3] group-focus-within:text-lime-400 transition-all flex items-center gap-2 mb-3">
                    {formatFieldLabel(field)}
                    <CheckCircle2 className="w-3 h-3 text-lime-400 opacity-0 group-hover:opacity-40" />
                  </label>
                  <input
                    type="text"
                    {...register(field as any)}
                    className="w-full bg-transparent text-lg font-bold outline-none placeholder:text-white/5 text-[#E5E5E5]"
                    placeholder="-"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Party Information Section */}
        {partyFields.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-sm font-black uppercase tracking-[0.3em] text-[#737373] ml-2">
              Party Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {partyFields.map((field) => (
                <div
                  key={field}
                  className={cn(
                    "glass p-6 rounded-2xl border border-[#404040] bg-[#1A1A1A] group hover:border-lime-400/30 transition-all",
                    field.includes("Address") && "md:col-span-2"
                  )}
                >
                  <label className="text-[10px] uppercase font-black tracking-widest text-[#A3A3A3] group-focus-within:text-lime-400 transition-all flex items-center gap-2 mb-3">
                    {formatFieldLabel(field)}
                    <CheckCircle2 className="w-3 h-3 text-lime-400 opacity-0 group-hover:opacity-40" />
                  </label>
                  {field.includes("Address") ? (
                    <textarea
                      {...register(field as any)}
                      rows={2}
                      className="w-full bg-transparent text-lg font-bold outline-none placeholder:text-white/5 text-[#E5E5E5] resize-none"
                      placeholder="-"
                    />
                  ) : (
                    <input
                      type="text"
                      {...register(field as any)}
                      className="w-full bg-transparent text-lg font-bold outline-none placeholder:text-white/5 text-[#E5E5E5]"
                      placeholder="-"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Financial Analytics Section */}
        {financialFields.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-sm font-black uppercase tracking-[0.3em] text-[#737373] ml-2">
              Financial Analytics
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {financialFields.map((field) => (
                <div
                  key={field}
                  className="glass p-6 rounded-2xl border border-lime-400/10 hover:border-lime-400/50 transition-all bg-lime-400/[0.02]"
                >
                  <p className="text-[10px] uppercase font-black tracking-widest text-lime-400/60 mb-2">
                    {formatFieldLabel(field)}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold text-[#737373]">₹</span>
                    <input
                      type="text"
                      {...register(field as any)}
                      readOnly={field === "balanceAmount"}
                      className={cn(
                        "w-full bg-transparent text-2xl font-black tracking-tighter outline-none",
                        field === "balanceAmount" ? "text-lime-400 cursor-not-allowed" : "text-[#E5E5E5]"
                      )}
                      placeholder="0"
                    />
                  </div>
                  <div className="mt-4 w-full h-1 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-lime-400/40 w-[60%] animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Other Fields Section */}
        {otherFields.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-sm font-black uppercase tracking-[0.3em] text-[#737373] ml-2">
              Additional Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {otherFields.map((field) => (
                <div
                  key={field}
                  className="glass p-6 rounded-2xl border border-[#404040] bg-[#1A1A1A] group hover:border-lime-400/30 transition-all"
                >
                  <label className="text-[10px] uppercase font-black tracking-widest text-[#A3A3A3] group-focus-within:text-lime-400 transition-all flex items-center gap-2 mb-3">
                    {formatFieldLabel(field)}
                    <CheckCircle2 className="w-3 h-3 text-lime-400 opacity-0 group-hover:opacity-40" />
                  </label>
                  <input
                    type="text"
                    {...register(field as any)}
                    className="w-full bg-transparent text-lg font-bold outline-none placeholder:text-white/5 text-[#E5E5E5]"
                    placeholder="-"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Generation Error */}
        {generationError && (
          <div className="flex items-center gap-3 p-4 bg-red-900/20 border border-red-500/30 rounded-md">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-sm text-red-400">{generationError}</p>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isGenerating}
          className="w-full py-8 glass rounded-[2rem] border-lime-400/20 hover:border-lime-400/60 group transition-all relative overflow-hidden shadow-2xl shadow-lime-400/10 active:scale-[0.98] bg-[#1A1A1A] border"
        >
          <div className="absolute inset-0 bg-lime-400/5 opacity-0 group-hover:opacity-100 transition-opacity" />
          {isGenerating ? (
            <div className="flex items-center justify-center gap-4">
              <Loader2 className="w-8 h-8 animate-spin text-lime-400" />
              <span className="text-lg font-black uppercase tracking-widest text-[#E5E5E5]">
                Generating Agreement...
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-6">
              <Download className="w-8 h-8 text-lime-400 group-hover:translate-y-1 transition-transform" />
              <div className="text-left">
                <p className="text-xl font-black uppercase tracking-tighter text-[#E5E5E5]">
                  Finalize Agreement Document
                </p>
                <p className="text-[10px] uppercase font-bold tracking-widest text-[#737373]">
                  Download High-Quality DOCX
                </p>
              </div>
              <ChevronRight className="w-6 h-6 text-[#737373] group-hover:opacity-100 group-hover:translate-x-2 transition-all" />
            </div>
          )}
        </button>
      </form>

      {/* Reasoning Sidebar */}
      <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-8">
        <div className="glass p-8 rounded-[2rem] border-white/5 space-y-6 relative overflow-hidden bg-[#1A1A1A] border border-[#404040]">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-lime-400/50 to-transparent" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-lime-400/20 rounded-xl flex items-center justify-center">
                <BrainCircuit className="w-5 h-5 text-lime-400" />
              </div>
              <h4 className="text-lg font-serif font-bold italic text-[#E5E5E5]">AI Reasoning</h4>
            </div>
            <button
              type="button"
              onClick={() => setShowReasoning(!showReasoning)}
              className="text-[10px] uppercase font-black tracking-widest text-[#737373] hover:text-[#E5E5E5] transition-opacity"
            >
              {showReasoning ? "Hide" : "Show"}
            </button>
          </div>

          {showReasoning && (
            <div className="space-y-6">
              <div className="space-y-3">
                <p className="text-xs leading-relaxed text-[#A3A3A3] italic font-medium">
                  "I have analyzed the sale deed and agreement template. All placeholders have been
                  identified and filled with extracted data and user inputs."
                </p>
                <div className="bg-white/5 p-4 rounded-xl border border-white/5 space-y-2">
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-[#737373]">
                    <span>Extraction Logic</span>
                    <span>Verified</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-[#A3A3A3]">
                    {extractedData?.reasoning ||
                      "Extracted property details from sale deed. Merged with user-provided buyer and seller information. All fields are editable for human verification."}
                  </p>
                </div>
              </div>

              <div className="pt-6 border-t border-white/5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-lime-400 mt-1 shadow-[0_0_10px_#BEF264]" />
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-[#E5E5E5]">
                      Template Analysis
                    </p>
                    <p className="text-[10px] text-[#A3A3A3] opacity-60">
                      Identified {allFields.length} fields from documents
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-lime-400 mt-1 shadow-[0_0_10px_#BEF264]" />
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-[#E5E5E5]">
                      Data Merge
                    </p>
                    <p className="text-[10px] text-[#A3A3A3] opacity-60">
                      Combined sale deed + user inputs
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-lime-400/10 rounded-2xl border border-lime-400/20 flex gap-3">
                <AlertCircle className="w-5 h-5 text-lime-400 shrink-0" />
                <p className="text-[10px] leading-normal font-medium text-[#E5E5E5] opacity-80">
                  Human-in-the-loop verification: Review all fields before downloading. Edit any
                  incorrect values.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
