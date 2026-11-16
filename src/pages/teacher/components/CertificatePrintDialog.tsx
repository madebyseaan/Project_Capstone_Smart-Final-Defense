import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTheme } from "@/contexts/ThemeContext";
import { printForm } from "@/lib/printForm";
import {
  publicSettingsApi,
  SERVER_URL,
} from "@/lib/api";
import { formatDivisionLabel, formatRegionLabel } from "@/lib/utils";

export interface CertificateStudent {
  id: string;
  name: string;
  grade: number;
  honor: string;
  class: string;
}

interface CertificatePrintDialogProps {
  open: boolean;
  onClose: () => void;
  students: CertificateStudent[];
  term: string;
  schoolYear?: string;
}

const TERM_LABELS: Record<string, string> = {
  T1: "Term 1",
  T2: "Term 2",
  T3: "Term 3",
};

function termLabel(term: string): string {
  return TERM_LABELS[term] ?? term;
}

function flipName(name: string): string {
  const [last, first] = name.split(",").map((part) => part.trim());
  if (!last || !first) return name;
  return `${first} ${last}`;
}

function adviserDisplayName(): string {
  try {
    const raw = sessionStorage.getItem("user_teacher");
    if (!raw) return "";
    const user = JSON.parse(raw) as { firstName?: string; lastName?: string; username?: string };
    const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    return full || user.username || "";
  } catch {
    return "";
  }
}

function finalHonor(grade: number): string | null {
  const rounded = Math.round(grade);
  if (rounded >= 98) return "WITH HIGHEST HONORS";
  if (rounded >= 95) return "WITH HIGH HONORS";
  if (rounded >= 90) return "WITH HONORS";
  return null;
}

function CornerFlourish({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      className={`pointer-events-none absolute h-[18mm] w-[18mm] text-[#c9a54a] ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="M2 98V24C2 11.8 11.8 2 24 2h74" />
      <path d="M10 90V32c0-12.2 9.8-22 22-22h58" strokeWidth="1" opacity="0.65" />
      <path d="M24 24c9.4 0 17 7.6 17 17 0 5.5-4.5 10-10 10s-10-4.5-10-10" strokeWidth="1.4" />
      <circle cx="24" cy="24" r="2.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function GoldFlourish({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 220 12"
      aria-hidden="true"
      className={`h-[3.2mm] w-[64mm] text-[#c9a54a] ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
    >
      <line x1="0" y1="6" x2="98" y2="6" />
      <path d="M110 1 L115 6 L110 11 L105 6 Z" fill="#e2c05a" strokeWidth="1" />
      <line x1="122" y1="6" x2="220" y2="6" />
    </svg>
  );
}

export default function CertificatePrintDialog({
  open,
  onClose,
  students,
  term,
  schoolYear,
}: CertificatePrintDialogProps) {
  const {
    colors,
    logoUrl,
    schoolName,
    schoolRegion,
    schoolDivision,
    schoolId,
    currentSchoolYear,
  } = useTheme();
  const printRef = useRef<HTMLDivElement>(null);
  const [venue, setVenue] = useState("");
  const [awardDate, setAwardDate] = useState(() =>
    new Date().toLocaleDateString("en-PH", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  );

  const schoolHeadQuery = useQuery({
    queryKey: ["public-settings", "certificate"],
    queryFn: async () => (await publicSettingsApi.getSettings()).data,
    enabled: open,
    staleTime: 5 * 60_000,
    retry: 0,
  });
  const schoolHeadName = schoolHeadQuery.data?.settings.schoolHeadName ?? "";
  const adviserName = useMemo(() => adviserDisplayName(), []);

  const effectiveYear = schoolYear || currentSchoolYear || "";
  const isFinal = term === "FINAL";
  const fullLogoUrl = logoUrl
    ? logoUrl.startsWith("http")
      ? logoUrl
      : `${SERVER_URL}${logoUrl}`
    : null;
  const effectiveVenue = venue.trim() || schoolName;

  const handlePrint = () => {
    if (students.length === 0) return;
    printForm(printRef.current, {
      styleId: "certificate-print-style",
      orientation: "landscape",
      extraCss: `
        .sf-print-container .cert-page {
          width: 100% !important;
          height: 186mm !important;
          padding: 9mm 12mm !important;
          margin: 0 !important;
          box-shadow: none !important;
          page-break-after: always !important;
          break-after: page !important;
          overflow: hidden !important;
          height: 209mm !important;
          border: 3px solid ${colors.primary} !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        @page { size: A4 landscape; margin: 0 !important; }
        .sf-print-container .cert-page,
        .sf-print-container .cert-page * {
          background-color: transparent !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .sf-print-container .cert-watermark { max-width: 90mm !important; max-height: 90mm !important; }
        .sf-print-container .cert-page .cert-republic { font-size: 10pt !important; }
        .sf-print-container .cert-page .cert-deped { font-size: 10.5pt !important; }
        .sf-print-container .cert-page .cert-region { font-size: 10pt !important; }
        .sf-print-container .cert-page .cert-school { font-size: 11pt !important; }
        .sf-print-container .cert-page .cert-schoolid { font-size: 9pt !important; }
        .sf-print-container .cert-page .cert-title { font-size: 26pt !important; letter-spacing: 0.06em !important; }
        .sf-print-container .cert-page .cert-ribbon { font-size: 10pt !important; letter-spacing: 0.3em !important; }
        .sf-print-container .cert-page .cert-student { font-size: 24pt !important; }
        .sf-print-container .cert-page p { line-height: 1.7 !important; }
        .sf-print-container .cert-page .cert-body { font-size: 11.5pt !important; line-height: 1.7 !important; }
        .sf-print-container .cert-page .cert-given { font-size: 10.5pt !important; }
        .sf-print-container .cert-page .cert-sign-name { font-size: 11pt !important; }
        .sf-print-container .cert-page .cert-sign-role { font-size: 9.5pt !important; }
        .sf-print-container .cert-logo { max-width: 18mm !important; max-height: 18mm !important; }
        .sf-print-container .cert-page:last-child { page-break-after: auto !important; break-after: auto !important; }
      `,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold text-foreground">
                Print certificates
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs text-muted-foreground">
                {students.length} learner{students.length !== 1 ? "s" : ""} ·{" "}
                {isFinal ? "Final Grade" : termLabel(term)}
                {isFinal ? " · School Year " + effectiveYear : ""} · A4 landscape, one page per
                learner
              </DialogDescription>
            </div>
            <Button
              type="button"
              size="sm"
              className="shrink-0 text-xs font-semibold"
              onClick={handlePrint}
              disabled={students.length === 0}
            >
              <Printer className="mr-1.5 h-3.5 w-3.5" />
              Print
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-[11px] font-medium text-muted-foreground" htmlFor="cert-date">
              Date of awarding
            </label>
            <Input
              id="cert-date"
              value={awardDate}
              onChange={(e) => setAwardDate(e.target.value)}
              className="h-8 w-52 text-xs"
            />
            <label className="text-[11px] font-medium text-muted-foreground" htmlFor="cert-venue">
              Venue
            </label>
            <Input
              id="cert-venue"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder={schoolName}
              className="h-8 w-64 text-xs"
            />
          </div>
        </DialogHeader>

        {students.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No learners to print for this term.
          </p>
        ) : (
          <div className="overflow-x-auto">
          <div ref={printRef} className="space-y-6">
            <style>{`.cert-page .cert-accent { color: ${colors.primary} !important; }`}</style>
            {students.map((student) => {
              const honor = isFinal ? finalHonor(student.grade) : null;
              const title = honor ? "Certificate of Academic Excellence" : "Certificate of Recognition";
              return (
                <div
                  key={student.id}
                  className="cert-page print-form relative mx-auto w-[297mm] shrink-0 overflow-hidden bg-white px-[12mm] py-[9mm] text-black shadow-xl"
                  style={{ height: "209mm", border: `3px solid ${colors.primary}` }}
                >
                  <div className="pointer-events-none absolute inset-[3.5mm] border-[0.5mm] border-[#c9a54a]" />
                  <div className="pointer-events-none absolute inset-[5mm] border border-[#c9a54a]/50" />
                  <CornerFlourish className="left-[5mm] top-[5mm]" />
                  <CornerFlourish className="right-[5mm] top-[5mm] rotate-90" />
                  <CornerFlourish className="right-[5mm] bottom-[5mm] rotate-180" />
                  <CornerFlourish className="left-[5mm] bottom-[5mm] -rotate-90" />

                  <img
                    src={fullLogoUrl ?? "/DepEd.png"}
                    alt=""
                    aria-hidden="true"
                    className="cert-watermark pointer-events-none absolute left-1/2 top-1/2 h-[95mm] w-[95mm] -translate-x-1/2 -translate-y-1/2 object-contain opacity-[0.07]"
                  />

                  <div className="relative flex h-full flex-col items-center">
                    <div className="grid w-full grid-cols-[26mm_1fr_26mm] items-start gap-3">
                      <img src="/DepEd.png" alt="DepEd Logo" className="cert-logo h-[18mm] w-[18mm] object-contain" />
                      <div className="text-center font-['Times_New_Roman',Times,serif] leading-tight">
                        <p className="cert-republic text-[10pt]">Republic of the Philippines</p>
                        <p className="cert-deped text-[10.5pt] font-semibold">Department of Education</p>
                        <p className="cert-region text-[10pt]">{formatRegionLabel(schoolRegion)}</p>
                        <p className="cert-region text-[10pt]">{formatDivisionLabel(schoolDivision)}</p>
                        <p className="cert-school text-[11pt] font-bold uppercase">{schoolName}</p>
                        <p className="cert-schoolid text-[9pt] text-black/70">
                          {schoolId ? `School ID: ${schoolId}` : null}
                        </p>
                      </div>
                      <div className="flex justify-end">
                        {fullLogoUrl ? (
                          <img src={fullLogoUrl} alt="School Logo" className="cert-logo h-[18mm] w-[18mm] object-contain" />
                        ) : (
                          <img src="/DepEd.png" alt="DepEd Seal" className="cert-logo h-[18mm] w-[18mm] object-contain" />
                        )}
                      </div>
                    </div>

                    <div className="mt-6 flex items-center justify-center gap-[3mm] text-[#c9a54a]">
                      <Star className="h-[3.5mm] w-[3.5mm] fill-current" strokeWidth={0} />
                      <Star className="h-[4.5mm] w-[4.5mm] fill-current" strokeWidth={0} />
                      <Star className="h-[3.5mm] w-[3.5mm] fill-current" strokeWidth={0} />
                    </div>
                    <p className="cert-title cert-accent font-serif mt-3 text-center text-[26pt] font-bold uppercase leading-none tracking-[0.08em]">
                      {title}
                    </p>
                    <GoldFlourish className="mt-2" />

                    <p className="cert-ribbon mt-4 text-center text-[10pt] uppercase tracking-[0.3em] text-black/70">
                      is hereby presented to
                    </p>
                    <p className="cert-student cert-accent font-serif mt-2 text-center text-[24pt] font-bold uppercase leading-tight">
                      {flipName(student.name)}
                    </p>
                    <GoldFlourish className="mt-1" />

                    <p className="cert-body mx-auto mt-5 max-w-[215mm] text-center text-[11.5pt] leading-relaxed">
                      for outstanding academic performance as a learner of Section{" "}
                      <span className="font-semibold">{student.class}</span>
                      {honor ? (
                        <>
                          , awarded <span className="font-bold">{honor}</span> with a general average of{" "}
                          <span className="font-bold">{student.grade.toFixed(2)}</span> for School Year{" "}
                          <span className="font-bold">{effectiveYear}</span>.
                        </>
                      ) : isFinal ? (
                        <>
                          {" "}with a general average of{" "}
                          <span className="font-bold">{student.grade.toFixed(2)}</span> for School Year{" "}
                          <span className="font-bold">{effectiveYear}</span>.
                        </>
                      ) : (
                        <>
                          {" "}with an average of{" "}
                          <span className="font-bold">{student.grade.toFixed(2)}</span> for{" "}
                          <span className="font-bold">{termLabel(term)}</span>, School Year{" "}
                          <span className="font-bold">{effectiveYear}</span>.
                        </>
                      )}
                    </p>

                    <p className="cert-given mt-4 text-center text-[10.5pt]">
                      Given this {awardDate || "________"} at {effectiveVenue || "________________"}.
                    </p>

                    <div className="mt-auto mb-[1mm] flex items-center justify-center pt-4">
                      <svg
                        viewBox="0 0 120 160"
                        aria-hidden="true"
                        className="h-[38mm] w-[28.5mm]"
                      >
                        <path
                          d="M40 82 L58 90 L52 148 L38 134 Z"
                          fill={colors.primary}
                          stroke="#6b0f0f"
                          strokeWidth="2"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M80 82 L62 90 L68 148 L82 134 Z"
                          fill={colors.primary}
                          stroke="#6b0f0f"
                          strokeWidth="2"
                          strokeLinejoin="round"
                        />
                        <circle cx="60" cy="52" r="42" fill="#d4af37" stroke="#a8842f" strokeWidth="3" />
                        <circle cx="60" cy="52" r="34" fill="none" stroke="#8a6d1f" strokeWidth="1.6" opacity="0.65" />
                        <circle cx="60" cy="52" r="29" fill="#e8cf85" />
                        <path
                          d="M60 32 L65 43.5 L77.5 44.5 L68 52.3 L70.8 64.5 L60 58.2 L49.2 64.5 L52 52.3 L42.5 44.5 L55 43.5 Z"
                          fill="#8a6d1f"
                        />
                      </svg>
                    </div>

                    <div className="mt-auto grid w-full grid-cols-2 gap-16 pt-4">
                      <div className="text-center">
                        <p className="cert-sign-name text-[11pt] font-bold uppercase">
                          {adviserName || "____________________"}
                        </p>
                        <div className="mx-auto mt-1 w-56 border-t-2 border-[#c9a54a]" />
                        <p className="cert-sign-role mt-1 text-[9.5pt]">Class Adviser</p>
                      </div>
                      <div className="text-center">
                        <p className="cert-sign-name text-[11pt] font-bold uppercase">
                          {schoolHeadName || "____________________"}
                        </p>
                        <div className="mx-auto mt-1 w-56 border-t-2 border-[#c9a54a]" />
                        <p className="cert-sign-role mt-1 text-[9.5pt]">School Head</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
