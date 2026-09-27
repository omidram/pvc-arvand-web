"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles, Info } from "lucide-react";
import { aiApi } from "@/lib/endpoints";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";

export default function AiInsightsPage() {
  const { t } = useI18n();
  const statusQuery = useQuery({ queryKey: ["ai", "status"], queryFn: aiApi.status });
  const [electrolyzer, setElectrolyzer] = useState("");
  const [question, setQuestion] = useState("");

  const insightsMutation = useMutation({
    mutationFn: () => aiApi.insights({ electrolyzer: electrolyzer || undefined, question: question || undefined }),
  });

  return (
    <div>
      <PageHeader
        title={t("aiInsights.title")}
        description={t("aiInsights.description")}
        actions={
          statusQuery.data && (
            <Badge color={statusQuery.data.enabled ? "emerald" : "amber"}>
              {statusQuery.data.enabled ? t("aiInsights.enabled", { model: statusQuery.data.model }) : t("aiInsights.notConfigured")}
            </Badge>
          )
        }
      />

      {!statusQuery.data?.enabled && (
        <Card className="mb-6">
          <CardContent className="flex gap-3 py-4">
            <Info size={18} className="mt-0.5 shrink-0 text-[#8a5a00]" />
            <div className="text-sm text-[var(--win-muted)]">{t("aiInsights.notConfiguredHelp")}</div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("aiInsights.generateTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>{t("aiInsights.electrolyzerFilter")}</Label>
              <Input value={electrolyzer} onChange={(e) => setElectrolyzer(e.target.value)} placeholder="e.g. E1" />
            </div>
            <div>
              <Label>{t("aiInsights.questionOptional")}</Label>
              <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t("aiInsights.questionPlaceholder")} />
            </div>
          </div>
          <div className="mt-4">
            <Button onClick={() => insightsMutation.mutate()} disabled={insightsMutation.isPending}>
              <Sparkles size={16} /> {insightsMutation.isPending ? t("aiInsights.analyzing") : t("aiInsights.generate")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {insightsMutation.isPending && <div className="mt-6"><LoadingState label={t("aiInsights.aggregating")} /></div>}
      {insightsMutation.isError && <div className="mt-6"><ErrorState message={(insightsMutation.error as Error).message} /></div>}

      {insightsMutation.data && (
        <div className="mt-6 space-y-4">
          {insightsMutation.data.insights && (
            <Card>
              <CardHeader>
                <CardTitle>{t("aiInsights.insightsTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-black">
                  {insightsMutation.data.insights}
                </div>
              </CardContent>
            </Card>
          )}
          {insightsMutation.data.message && (
            <Card>
              <CardContent className="py-4 text-sm text-black">{insightsMutation.data.message}</CardContent>
            </Card>
          )}
          {insightsMutation.data.error && (
            <ErrorState message={insightsMutation.data.error} />
          )}
          <Card>
            <CardHeader>
              <CardTitle>{insightsMutation.data.enabled ? t("aiInsights.dataSummarySent") : t("aiInsights.dataSummaryPending")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                readOnly
                rows={14}
                className="font-mono text-xs"
                value={JSON.stringify(insightsMutation.data.summary, null, 2)}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
