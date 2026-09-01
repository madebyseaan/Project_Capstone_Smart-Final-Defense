import { useState, useEffect } from "react";
import { Loader2, Printer, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { registrarApi } from "@/lib/api";

interface SF1Student {
  lrn: string;
  lastName: string;
  firstName: string;
  middleName: string;
  suffix: string;
  birthDate: string | null;
  ageAsOfJune: number | null;
  gender: string;
  birthPlace: string;
  motherTongue: string;
  ipCommunity: string;
  religion: string;
  address: { houseStreet: string; barangay: string; municipality: string; province: string };
  fatherName: string;
  motherName: string;
  guardianName: string;
  guardianRelationship: string;
  guardianContact: string;
  remarks: string[];
  index: number;
}

interface SF1Props {
  sectionId: string;
  schoolYear: string;
}

export default function SF1Form({ sectionId, schoolYear }: SF1Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    registrarApi.getSF1Data(sectionId, schoolYear)
      .then((res) => setData(res.data))
      .catch((err) => setError(err?.response?.data?.message ?? "Failed to load SF1"))
      .finally(() => setLoading(false));
  }, [sectionId, schoolYear]);

  if (loading) return <div className="flex items-center gap-2 py-8 text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading SF1...</div>;
  if (error) return <div className="py-8 text-red-500 text-sm">{error}</div>;
  if (!data) return null;

  const students: SF1Student[] = data.students ?? [];
  const males = students.filter((s) => s.gender === "Male");
  const females = students.filter((s) => s.gender === "Female");
  const section = data.section;
  const school = data.schoolSettings;

  const addr = (a: SF1Student["address"]) => [a.houseStreet, a.barangay, a.municipality, a.province].filter(Boolean).join(", ");

  const renderBlock = (label: string, rows: SF1Student[], startIndex: number) => (
    <>
      <tr className="bg-slate-100 font-semibold text-xs">
        <td colSpan={17} className="px-2 py-1 border">{label}</td>
      </tr>
      {rows.map((s, i) => (
        <tr key={s.lrn + i} className="text-xs">
          <td className="border px-1 py-0.5 text-center">{startIndex + i + 1}</td>
          <td className="border px-1 py-0.5">{s.lrn}</td>
          <td className="border px-1 py-0.5">{s.lastName}, {s.firstName} {s.middleName} {s.suffix}</td>
          <td className="border px-1 py-0.5 text-center">{s.gender === "Male" ? "M" : "F"}</td>
          <td className="border px-1 py-0.5 text-center">{s.birthDate ? new Date(s.birthDate).toLocaleDateString("en-PH") : ""}</td>
          <td className="border px-1 py-0.5 text-center">{s.ageAsOfJune ?? ""}</td>
          <td className="border px-1 py-0.5">{s.birthPlace}</td>
          <td className="border px-1 py-0.5">{s.motherTongue}</td>
          <td className="border px-1 py-0.5 text-center">{s.ipCommunity === "IP" ? "✓" : ""}</td>
          <td className="border px-1 py-0.5">{s.religion}</td>
          <td className="border px-1 py-0.5 text-[10px]">{addr(s.address)}</td>
          <td className="border px-1 py-0.5">{s.fatherName}</td>
          <td className="border px-1 py-0.5">{s.motherName}</td>
          <td className="border px-1 py-0.5">{s.guardianName}</td>
          <td className="border px-1 py-0.5">{s.guardianRelationship}</td>
          <td className="border px-1 py-0.5">{s.guardianContact}</td>
          <td className="border px-1 py-0.5">{s.remarks.join(", ")}</td>
        </tr>
      ))}
      <tr className="bg-slate-50 font-semibold text-xs">
        <td colSpan={1} className="border px-1 py-0.5 text-right">TOTAL {label.replace(" STUDENTS", "")}:</td>
        <td colSpan={16} className="border px-1 py-0.5 text-right">{rows.length}</td>
      </tr>
    </>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between no-print">
        <h3 className="font-semibold text-gray-900">SF1 — School Register</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-1" /> Print
          </Button>
          <Button variant="outline" size="sm" onClick={async () => {
            try {
              const res = await registrarApi.exportSF1(sectionId, schoolYear);
              const blob = new Blob([res.data as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `SF1_${section.name}_${schoolYear}.xlsx`;
              a.click();
              URL.revokeObjectURL(url);
            } catch {}
          }}>
            <Download className="w-4 h-4 mr-1" /> Export
          </Button>
        </div>
      </div>

      <div className="sf1-print-area overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-200">
              <th className="border px-1 py-1 w-8">#</th>
              <th className="border px-1 py-1 w-24">LRN</th>
              <th className="border px-1 py-1 w-40">Name (Last, First, Middle)</th>
              <th className="border px-1 py-1 w-8">Sex</th>
              <th className="border px-1 py-1 w-20">Birth Date</th>
              <th className="border px-1 py-1 w-8">Age</th>
              <th className="border px-1 py-1 w-24">Birth Place</th>
              <th className="border px-1 py-1 w-20">Mother Tongue</th>
              <th className="border px-1 py-1 w-8">IP</th>
              <th className="border px-1 py-1 w-16">Religion</th>
              <th className="border px-1 py-1 w-40">Address</th>
              <th className="border px-1 py-1 w-28">Father's Name</th>
              <th className="border px-1 py-1 w-28">Mother's Name</th>
              <th className="border px-1 py-1 w-28">Guardian</th>
              <th className="border px-1 py-1 w-16">Rel.</th>
              <th className="border px-1 py-1 w-20">Contact</th>
              <th className="border px-1 py-1 w-16">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {renderBlock("MALE STUDENTS", males, 0)}
            {renderBlock("FEMALE STUDENTS", females, males.length)}
            <tr className="bg-slate-200 font-bold text-xs">
              <td colSpan={1} className="border px-1 py-0.5 text-right">TOTAL:</td>
              <td colSpan={16} className="border px-1 py-0.5 text-right">{students.length}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-6 text-[10px] text-gray-600 border-t pt-4 grid grid-cols-2 gap-8">
          <div>
            <p className="font-semibold mb-2">Remarks Codes:</p>
            <p>T/O — Transferred Out | T/I — Transferred In | DRP — Dropped | B/A — Balik-Aral</p>
            <p>CCT — 4Ps Beneficiary | LWD — Learner with Disability | ACL — Accelerated | LE — Late Enrollee</p>
          </div>
          <div className="space-y-6">
            <div className="border-t border-gray-400 pt-1 w-48">Prepared by: Adviser</div>
            <div className="border-t border-gray-400 pt-1 w-48">Certified correct: School Head</div>
          </div>
        </div>
      </div>
    </div>
  );
}
