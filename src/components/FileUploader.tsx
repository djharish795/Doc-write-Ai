"use client";

import React, { useState } from "react";
import { Upload, FileText, CheckCircle2, Loader2, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileUploaderProps {
  title: string;
  description: string;
  onUpload: (file: File) => Promise<void>;
  icon?: "pdf" | "image";
  status: "idle" | "uploading" | "completed";
}

export default function FileUploader({ title, description, onUpload, icon, status }: FileUploaderProps) {
  const [isOver, setIsOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      setFileName(file.name);
      onUpload(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      onUpload(file);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={handleDrop}
      className={cn(
        "relative bg-[#262626] p-8 rounded-lg border-2 border-dashed transition-all duration-200 cursor-pointer",
        isOver ? "border-lime-400 bg-lime-400/5" : "border-[#404040] hover:border-[#525252] hover:bg-[#2A2A2A]",
        status === "completed" && "border-lime-400 bg-lime-400/5"
      )}
    >
      <input
        type="file"
        className="absolute inset-0 opacity-0 cursor-pointer"
        onChange={handleFileChange}
        accept={icon === "pdf" ? ".pdf,.docx,.doc" : "image/*,.pdf"}
      />

      <div className="flex flex-col items-center text-center space-y-4">
        <div
          className={cn(
            "w-16 h-16 rounded-lg flex items-center justify-center transition-all duration-200",
            status === "completed"
              ? "bg-lime-400/10 text-lime-400"
              : status === "uploading"
              ? "bg-lime-400/10 text-lime-400"
              : "bg-[#333333] text-[#A3A3A3]"
          )}
        >
          {status === "uploading" ? (
            <Loader2 className="w-8 h-8 animate-spin" />
          ) : status === "completed" ? (
            <CheckCircle2 className="w-8 h-8" />
          ) : icon === "pdf" ? (
            <FileText className="w-8 h-8" />
          ) : (
            <ImageIcon className="w-8 h-8" />
          )}
        </div>

        <div className="space-y-1">
          <h4 className="font-semibold text-base text-[#E5E5E5]">{title}</h4>
          <p className="text-sm text-[#A3A3A3]">{description}</p>
          {fileName && status !== "completed" && (
            <p className="text-xs text-lime-400 font-medium mt-2">{fileName}</p>
          )}
        </div>

        {status === "idle" && (
          <div className="flex items-center gap-2 text-xs text-[#737373]">
            <Upload className="w-3 h-3" />
            <span>Drag & drop or click to browse</span>
          </div>
        )}

        {status === "completed" && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-lime-400/10 border border-lime-400/30">
            <CheckCircle2 className="w-3 h-3 text-lime-400" />
            <span className="text-xs font-medium text-lime-400">Uploaded Successfully</span>
          </div>
        )}
      </div>
    </div>
  );
}
