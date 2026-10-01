"use client";

import { useEffect, useRef } from "react";

type Props = {
  label: string;
  name: string;
  image: string;
  readOnly: boolean;
  onChange: (patch: { name?: string; image?: string; at?: string }) => void;
};

function stamp(): string {
  return new Date().toISOString().slice(0, 19);
}

export function InspectionSignaturePad({ label, name, image, readOnly, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const imageRef = useRef(image);
  imageRef.current = image;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 160;
    const height = canvas.clientHeight || 56;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    if (!imageRef.current) return;
    const picture = new Image();
    picture.onload = () => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(picture, 0, 0, width, height);
    };
    picture.src = imageRef.current;
  }, [image]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function commit() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange({ image: canvas.toDataURL("image/png"), at: stamp() });
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const picture = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
      const out = document.createElement("canvas");
      const maxW = 420;
      const maxH = 90;
      const scale = Math.min(maxW / picture.width, maxH / picture.height, 1);
      out.width = Math.max(1, Math.round(picture.width * scale));
      out.height = Math.max(1, Math.round(picture.height * scale));
      const ctx = out.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(picture, 0, 0, out.width, out.height);
      onChange({ image: out.toDataURL("image/png"), at: stamp() });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return (
    <div className="insp-sign">
      <div className="insp-sign-head">
        <span className="insp-lab">{label}</span>
        {readOnly ? null : (
          <span className="insp-sign-actions">
            <label className="insp-sign-upload">
              Photo
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  onFile(e.target.files?.[0]);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            <button
              type="button"
              className="insp-sign-clear"
              onClick={() => onChange({ image: "", name: name, at: "" })}
            >
              Clear
            </button>
          </span>
        )}
      </div>
      <input
        className="insp-in insp-sign-name"
        placeholder="Name"
        value={name}
        disabled={readOnly}
        onChange={(e) => onChange({ name: e.target.value, at: stamp() })}
      />
      <canvas
        ref={canvasRef}
        className="insp-sign-canvas"
        aria-label={`${label} signature`}
        onPointerDown={(event) => {
          if (readOnly) return;
          drawing.current = true;
          (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
          const ctx = canvasRef.current?.getContext("2d");
          const at = point(event);
          if (!ctx || !at) return;
          ctx.strokeStyle = "#111";
          ctx.lineWidth = 1.6;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(at.x, at.y);
        }}
        onPointerMove={(event) => {
          if (!drawing.current || readOnly) return;
          const ctx = canvasRef.current?.getContext("2d");
          const at = point(event);
          if (!ctx || !at) return;
          ctx.lineTo(at.x, at.y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          drawing.current = false;
          commit();
        }}
        onPointerLeave={() => {
          if (!drawing.current) return;
          drawing.current = false;
          commit();
        }}
      />
    </div>
  );
}
