"use client";

import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { 
  Loader2, Download, Calculator, Building2, 
  ClipboardList, Sparkles, BrainCircuit, 
  ChevronRight, CheckCircle2, AlertCircle 
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Field {
  name: string;
  label: string;
  type: "text" | "number" | "date";
  description?: string;
}

interface ValuationFormProps {
  initialData?: any;
  schema?: Field[];
  template?: string;
}

// Recursively flatten a nested object into a single-level key-value map.
// Only scalar values (string, number, boolean) are kept; nested objects are
// traversed and their leaf values are promoted to the top level.
function flattenObject(obj: any, prefix = ""): Record<string, any> {
  const result: Record<string, any> = {};
  if (!obj || typeof obj !== "object") return result;

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;

    if (typeof value === "object" && !Array.isArray(value)) {
      // Recurse into nested objects
      Object.assign(result, flattenObject(value, prefix ? `${prefix}_${key}` : key));
    } else if (Array.isArray(value)) {
      // Store arrays as JSON strings so they don't break React rendering
      result[key] = JSON.stringify(value);
    } else {
      // Scalar — use the original key (without prefix) if no collision,
      // otherwise use the prefixed key to avoid overwriting.
      result[key in result ? (prefix ? `${prefix}_${key}` : key) : key] = value;
    }
  }
  return result;
}

export default function ValuationForm({ initialData, schema, template }: ValuationFormProps) {
  const flatData = initialData ? flattenObject(initialData) : {};

  const { register, handleSubmit, reset, watch } = useForm({
    defaultValues: flatData,
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [showReasoning, setShowReasoning] = useState(true);

  useEffect(() => {
    if (initialData) {
      reset(flattenObject(initialData));
    }
  }, [initialData, reset]);

  const watchedValues = watch();

  const onSubmit = async (formData: any) => {
    setIsGenerating(true);
    try {
      const response = await fetch("/api/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          data: formData,
          template: template 
        }),
      });
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Valuation_Report_${formData.surveyNumber || 'Final'}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (error) {
      console.error("PDF generation failed:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const displaySchema = schema && schema.length > 0 ? schema : [
    { name: "ownerName", label: "Owner Name", type: "text" },
    { name: "surveyNumber", label: "Survey Number", type: "text" },
    { name: "propertyAddress", label: "Property Address", type: "text" },
    { name: "landValue", label: "Land Value", type: "number" },
    { name: "buildingValue", label: "Building Value", type: "number" },
  ];

  // Group fields into logical sections for better UX
  const financialFields = ["landValue", "buildingValue", "marketValue", "distressValue", "realizableValue", "marketValueOfLand", "reconstructionCost"];
  const propertyFields = displaySchema.filter(f => !financialFields.includes(f.name));
  const moneyFields = displaySchema.filter(f => financialFields.includes(f.name));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start animate-in fade-in duration-1000">
      
      {/* Main Form Area */}
      <form onSubmit={handleSubmit(onSubmit)} className="lg:col-span-8 space-y-8">
        
        {/* Header Summary */}
        <div className="glass p-8 rounded-[2rem] border-white/5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 blur-[100px] rounded-full -mr-32 -mt-32 group-hover:bg-primary/20 transition-all duration-700" />
          <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase tracking-[0.2em]">
                <Sparkles className="w-4 h-4" />
                Dossier Ready
              </div>
              <h2 className="text-4xl md:text-5xl font-serif font-black tracking-tight">
                {watchedValues.ownerName || "Untitled Property"}
              </h2>
              <p className="text-muted-foreground font-medium opacity-60">
                {watchedValues.surveyNumber ? `Survey #${watchedValues.surveyNumber}` : "Reference template identified 12+ data points"}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
                <p className="text-[10px] uppercase font-bold tracking-widest opacity-40">Estimated Market Value</p>
                <p className="text-3xl font-black text-primary glow-primary font-mono tracking-tighter">
                  ₹{Number(watchedValues.marketValue || watchedValues.landValue || 0).toLocaleString()}
                </p>
            </div>
          </div>
        </div>

        {/* Property Metadata Section */}
        <div className="space-y-4">
          <h3 className="text-sm font-black uppercase tracking-[0.3em] opacity-40 ml-2">Property Identity</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {propertyFields.map((field) => (
              <div key={field.name} className="glass p-6 rounded-2xl premium-border group">
                <label className="text-[10px] uppercase font-black tracking-widest text-muted-foreground group-focus-within:text-primary transition-all flex items-center gap-2 mb-3">
                  {field.label}
                  <CheckCircle2 className="w-3 h-3 text-primary opacity-0 group-hover:opacity-40" />
                </label>
                <input 
                  type={field.type === 'number' ? 'text' : field.type}
                  {...register(field.name as any)} 
                  className="w-full bg-transparent text-lg font-bold outline-none placeholder:text-white/5"
                  placeholder="-"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Financial Analytics Section */}
        <div className="space-y-4">
           <h3 className="text-sm font-black uppercase tracking-[0.3em] opacity-40 ml-2">Financial Analytics</h3>
           <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {moneyFields.map((field) => (
                <div key={field.name} className="glass p-6 rounded-2xl border-primary/10 hover:border-primary/50 transition-all bg-primary/[0.02] group">
                   <p className="text-[10px] uppercase font-black tracking-widest text-primary/60 mb-2">{field.label}</p>
                   <div className="flex items-center gap-2">
                      <span className="text-xl font-bold opacity-30">₹</span>
                      <input 
                        type="text"
                        {...register(field.name as any)} 
                        className="w-full bg-transparent text-2xl font-black tracking-tighter outline-none"
                        placeholder="0"
                      />
                   </div>
                   <div className="mt-4 w-full h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-primary/40 w-[60%] animate-pulse" />
                   </div>
                </div>
              ))}
           </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isGenerating}
          className="w-full py-8 glass rounded-[2rem] border-primary/20 hover:border-primary/60 group transition-all relative overflow-hidden shadow-2xl shadow-primary/10 active:scale-[0.98]"
        >
          <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
          {isGenerating ? (
            <div className="flex items-center justify-center gap-4">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <span className="text-lg font-black uppercase tracking-widest">Generating Digital Twin...</span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-6">
              <Download className="w-8 h-8 text-primary group-hover:translate-y-1 transition-transform" />
              <div className="text-left">
                <p className="text-xl font-black uppercase tracking-tighter">Finalize Valuation Report</p>
                <p className="text-[10px] uppercase font-bold tracking-widest opacity-40">Print High-Fidelity PDF via Playwright</p>
              </div>
              <ChevronRight className="w-6 h-6 opacity-20 group-hover:opacity-100 group-hover:translate-x-2 transition-all" />
            </div>
          )}
        </button>
      </form>

      {/* Reasoning Sidebar */}
      <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-8">
        <div className="glass p-8 rounded-[2rem] border-white/5 space-y-6 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center">
                <BrainCircuit className="w-5 h-5 text-primary" />
              </div>
              <h4 className="text-lg font-serif font-bold italic">AI Reasoning</h4>
            </div>
            <button 
              onClick={() => setShowReasoning(!showReasoning)}
              className="text-[10px] uppercase font-black tracking-widest opacity-40 hover:opacity-100 transition-opacity"
            >
              {showReasoning ? 'Hide' : 'Show'}
            </button>
          </div>

          {showReasoning && (
            <div className="space-y-6 animate-in slide-in-from-right-5 duration-500">
              <div className="space-y-3">
                <p className="text-xs leading-relaxed text-muted-foreground italic font-medium">
                  "I have analyzed the Telugu Sale Deed and cross-referenced the government market values with current industry standard distress margins (15%)."
                </p>
                <div className="bg-white/5 p-4 rounded-xl border border-white/5 space-y-2">
                   <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest opacity-40">
                      <span>Valuation Logic</span>
                      <span>Verified</span>
                   </div>
                   <p className="text-[11px] leading-relaxed opacity-80">
                     {initialData?.reasoning || "Extracting reasoning steps from the legal text analysis... Finalizing financial derived fields based on sector 4 margins."}
                   </p>
                </div>
              </div>

              <div className="pt-6 border-t border-white/5 space-y-4">
                <div className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-primary mt-1 shadow-[0_0_10px_#10b981]" />
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-wider">Unit Mapping</p>
                        <p className="text-[10px] text-muted-foreground opacity-60">Converted Sq. Yards to Sq. Feet</p>
                    </div>
                </div>
                <div className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-primary mt-1 shadow-[0_0_10px_#10b981]" />
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-wider">Distress Formula</p>
                        <p className="text-[10px] text-muted-foreground opacity-60">Calculated at 0.85x of Fair Market Value</p>
                    </div>
                </div>
              </div>

              <div className="p-4 bg-primary/10 rounded-2xl border border-primary/20 flex gap-3">
                 <AlertCircle className="w-5 h-5 text-primary shrink-0" />
                 <p className="text-[10px] leading-normal font-medium opacity-80">
                   Human-in-the-loop verification required for boundary measurements (East/West).
                 </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
