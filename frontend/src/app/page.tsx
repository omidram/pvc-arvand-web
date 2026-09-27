"use client";

import { MainMenu } from "@/components/layout/main-menu";
import OverviewPage from "@/app/overview/page";
import { useUiStyle } from "@/lib/ui-style/context";

export default function HomePage() {
  const { isModern } = useUiStyle();
  if (isModern) return <OverviewPage />;
  return <MainMenu />;
}
