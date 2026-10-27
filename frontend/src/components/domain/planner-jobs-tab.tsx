"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { workOrdersApi } from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";

function JobsForm({ initial, defaults }: { initial: string[]; defaults: string[] }) {
  const { locale } = useI18n();
  const fa = (f: string, e: string) => (locale === "fa" ? f : e);
  const qc = useQueryClient();
  const [items, setItems] = useState<string[]>(initial);
  const [added, setAdded] = useState("");
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => workOrdersApi.saveSkills(items),
    onSuccess: (data) => {
      setItems(data.skills);
      qc.setQueryData(["wo-skills"], data);
      void qc.invalidateQueries({ queryKey: ["wo"] });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 3000);
    },
  });
  const add = () => {
    const v = added.trim();
    if (v && !items.includes(v)) setItems([...items, v]);
    setAdded("");
  };
  return (
    <div className="space-y-4 max-w-xl">
      <p className="text-sm text-muted-foreground">
        {fa(
          "فهرست «شغل» که در فرم برنامه‌ریز (سفارش کار) نمایش داده می‌شود. می‌توانید مورد اضافه، ویرایش یا حذف کنید.",
          "Jobs offered in the planner's Job combo. Add, rename or remove entries."
        )}
      </p>
      <div className="space-y-2">
        {items.map((name, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <Input value={name} onChange={(e) => setItems(items.map((x, i) => (i === idx ? e.target.value : x)))} />
            <button type="button" className="wo-icon-btn" onClick={() => setItems(items.filter((_, i) => i !== idx))}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={added}
          placeholder={fa("شغل جدید", "New job")}
          onChange={(e) => setAdded(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="ghost" onClick={add}>
          <Plus size={14} /> {fa("افزودن", "Add")}
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          <Save size={14} /> {fa("ذخیره", "Save")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setItems(defaults)}>
          <RotateCcw size={14} /> {fa("پیش‌فرض", "Defaults")}
        </Button>
        {saved ? <span className="text-sm text-emerald-600">{fa("ذخیره شد", "Saved")}</span> : null}
        {save.error ? <span className="text-sm text-rose-600">{(save.error as Error).message}</span> : null}
      </div>
    </div>
  );
}

export function PlannerJobsTab() {
  const q = useQuery({ queryKey: ["wo-skills"], queryFn: workOrdersApi.skills });
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  return q.data ? <JobsForm initial={q.data.skills} defaults={q.data.defaults} /> : null;
}
