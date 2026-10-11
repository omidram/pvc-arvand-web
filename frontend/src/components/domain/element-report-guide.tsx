"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Boxes,
  Factory,
  Flame,
  GitBranch,
  HelpCircle,
  Layers,
  Link2,
  ListChecks,
  Route,
  Settings2,
  Wrench,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { STAGE_FLOW, STAGE_TONE } from "./element-dashboard-ui";
import {
  ELEMENT_REPORT_GUIDE,
  type GuideLocale,
  type GuideSectionId,
} from "./element-report-guide-content";

const SECTION_ICON: Record<GuideSectionId, React.ComponentType<{ size?: number; className?: string }>> = {
  intro: BookOpen,
  places: Factory,
  lifecycle: Route,
  report: Layers,
  tabs: ListChecks,
  fields: Boxes,
  relations: GitBranch,
  workflows: Wrench,
  tips: Settings2,
};

function useGuide() {
  const { locale, t } = useI18n();
  const content = ELEMENT_REPORT_GUIDE[(locale as GuideLocale) in ELEMENT_REPORT_GUIDE ? (locale as GuideLocale) : "en"];
  return { content, t };
}

/** Button that opens the full visual Element Report guide. */
export function ElementReportGuideButton({ className, compact }: { className?: string; compact?: boolean }) {
  const { content } = useGuide();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={cn("erg-open-btn", compact && "is-compact", className)}
        onClick={() => setOpen(true)}
        title={content.openGuide}
        aria-label={content.openGuide}
      >
        <HelpCircle size={compact ? 14 : 16} />
        {!compact ? <span>{content.openGuide}</span> : null}
      </button>
      <ElementReportGuideModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function ElementReportGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { content } = useGuide();
  const [section, setSection] = useState<GuideSectionId>("intro");

  useEffect(() => {
    if (open) setSection("intro");
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={content.title} wide>
      <div className="erg">
        <p className="erg-sub">{content.subtitle}</p>
        <div className="erg-layout">
          <nav className="erg-nav" aria-label={content.title}>
            {content.sections.map((s) => {
              const Icon = SECTION_ICON[s.id];
              return (
                <button
                  key={s.id}
                  type="button"
                  className={cn("erg-nav-item", section === s.id && "is-active")}
                  onClick={() => {
                    setSection(s.id);
                    document.getElementById(`erg-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  <Icon size={15} />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="erg-body">
            <section id="erg-intro" className="erg-section">
              <h3 className="erg-h">{content.sections[0].label}</h3>
              <p className="erg-lead">{content.intro.lead}</p>
              <ul className="erg-bullets">
                {content.intro.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </section>

            <section id="erg-places" className="erg-section">
              <h3 className="erg-h">{content.sections[1].label}</h3>
              <p className="erg-lead">{content.places.lead}</p>
              <div className="erg-cards">
                {content.places.cards.map((c) => (
                  <article key={c.title} className="erg-card">
                    <h4>{c.title}</h4>
                    <p>{c.body}</p>
                  </article>
                ))}
              </div>
            </section>

            <section id="erg-lifecycle" className="erg-section">
              <h3 className="erg-h">{content.sections[2].label}</h3>
              <p className="erg-lead">{content.lifecycle.lead}</p>
              <div className="erg-flow" role="list">
                {STAGE_FLOW.map((stage, i) => {
                  const meta = content.lifecycle.stages.find((s) => s.key === stage);
                  return (
                    <div key={stage} className="erg-flow-item" role="listitem">
                      <div className={cn("erg-flow-chip", `ed-tone-${STAGE_TONE[stage]}`)}>
                        <span className="erg-flow-num">{i + 1}</span>
                        <span className="erg-flow-title">{meta?.title ?? stage}</span>
                      </div>
                      <p className="erg-flow-body">{meta?.body}</p>
                      {i < STAGE_FLOW.length - 1 ? (
                        <span className="erg-flow-arrow" aria-hidden>
                          <ArrowRight size={14} />
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="erg-legend">
                {content.lifecycle.stages
                  .filter((s) => s.key === "disassembled")
                  .map((s) => (
                    <div key={s.key} className="erg-legend-row">
                      <span className="ed-badge ed-tone-slate">{s.title}</span>
                      <span>{s.body}</span>
                    </div>
                  ))}
              </div>
            </section>

            <section id="erg-report" className="erg-section">
              <h3 className="erg-h">{content.sections[3].label}</h3>
              <p className="erg-lead">{content.report.lead}</p>
              <div className="erg-mini-report" aria-hidden>
                <div className="erg-mini-banner">
                  {content.report.banner.map((b) => (
                    <div key={b.title} className="erg-mini-metric">
                      <div className="erg-mini-label">{b.title}</div>
                      <div className="erg-mini-bar" />
                    </div>
                  ))}
                </div>
                <div className="erg-mini-chips">
                  {content.report.chips.map((c, i) => (
                    <span key={c.title} className={cn("erg-mini-chip", i === 1 ? "is-warn" : i === 2 ? "is-info" : "is-ok")}>
                      {c.title}
                    </span>
                  ))}
                </div>
                <div className="erg-mini-gauges">
                  {content.report.gauges.map((g) => (
                    <div key={g.title} className="erg-mini-gauge">
                      <div className="erg-mini-dial" />
                      <span>{g.title}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="erg-explain-grid">
                {[...content.report.banner, ...content.report.chips, ...content.report.gauges].map((item) => (
                  <article key={item.title} className="erg-explain">
                    <h4>{item.title}</h4>
                    <p>{item.body}</p>
                  </article>
                ))}
              </div>
            </section>

            <section id="erg-tabs" className="erg-section">
              <h3 className="erg-h">{content.sections[4].label}</h3>
              <p className="erg-lead">{content.tabs.lead}</p>
              <div className="erg-tabs">
                {content.tabs.items.map((tab, i) => (
                  <article key={tab.name} className="erg-tab-card">
                    <span className="erg-tab-index">{i + 1}</span>
                    <div>
                      <h4>{tab.name}</h4>
                      <p>{tab.body}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section id="erg-fields" className="erg-section">
              <h3 className="erg-h">{content.sections[5].label}</h3>
              <p className="erg-lead">{content.fields.lead}</p>
              <div className="erg-fields">
                {content.fields.items.map((f) => (
                  <article key={f.name} className="erg-field">
                    <h4>
                      <Flame size={12} className="erg-field-icon" />
                      {f.name}
                    </h4>
                    <p>{f.meaning}</p>
                  </article>
                ))}
              </div>
            </section>

            <section id="erg-relations" className="erg-section">
              <h3 className="erg-h">{content.sections[6].label}</h3>
              <p className="erg-lead">{content.relations.lead}</p>
              <div className="erg-rel-map">
                {content.relations.nodes.map((n) => (
                  <article key={n.id} className={cn("erg-rel-node", `is-${n.id}`)} id={`erg-node-${n.id}`}>
                    <h4>{n.title}</h4>
                    <p>{n.body}</p>
                  </article>
                ))}
              </div>
              <div className="erg-rel-links">
                {content.relations.links.map((l) => (
                  <div key={`${l.from}-${l.to}-${l.label}`} className="erg-rel-link">
                    <Link2 size={14} />
                    <strong>{content.relations.nodes.find((n) => n.id === l.from)?.title}</strong>
                    <ArrowRight size={12} />
                    <strong>{content.relations.nodes.find((n) => n.id === l.to)?.title}</strong>
                    <span className="erg-rel-key">{l.label}</span>
                  </div>
                ))}
              </div>
              <ul className="erg-bullets">
                {content.relations.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </section>

            <section id="erg-workflows" className="erg-section">
              <h3 className="erg-h">{content.sections[7].label}</h3>
              <p className="erg-lead">{content.workflows.lead}</p>
              <ol className="erg-steps">
                {content.workflows.items.map((step, i) => (
                  <li key={step.title} className="erg-step">
                    <span className="erg-step-num">{i + 1}</span>
                    <div>
                      <h4>{step.title}</h4>
                      <p>{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section id="erg-tips" className="erg-section">
              <h3 className="erg-h">{content.sections[8].label}</h3>
              <p className="erg-lead">{content.tips.lead}</p>
              <ul className="erg-bullets">
                {content.tips.items.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </Modal>
  );
}
