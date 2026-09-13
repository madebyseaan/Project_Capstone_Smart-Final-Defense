import React, { useState, useEffect, useRef } from "react";
import {
  ArrowLeft,
  Printer,
  Download,
  Pencil,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import api, { registrarApi, type Section, SERVER_URL, type SF9Data, type SF10Data, type SF1Data, type SF5Data, type SF1Student } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import SF5Form from "./components/SF5Form";
import SF9Form from "./components/SF9Form";
import SF10Form from "./components/SF10Form";
import SF9Inspector from "./components/SF9Inspector";
import SF10Inspector from "./components/SF10Inspector";
import SF10Editor from "./components/SF10Editor";
import { BulkSF9View, BulkSF10View } from "./components/BulkFormsView";
import SFListView from "./components/SFListView";
import SF2Form from "./components/SF2Form";
import SF6Form from "./components/SF6Form";

// Student type for the forms page
interface FormStudent {
  id: string;
  lrn: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  gender?: string;
}

type ViewMode = "list" | "sf1" | "sf2" | "sf5" | "sf6" | "sf9" | "sf10" | "bulk_sf9" | "bulk_sf10";

/** Right-side slide-over drawer: fixed overlay, independent scroll, no content squeeze. */
function RightDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`fixed inset-0 z-50 print-hide ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <div
        className={`absolute inset-y-0 right-0 w-full sm:max-w-[440px] bg-background border-l border-border shadow-2xl flex flex-col transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {children}
      </div>
    </div>
  );
}

export default function SchoolForms() {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schoolYear, setSchoolYear] = useState("");
  const [schoolYears, setSchoolYears] = useState<string[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedGrade, setSelectedGrade] = useState<string>("ALL");
  const [selectedSection, setSelectedSection] = useState<string>("");
  const [students, setStudents] = useState<FormStudent[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  // Derived unique grade levels from sections
  const uniqueGradeLevels = Array.from(new Set(sections.map(s => s.gradeLevel))).sort((a, b) => {
    const aNum = parseInt(a.replace(/\D/g, '')) || 0;
    const bNum = parseInt(b.replace(/\D/g, '')) || 0;
    return aNum - bNum;
  });

  // Filtered sections based on selected grade
  const filteredSectionsForDropdown = selectedGrade === "ALL" 
    ? sections 
    : sections.filter(s => s.gradeLevel === selectedGrade);

  const { colors: themeColors, schoolName, logoUrl } = useTheme();
  const fullLogoUrl = logoUrl ? (logoUrl.startsWith("http") ? logoUrl : `${SERVER_URL}${logoUrl}`) : null;
  
  // Selection state
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  
  // Form data states
  const [sf1Data, setSf1Data] = useState<SF1Data | null>(null);
  const [sf2Data, setSf2Data] = useState<any>(null);
  const [sf5Data, setSf5Data] = useState<SF5Data | null>(null);
  const [sf6Data, setSf6Data] = useState<any>(null);
  const [sf9Data, setSf9Data] = useState<any>(null);
  const [sf10Data, setSf10Data] = useState<any>(null);
  const [bulkSf9Data, setBulkSf9Data] = useState<SF9Data[]>([]);
  const [bulkSf10Data, setBulkSf10Data] = useState<SF10Data[]>([]);
  const sf1PrintRef = useRef<HTMLDivElement | null>(null);
  const sf5PrintRef = useRef<HTMLDivElement | null>(null);
  const sf9PrintRef = useRef<HTMLDivElement | null>(null);
  const sf10PrintRef = useRef<HTMLDivElement | null>(null);
  const bulkPrintRef = useRef<HTMLDivElement | null>(null);

  // Inspector highlight state (split viewer)
  const [sf9Highlight, setSf9Highlight] = useState<string | null>(null);
  const [sf10Highlight, setSf10Highlight] = useState<{ recordIndex: number; name: string } | null>(null);
  const [sf10EditMode, setSf10EditMode] = useState(false);
  const [sf10InspectOpen, setSf10InspectOpen] = useState(false);
  const [sf10Preview, setSf10Preview] = useState<Record<string, unknown> | null>(null);
  const [sf10FocusSection, setSf10FocusSection] = useState<"learner" | "eligibility" | "transferee" | null>(null);


  // Load school years on mount
  useEffect(() => {
    registrarApi.getSchoolYears().then((res) => {
      const sysYears = res.data.schoolYears;
      if (sysYears && sysYears.length > 0) {
        setSchoolYears(sysYears);
        setSchoolYear(sysYears[0]);
      }
    }).catch(console.error);
  }, []);

  // Load sections on mount
  useEffect(() => {
    const loadSections = async () => {
      setError(null);
      setSelectedGrade("ALL");
      setSelectedSection("");
      setStudents([]);
      setSelectedStudent("");
      try {
        const response = await registrarApi.getSections({ schoolYear });
        setSections(response.data || []);
      } catch (error: any) {
        console.error("Error loading sections:", error);
        if (error.response?.status === 403) {
          setError("Access denied. Please log in as Registrar.");
        } else if (error.response?.status === 401) {
          setError("Session expired. Please log in again.");
        } else {
          setError("Failed to load sections. Please check server connection.");
        }
        setSections([]);
      }
    };
    loadSections();
  }, [schoolYear]);

  // Load students when section changes
  useEffect(() => {
    const loadStudents = async () => {
      if (!selectedSection) {
        setStudents([]);
        return;
      }
      try {
        const response = await registrarApi.getStudents({ sectionId: selectedSection, schoolYear });
        const studentsData = response.data.students || response.data;
        setStudents(Array.isArray(studentsData) ? studentsData : []);
      } catch (error) {
        console.error("Error loading students:", error);
        setStudents([]);
      }
    };
    loadStudents();
  }, [selectedSection, schoolYear]);

  const executePrint = (ref: React.RefObject<HTMLDivElement | null>, styleId: string) => {
    const formNode = ref.current;
    if (!formNode) return;

    const printContainer = document.createElement("div");
    printContainer.className = "sf-print-container";
    printContainer.appendChild(formNode.cloneNode(true));
    document.body.appendChild(printContainer);

    const printStyle = document.createElement("style");
    printStyle.id = styleId;
    printStyle.textContent = `
      @media print {
        @page { size: A4 portrait; margin: 10mm 8mm; }
        body > *:not(.sf-print-container) { display: none !important; }
        .sf-print-container { display: block !important; width: 100% !important; }
        .sf-print-container .print-form { box-shadow: none !important; margin: 0 !important; padding: 4mm !important; border: none !important; width: 100% !important; max-width: none !important; page-break-after: always !important; }
        .sf-print-container img { max-width: 56px !important; max-height: 56px !important; object-fit: contain !important; }
        .sf-print-container * { font-size: 9pt !important; line-height: 1.3 !important; }
        .sf-print-container h1 { font-size: 11pt !important; font-weight: bold !important; }
        .sf-print-container h2, .sf-print-container h3 { font-size: 10pt !important; font-weight: bold !important; }
        .sf-print-container table { width: 100% !important; border-collapse: collapse !important; table-layout: fixed; }
        .sf-print-container th, .sf-print-container td { border: 1px solid #000 !important; padding: 1.5px 3px !important; vertical-align: middle; }
        .sf-print-container .bg-gray-200, .sf-print-container .bg-gray-100 { background: #eee !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .sf9-page-break { page-break-before: always !important; break-before: page !important; }
      }
    `;
    document.head.appendChild(printStyle);

    const cleanup = () => {
      if (document.body.contains(printContainer)) document.body.removeChild(printContainer);
      const s = document.getElementById(styleId);
      if (s) s.remove();
    };

    window.addEventListener("afterprint", cleanup, { once: true });
    window.setTimeout(cleanup, 60000);
    window.print();
  };

  const handleViewSF9 = async (studentId?: string) => {
    const id = studentId || selectedStudent;
    if (!id) return;
    setLoading(true);
    try {
      const response = await registrarApi.getSF9(id, schoolYear);
      setSf9Data(response.data);
      setViewMode("sf9");
    } catch (error) {
      console.error("Error loading SF9:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleViewSF10 = async (studentId?: string) => {
    const id = studentId || selectedStudent;
    if (!id) return;
    setLoading(true);
    try {
      const response = await registrarApi.getSF10(id);
      setSf10Data(response.data);
      setViewMode("sf10");
    } catch (error) {
      console.error("Error loading SF10:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleViewSF1 = async () => {
    if (!selectedSection) return;
    setLoading(true);
    try {
      const response = await registrarApi.getSF1(selectedSection, schoolYear);
      setSf1Data(response.data);
      setViewMode("sf1");
    } catch (error) {
      console.error("Error loading SF1:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleViewSF2 = async () => {
    if (!selectedSection) return;
    setLoading(true);
    try {
      const response = await registrarApi.getAttendanceSummary(selectedSection);
      setSf2Data(response.data);
      setViewMode("sf2");
    } catch (error) {
      console.error("Error loading SF2:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleViewSF5 = async () => {
    if (!selectedSection) return;
    setLoading(true);
    try {
      const response = await registrarApi.getSF5(selectedSection, schoolYear);
      setSf5Data(response.data);
      setViewMode("sf5");
    } catch (error) {
      console.error("Error loading SF5:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleViewSF6 = async () => {
    setLoading(true);
    try {
      const response = await registrarApi.getSF6(schoolYear);
      setSf6Data(response.data);
      setViewMode("sf6");
    } catch (error) {
      console.error("Error loading SF6:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setViewMode("list");
    setSf1Data(null);
    setSf2Data(null);
    setSf5Data(null);
    setSf6Data(null);
    setSf9Data(null);
    setSf10Data(null);
    setBulkSf9Data([]);
    setBulkSf10Data([]);
    setSf9Highlight(null);
    setSf10Highlight(null);
    setSf10EditMode(false);
  };

  const handleToggleAll = () => {
    if (selectedStudentIds.length === filteredStudents.length && filteredStudents.length > 0) {
      setSelectedStudentIds([]);
    } else {
      setSelectedStudentIds(filteredStudents.map(s => s.id));
    }
  };

  const handleToggleStudent = (id: string) => {
    // Also set the single selected student for the view buttons
    setSelectedStudent(id);
    setSelectedStudentIds(prev => 
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

  const handleBulkPrint = async (formType: 'sf9' | 'sf10', all = false) => {
    const idsToPrint = all ? students.map(s => s.id) : selectedStudentIds;
    if (idsToPrint.length === 0) return;
    
    setLoading(true);
    try {
      const results = await Promise.all(
        idsToPrint.map(id => 
          formType === 'sf9' ? registrarApi.getSF9(id, schoolYear) : registrarApi.getSF10(id)
        )
      );
      
      const data = results.map(r => r.data);
      if (formType === 'sf9') {
        setBulkSf9Data(data as SF9Data[]);
        setViewMode("bulk_sf9");
      } else {
        setBulkSf10Data(data as SF10Data[]);
        setViewMode("bulk_sf10");
      }
    } catch (error) {
      console.error("Bulk print error:", error);
      setError("Failed to load forms for bulk printing.");
    } finally {
      setLoading(false);
    }
  };

  const filteredStudents = students.filter((student) => {
    const fullName = `${student.firstName} ${student.middleName || ""} ${student.lastName}`.toLowerCase();
    return fullName.includes(searchQuery.toLowerCase()) || student.lrn.includes(searchQuery);
  });

  const renderSF1Content = (data: SF1Data) => {
    const males = data.students.filter((s) => s.gender === "Male");
    const females = data.students.filter((s) => s.gender === "Female");

    const renderStudentRow = (s: SF1Student) => (
      <tr key={`${s.gender}-${s.index}`} className="hover:bg-gray-50">
        <td className="border border-black p-0.5 text-center">{s.lrn}</td>
        <td className="border border-black p-0.5">{s.lastName}, {s.firstName} {s.middleName}</td>
        <td className="border border-black p-0.5 text-center">{s.gender === "Male" ? "M" : "F"}</td>
        <td className="border border-black p-0.5">{s.birthDate}</td>
        <td className="border border-black p-0.5 text-center">{s.ageAsOfJune}</td>
        <td className="border border-black p-0.5">{s.birthPlace}</td>
        <td className="border border-black p-0.5">{s.motherTongue}</td>
        <td className="border border-black p-0.5 text-center">{s.ipCommunity}</td>
        <td className="border border-black p-0.5">{s.religion}</td>
        <td className="border border-black p-0.5">{s.address.houseStreet}{s.address.barangay ? `, Brgy. ${s.address.barangay}` : ""}{s.address.municipality ? `, ${s.address.municipality}` : ""}{s.address.province ? `, ${s.address.province}` : ""}</td>
        <td className="border border-black p-0.5">{s.fatherName}</td>
        <td className="border border-black p-0.5">{s.motherName}</td>
        <td className="border border-black p-0.5">{s.guardianName}</td>
        <td className="border border-black p-0.5 text-center">{s.guardianContact}</td>
        <td className="border border-black p-0.5">{Array.isArray(s.remarks) ? s.remarks.join(", ") : s.remarks || ""}</td>
      </tr>
    );

    return (
      <div className="bg-white border-2 border-gray-400 shadow-xl print-form p-4 mb-8 text-[9px] leading-tight">
        {/* SF1 Label */}
        <div className="mb-1">
          <span className="font-bold text-gray-900 text-xs">SF1</span>
        </div>

        {/* Header */}
        <div className="text-center mb-2">
          <p className="font-bold text-gray-900">Republic of the Philippines</p>
          <p className="font-bold text-gray-900">Department of Education</p>
        </div>

        {/* School info bar */}
        <div className="grid grid-cols-4 gap-x-4 gap-y-0.5 border border-black p-1.5 mb-2 text-[9px]">
          <div>School ID: <span className="font-bold">{data.schoolSettings?.schoolId}</span></div>
          <div>Region: <span className="font-bold">{data.schoolSettings?.region}</span></div>
          <div>Division: <span className="font-bold">{data.schoolSettings?.division}</span></div>
          <div>District: <span className="font-bold">{data.schoolSettings?.district}</span></div>
          <div className="col-span-2">School Name: <span className="font-bold">{data.schoolSettings?.schoolName}</span></div>
          <div>School Year: <span className="font-bold">{data.section.schoolYear}</span></div>
          <div>Grade Level: <span className="font-bold">{data.section.gradeLevel?.replace("_", " ")}</span></div>
          <div>Section: <span className="font-bold">{data.section.name}</span></div>
          <div>Adviser: <span className="font-bold">{data.section.adviserName}</span></div>
        </div>

        {/* Student table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse border border-black text-[8px]">
            <thead>
              <tr className="bg-gray-200">
                <th className="border border-black p-0.5 min-w-[80px]">LRN</th>
                <th className="border border-black p-0.5 min-w-[140px]">NAME (Last, First, Middle)</th>
                <th className="border border-black p-0.5 min-w-[25px]">Sex</th>
                <th className="border border-black p-0.5 min-w-[60px]">Birth Date</th>
                <th className="border border-black p-0.5 min-w-[25px]">Age</th>
                <th className="border border-black p-0.5 min-w-[60px]">Birth Place</th>
                <th className="border border-black p-0.5 min-w-[60px]">Mother Tongue</th>
                <th className="border border-black p-0.5 min-w-[25px]">IP</th>
                <th className="border border-black p-0.5 min-w-[55px]">Religion</th>
                <th className="border border-black p-0.5 min-w-[150px]">ADDRESS</th>
                <th className="border border-black p-0.5 min-w-[100px]">Father</th>
                <th className="border border-black p-0.5 min-w-[100px]">Mother</th>
                <th className="border border-black p-0.5 min-w-[80px]">Guardian</th>
                <th className="border border-black p-0.5 min-w-[60px]">Contact</th>
                <th className="border border-black p-0.5 min-w-[50px]">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {/* MALE section */}
              {males.map(renderStudentRow)}
              <tr className="bg-gray-100 font-bold">
                <td colSpan={15} className="border border-black p-0.5 text-right pr-2">TOTAL MALE: {males.length}</td>
              </tr>

              {/* FEMALE section */}
              {females.map(renderStudentRow)}
              <tr className="bg-gray-100 font-bold">
                <td colSpan={15} className="border border-black p-0.5 text-right pr-2">TOTAL FEMALE: {females.length}</td>
              </tr>

              {/* COMBINED TOTAL */}
              <tr className="bg-gray-200 font-bold">
                <td colSpan={15} className="border border-black p-0.5 text-right pr-2">TOTAL: {data.summary.totalCount}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Remarks Legend */}
        <div className="mt-2 border border-black p-1.5 text-[7px]">
          <p className="font-bold mb-0.5">List and Code of Indicators under REMARK column:</p>
          <div className="grid grid-cols-4 gap-x-4 gap-y-0.5">
            <div>T/O â€” Transferred Out</div>
            <div>T/I â€” Transferred In</div>
            <div>DRP â€” Dropped Out</div>
            <div>B/A â€” Balik-Aral</div>
            <div>CCT â€” 4Ps Recipient</div>
            <div>LWD â€” Learner with Disability</div>
            <div>ACL â€” Accelerated</div>
            <div>LE â€” Late Enrollment</div>
          </div>
        </div>

        {/* Signatures */}
        <div className="mt-3 grid grid-cols-2 gap-4 text-[9px]">
          <div className="text-center">
            <div className="border-b border-gray-600 mt-8 mx-4"></div>
            <p className="mt-0.5">Prepared by:</p>
            <p className="text-[8px]">(Signature of Adviser over Printed Name)</p>
            <p className="mt-1">Date: ___________</p>
          </div>
          <div className="text-center">
            <div className="border-b border-gray-600 mt-8 mx-4"></div>
            <p className="mt-0.5">Certified Correct:</p>
            <p className="text-[8px]">(Signature of School Head over Printed Name)</p>
            <p className="mt-1">Date: ___________</p>
          </div>
        </div>

        {/* BoSY / EoSY dates */}
        <div className="mt-2 flex justify-between text-[8px]">
          <span>BoSY Date: ___________</span>
          <span>EoSY Date: ___________</span>
        </div>
      </div>
    );
  };

  // Form List View
  if (viewMode === "list") {
    return (
      <SFListView
        error={error}
        schoolYear={schoolYear}
        schoolYears={schoolYears}
        onSchoolYearChange={setSchoolYear}
        selectedGrade={selectedGrade}
        onGradeChange={(v) => {
          setSelectedGrade(v);
          setSelectedSection("");
          setStudents([]);
          setSelectedStudent("");
        }}
        uniqueGradeLevels={uniqueGradeLevels}
        selectedSection={selectedSection}
        selectedStudent={selectedStudent}
        onSectionChange={(v) => {
          setSelectedSection(v);
          setSelectedStudent("");
        }}
        sections={sections}
        filteredSectionsForDropdown={filteredSectionsForDropdown}
        students={students}
        filteredStudents={filteredStudents}
        selectedStudentIds={selectedStudentIds}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onToggleAll={handleToggleAll}
        onToggleStudent={handleToggleStudent}
        onViewSF1={handleViewSF1}
        onViewSF2={handleViewSF2}
        onViewSF5={handleViewSF5}
        onViewSF6={handleViewSF6}
        onViewSF9={handleViewSF9}
        onViewSF10={handleViewSF10}
        onBulkPrint={(formType) => handleBulkPrint(formType)}
        onBulkPrintAll={(formType) => handleBulkPrint(formType, true)}
        themeColors={themeColors}
      />
    );
  }

  if (viewMode === "bulk_sf9" && bulkSf9Data.length > 0) {
    return (
      <BulkSF9View
        data={bulkSf9Data}
        fullLogoUrl={fullLogoUrl}
        printRef={bulkPrintRef}
        onBack={handleBack}
        onPrint={() => executePrint(bulkPrintRef, "bulk-sf9-print-style")}
      />
    );
  }

  if (viewMode === "bulk_sf10" && bulkSf10Data.length > 0) {
    return (
      <BulkSF10View
        data={bulkSf10Data}
        schoolName={schoolName}
        printRef={bulkPrintRef}
        onBack={handleBack}
        onPrint={() => executePrint(bulkPrintRef, "bulk-sf10-print-style")}
      />
    );
  }

  // SF1 View - School Register (DepEd-aligned)
  if (viewMode === "sf1" && sf1Data) {
    const handlePrint = () => executePrint(sf1PrintRef, "sf1-print-style");

    const handleDownloadExcel = () => {
      const token = sessionStorage.getItem("token_registrar");
      const url = `${api.defaults.baseURL}/registrar/export/sf1/${sf1Data.section.id}?schoolYear=${sf1Data.section.schoolYear}`;
      // Open in new tab with auth header via fetch
      fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => res.blob())
        .then((blob) => {
          const blobUrl = window.URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = `SF1_${sf1Data.section.name}_${sf1Data.section.schoolYear}.xlsx`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.URL.revokeObjectURL(blobUrl);
        })
        .catch((err) => console.error("Error downloading SF1:", err));
    };

    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between print-hide">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={handleBack}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div>
              <h2 className="text-xl font-bold text-foreground">SF1 - School Register</h2>
              <p className="text-sm text-muted-foreground">{sf1Data.section.name} ({sf1Data.section.gradeLevel?.replace("_", " ")}) - {sf1Data.section.schoolYear}</p>
              <p className="text-xs text-muted-foreground">
                {sf1Data.summary.maleCount} Male, {sf1Data.summary.femaleCount} Female, {sf1Data.summary.totalCount} Total
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleDownloadExcel} variant="outline" size="sm" className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs">
              <Download className="w-4 h-4 mr-2" />
              Download Excel
            </Button>
            <Button onClick={handlePrint} variant="default" size="sm" className="font-semibold text-xs shadow-sm shadow-primary/20">
              <Printer className="w-4 h-4 mr-2" />
              Print SF1
            </Button>
          </div>
        </div>

        <div ref={sf1PrintRef}>
          {renderSF1Content(sf1Data)}
        </div>
      </div>
    );
  }

  // SF2 View - Daily Attendance
  if (viewMode === "sf2" && sf2Data) {
    return <SF2Form data={sf2Data} onBack={handleBack} />;
  }

  // SF5 View - Promotion Report
  if (viewMode === "sf5" && sf5Data) {
    const handlePrint = () => executePrint(sf5PrintRef, "sf5-print-style");

    return (
      <div className="space-y-6 animate-fade-in max-w-[900px] mx-auto">
        {/* Action Buttons — hidden when printing */}
        <div className="flex items-center justify-between print-hide">
          <Button variant="ghost" onClick={handleBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <h2 className="text-xl font-bold text-foreground">SF5 - Report on Promotion</h2>
            <p className="text-sm text-muted-foreground">{sf5Data.section.name} ({sf5Data.section.gradeLevel}) - {sf5Data.section.schoolYear}</p>
          </div>
        </div>

        <SF5Form
          ref={sf5PrintRef}
          data={sf5Data}
          onPrint={handlePrint}
        />
      </div>
    );
  }

  // SF6 View - Summary Promotion Report
  if (viewMode === "sf6" && sf6Data) {
    return <SF6Form sf6Data={sf6Data} onBack={handleBack} />;
  }

  // SF9 View - Report Card (DepEd Official Format)
  if (viewMode === "sf9" && sf9Data) {
    const handlePrint = () => executePrint(sf9PrintRef, "sf9-print-style");

    return (
      <div className="space-y-6 animate-fade-in">
        {/* Action Buttons - Hidden when printing */}
        <div className="flex items-center justify-between print-hide">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={handleBack}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div>
              <h2 className="text-xl font-bold text-foreground">SF9 - Learner&apos;s Progress Report Card</h2>
              <p className="text-sm text-muted-foreground">
                {sf9Data.student.name} · {sf9Data.student.section} · {sf9Data.student.schoolYear}
              </p>
            </div>
          </div>
          <Button onClick={handlePrint} variant="default" size="sm" className="font-semibold text-xs shadow-sm shadow-primary/20">
            <Printer className="w-4 h-4 mr-2" />
            Print Form
          </Button>
        </div>

        {/* Split viewer: form + read-only inspector */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
          <div className="min-w-0 max-w-[860px]">
            <div ref={sf9PrintRef}>
              <SF9Form data={sf9Data} fullLogoUrl={fullLogoUrl} highlightSubject={sf9Highlight} />
            </div>
          </div>
          <aside className="lg:sticky lg:top-20 print-hide">
            <SF9Inspector data={sf9Data} highlightSubject={sf9Highlight} onHighlight={setSf9Highlight} />
          </aside>
        </div>
      </div>
    );
  }

  // SF10 View - Permanent Record (DepEd Official Format)
  if (viewMode === "sf10" && sf10Data) {
    const handlePrint = () => executePrint(sf10PrintRef, "sf10-print-style");
    const handleSf10Saved = async () => {
      setSf10EditMode(false);
      setSf10Preview(null);
      setSf10FocusSection(null);
      try {
        const res = await registrarApi.getSF10(sf10Data.student.id);
        setSf10Data(res.data);
      } catch (error) {
        console.error("Error refreshing SF10:", error);
      }
    };
    const sf10ViewData =
      sf10EditMode && sf10Preview
        ? { ...sf10Data, student: { ...sf10Data.student, ...sf10Preview } }
        : sf10Data;
    const closeEdit = () => {
      setSf10EditMode(false);
      setSf10Preview(null);
      setSf10FocusSection(null);
    };

    return (
      <>
        <div className={`space-y-6 animate-fade-in transition-[padding] duration-200 ${sf10EditMode ? "lg:pr-[464px]" : ""}`}>
          {/* Action Buttons - Hidden when printing */}
          <div className="flex flex-wrap items-center justify-between gap-3 print-hide">
            <div className="flex items-center gap-4">
              <Button variant="ghost" onClick={handleBack}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <div>
                <h2 className="text-xl font-bold text-foreground">SF10 - Learner&apos;s Permanent Academic Record</h2>
                <p className="text-sm text-muted-foreground">
                  {sf10Data.student.name} · LRN {sf10Data.student.lrn}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => setSf10InspectOpen(true)} variant="outline" size="sm" className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs">
                <Info className="w-4 h-4 mr-2" />
                Details
              </Button>
              {!sf10EditMode && (
                <Button onClick={() => setSf10EditMode(true)} variant="outline" size="sm" className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs">
                  <Pencil className="w-4 h-4 mr-2" />
                  Edit
                </Button>
              )}
              <Button onClick={handlePrint} variant="default" size="sm" className="font-semibold text-xs shadow-sm shadow-primary/20">
                <Printer className="w-4 h-4 mr-2" />
                Print Form
              </Button>
            </div>
          </div>

          {/* Form — live-previews edits while the editor is open */}
          <div className="mx-auto w-full max-w-[900px]">
            <div ref={sf10PrintRef}>
              <SF10Form
                data={sf10ViewData}
                schoolName={schoolName}
                highlightArea={sf10InspectOpen ? sf10Highlight : null}
                highlightSection={sf10EditMode ? sf10FocusSection : null}
              />
            </div>
          </div>
        </div>

        {/* Docked editor panel (non-modal — the form stays visible and updates live) */}
        {sf10EditMode && (
          <aside className="fixed top-16 bottom-0 right-0 z-20 w-full sm:w-[440px] bg-background border-l border-border shadow-xl flex flex-col print-hide animate-fade-in">
            <SF10Editor
              data={sf10Data}
              onPreview={setSf10Preview}
              onFocusSection={setSf10FocusSection}
              onCancel={closeEdit}
              onSaved={handleSf10Saved}
            />
          </aside>
        )}

        {/* Inspector drawer (read-only reference) */}
        <RightDrawer open={sf10InspectOpen} onClose={() => setSf10InspectOpen(false)}>
          {sf10InspectOpen && (
            <SF10Inspector
              data={sf10ViewData}
              highlightArea={sf10Highlight}
              onHighlight={setSf10Highlight}
              onClose={() => setSf10InspectOpen(false)}
            />
          )}
        </RightDrawer>
      </>
    );
  }

  // Loading or fallback
  return (
    <div className="flex items-center justify-center h-64">
      <p className="text-muted-foreground">Loading...</p>
    </div>
  );
}