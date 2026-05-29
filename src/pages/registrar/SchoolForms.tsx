import React, { useState, useEffect, useRef } from "react";
import {
  FolderOpen,
  FileText,
  BookOpen,
  Printer,
  Eye,
  Search,
  Users,
  ArrowLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  FileCheck,
  Loader2,
  AlertCircle,
  MoreVertical,
  PrinterIcon
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { registrarApi, type Section, SERVER_URL, type SF9Data, type SF10Data } from "@/lib/api";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { HelpTooltip } from "@/components/ui/tooltip";
import { useTheme } from "@/contexts/ThemeContext";

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

interface SchoolForm {
  id: string;
  name: string;
  fullName: string;
  description: string;
  icon: React.ElementType;
  color: string;
  status: "active" | "dev";
}

const schoolForms: SchoolForm[] = [
  {
    id: "SF1",
    name: "School Register",
    fullName: "School Form 1 - School Register",
    description: "Master list of enrolled students.",
    icon: Users,
    color: "gray",
    status: "dev",
  },
  {
    id: "SF2",
    name: "Daily Attendance",
    fullName: "School Form 2 - Daily Attendance Report",
    description: "Daily attendance tracking.",
    icon: Clock,
    color: "gray",
    status: "dev",
  },
  {
    id: "SF3",
    name: "Books Issued",
    fullName: "School Form 3 - Books Issued and Returned",
    description: "Textbook and material tracking.",
    icon: BookOpen,
    color: "gray",
    status: "dev",
  },
  {
    id: "SF4",
    name: "Monthly Movement",
    fullName: "School Form 4 - Monthly Learner's Movement and Attendance",
    description: "Enrollment and dropout summary.",
    icon: FileText,
    color: "gray",
    status: "dev",
  },
  {
    id: "SF5",
    name: "Promotion Report",
    fullName: "School Form 5 - Report on Promotion",
    description: "Final academic performance.",
    icon: CheckCircle2,
    color: "gray",
    status: "dev",
  },
  {
    id: "SF6",
    name: "Promotion Summary",
    fullName: "School Form 6 - Summarized Report on Promotion",
    description: "Consolidated promotion summary.",
    icon: FileCheck,
    color: "gray",
    status: "dev",
  },
  {
    id: "SF7",
    name: "Personnel List",
    fullName: "School Form 7 - School Personnel Assignment List",
    description: "Staff and teaching assignments.",
    icon: Users,
    color: "gray",
    status: "dev",
  },
  {
    id: "SF8",
    name: "Health Profile",
    fullName: "School Form 8 - Learner's Basic Health Profile",
    description: "BMI and nutritional status.",
    icon: BookOpen,
    color: "rose",
    status: "dev",
  },
  {
    id: "SF9",
    name: "Report Card",
    fullName: "School Form 9 - Learner's Progress Report Card",
    description: "Term-based issued report card.",
    icon: FileText,
    color: "blue",
    status: "active",
  },
  {
    id: "SF10",
    name: "Permanent Record",
    fullName: "School Form 10 - Learner's Permanent Academic Record",
    description: "Official cumulative record.",
    icon: FolderOpen,
    color: "green",
    status: "active",
  },
];

// Helper function to format grade level for display
const formatGradeLevel = (gradeLevel: string) => {
  if (gradeLevel.startsWith("GRADE_")) {
    return gradeLevel.replace("GRADE_", "");
  }
  return gradeLevel;
};

type ViewMode = "list" | "sf8" | "sf9" | "sf10" | "bulk_sf9" | "bulk_sf10";

export default function SchoolForms() {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schoolYear, setSchoolYear] = useState("2026-2027");
  const [schoolYears, setSchoolYears] = useState<string[]>(["2026-2027"]);
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

  const { colors: themeColors, schoolName, schoolRegion, schoolDivision, logoUrl } = useTheme();
  const fullLogoUrl = logoUrl ? (logoUrl.startsWith("http") ? logoUrl : `${SERVER_URL}${logoUrl}`) : null;
  
  // Selection state
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  
  // Form data states
  const [sf8Data, setSf8Data] = useState<any>(null);
  const [sf9Data, setSf9Data] = useState<any>(null);
  const [sf10Data, setSf10Data] = useState<any>(null);
  const [bulkSf9Data, setBulkSf9Data] = useState<SF9Data[]>([]);
  const [bulkSf10Data, setBulkSf10Data] = useState<SF10Data[]>([]);
  const sf9PrintRef = useRef<HTMLDivElement | null>(null);
  const sf10PrintRef = useRef<HTMLDivElement | null>(null);
  const bulkPrintRef = useRef<HTMLDivElement | null>(null);


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

  const handleViewSF8 = async () => {
    if (!selectedSection) return;
    setLoading(true);
    try {
      const response = await registrarApi.getSF8(selectedSection, schoolYear);
      setSf8Data(response.data);
      setViewMode("sf8");
    } catch (error) {
      console.error("Error loading SF8:", error);
    } finally {
      setLoading(false);
    }
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

  const handleBack = () => {
    setViewMode("list");
    setSf8Data(null);
    setSf9Data(null);
    setSf10Data(null);
    setBulkSf9Data([]);
    setBulkSf10Data([]);
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

  // Render SF9 Content Helper
  const renderSF9Content = (data: SF9Data) => (
    <div className="bg-white border-2 border-gray-400 shadow-xl print-form print-form-sf9 p-8 mb-8">
      {/* Header with DepEd Logo */}
      <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-gray-400">
        <div className="w-20">
          <img src="/DepEd.png" alt="DepEd Logo" className="w-16 h-16 object-contain" />
        </div>
        <div className="flex-1 text-center">
          <p className="text-xs text-gray-700 mb-1">SF 9 - JHS</p>
          <h2 className="font-bold text-base text-gray-900">Republic of the Philippines</h2>
          <h3 className="font-bold text-sm text-gray-900">Department of Education</h3>
          <p className="text-sm text-gray-800 mt-1">{schoolRegion || "Region _____________"}</p>
          <p className="text-sm text-gray-800">{schoolDivision ? `Division of ${schoolDivision}` : "Division of _____________"}</p>
          <p className="text-sm text-gray-800 mt-1">District: _____________</p>
          <p className="text-sm text-gray-800">{schoolName ? `School: ${schoolName}` : "School: _____________"}</p>
        </div>
        <div className="w-20 flex items-center justify-center">
          {fullLogoUrl ? (
            <img src={fullLogoUrl} alt="School Logo" className="w-16 h-16 object-contain" />
          ) : (
            <img src="/DepEd.png" alt="DepEd Seal" className="w-16 h-16 object-contain" />
          )}
        </div>
      </div>

      {/* Title */}
      <div className="text-center mb-6">
        <h1 className="text-xl font-bold text-gray-900 uppercase">Learner's Progress Report Card</h1>
      </div>

      {/* Student Information */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-3 mb-6 text-sm">
        <div>
          <span className="font-bold text-gray-900">Name: </span>
          <span className="border-b border-gray-400 text-gray-900 inline-block min-w-[200px]">{data.student.name}</span>
        </div>
        <div>
          <span className="font-bold text-gray-900">LRN: </span>
          <span className="border-b border-gray-400 text-gray-900 font-mono inline-block min-w-[150px]">{data.student.lrn}</span>
        </div>
        <div>
          <span className="font-bold text-gray-900">Age: </span>
          <span className="border-b border-gray-400 text-gray-900 inline-block min-w-[80px]">{data.student.age || "____"}</span>
        </div>
        <div>
          <span className="font-bold text-gray-900">Sex: </span>
          <span className="border-b border-gray-400 text-gray-900 inline-block min-w-[80px]">{data.student.gender || "____"}</span>
        </div>
        <div>
          <span className="font-bold text-gray-900">Grade: </span>
          <span className="border-b border-gray-400 text-gray-900 inline-block min-w-[80px]">{formatGradeLevel(data.student.gradeLevel)}</span>
        </div>
        <div>
          <span className="font-bold text-gray-900">Section: </span>
          <span className="border-b border-gray-400 text-gray-900 inline-block min-w-[120px]">{data.student.section}</span>
        </div>
        <div className="col-span-2">
          <span className="font-bold text-gray-900">School Year: </span>
          <span className="border-b border-gray-400 text-gray-900 inline-block min-w-[120px]">{data.student.schoolYear}</span>
        </div>
      </div>

      {/* Dear Parent Message */}
      <div className="bg-gray-100 p-4 rounded mb-6 text-sm border border-gray-400">
        <p className="font-bold text-gray-900 mb-2">Dear Parent,</p>
        <p className="text-gray-800 text-justify leading-relaxed">
          This report card shows the ability and progress your child has made in different learning areas as well as his/her core values. 
          The school welcomes you should you desire to know more about your child's progress.
        </p>
      </div>

      {/* Report on Learning Progress and Achievement */}
      <div className="mb-6">
        <h3 className="font-bold text-sm mb-2 bg-gray-200 p-2 text-gray-900 border border-gray-400">REPORT ON LEARNING PROGRESS AND ACHIEVEMENT</h3>
        <table className="w-full border-2 border-gray-600 text-sm">
          <thead>
            <tr className="border-b-2 border-gray-600 bg-gray-100">
              <th rowSpan={2} className="border-r border-gray-600 p-2 text-left text-gray-900 w-44">Learning Areas</th>
              <th colSpan={3} className="border-r border-gray-600 p-2 text-gray-900">Term</th>
              <th rowSpan={2} className="border-r border-gray-600 p-2 text-gray-900 w-16">Final<br/>Rating</th>
              <th rowSpan={2} className="p-2 text-gray-900 w-20">Remarks</th>
            </tr>
            <tr className="border-b-2 border-gray-600 bg-gray-100">
              <th className="border-r border-gray-600 p-2 w-12 text-gray-900">1</th>
              <th className="border-r border-gray-600 p-2 w-12 text-gray-900">2</th>
              <th className="border-r border-gray-600 p-2 w-12 text-gray-900">3</th>
            </tr>
          </thead>
          <tbody>
            {data.subjectGrades.map((sg: any, index: number) => (
              <tr key={index} className="border-b border-gray-600">
                <td className="border-r border-gray-600 p-2 font-medium text-gray-900">{sg.subjectName}</td>
                <td className={`border-r border-gray-600 p-2 text-center font-semibold ${(sg.T1 ?? 0) < 75 && sg.T1 ? 'text-red-600' : 'text-gray-900'}`}>
                  {sg.T1 ?? ''}
                </td>
                <td className={`border-r border-gray-600 p-2 text-center font-semibold ${(sg.T2 ?? 0) < 75 && sg.T2 ? 'text-red-600' : 'text-gray-900'}`}>
                  {sg.T2 ?? ''}
                </td>
                <td className={`border-r border-gray-600 p-2 text-center font-semibold ${(sg.T3 ?? 0) < 75 && sg.T3 ? 'text-red-600' : 'text-gray-900'}`}>
                  {sg.T3 ?? ''}
                </td>
                <td className={`border-r border-gray-600 p-2 text-center font-bold ${(sg.final ?? 0) < 75 && sg.final ? 'text-red-600' : 'text-gray-900'}`}>
                  {sg.final ?? ''}
                </td>
                <td className="p-2 text-center text-sm text-gray-900">
                  {sg.remarks || ''}
                </td>
              </tr>
            ))}
            <tr className="bg-gray-200 font-bold border-t-2 border-gray-600">
              <td colSpan={4} className="border-r border-gray-600 p-2 text-right text-gray-900">General Average</td>
              <td className="border-r border-gray-600 p-2 text-center text-lg text-gray-900">
                {data.generalAverage?.toFixed(2) ?? ''}
              </td>
              <td className="p-2 text-center">
                {data.honors && <span className="text-amber-700 text-xs">{data.honors}</span>}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Grading Scale */}
        <div className="mt-4 text-xs">
          <table className="border border-gray-600">
            <thead>
              <tr className="bg-gray-200">
                <th className="border border-gray-600 p-1.5 text-gray-900">Descriptors</th>
                <th className="border border-gray-600 p-1.5 text-gray-900">Grading Scale</th>
                <th className="border border-gray-600 p-1.5 text-gray-900">Remarks</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="border border-gray-600 p-1.5 text-gray-900">Advancing</td><td className="border border-gray-600 p-1.5 text-center text-gray-900">90-100</td><td className="border border-gray-600 p-1.5 text-gray-900">Passed</td></tr>
              <tr><td className="border border-gray-600 p-1.5 text-gray-900">Benchmarking</td><td className="border border-gray-600 p-1.5 text-center text-gray-900">80-89</td><td className="border border-gray-600 p-1.5 text-gray-900">Passed</td></tr>
              <tr><td className="border border-gray-600 p-1.5 text-gray-900">Connecting</td><td className="border border-gray-600 p-1.5 text-center text-gray-900">75-79</td><td className="border border-gray-600 p-1.5 text-gray-900">Passed</td></tr>
              <tr><td className="border border-gray-600 p-1.5 text-gray-900">Developing</td><td className="border border-gray-600 p-1.5 text-center text-gray-900">65-74</td><td className="border border-gray-600 p-1.5 text-gray-900">Failed</td></tr>
              <tr><td className="border border-gray-600 p-1.5 text-gray-900">Emerging</td><td className="border border-gray-600 p-1.5 text-center text-gray-900">Below 65</td><td className="border border-gray-600 p-1.5 text-gray-900">Failed</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Page break: Core Values goes on back side (page 2) */}
      <div className="mb-6 sf9-page-break">
        <h3 className="font-bold text-sm mb-2 bg-gray-200 p-2 text-gray-900 border border-gray-400">REPORT ON LEARNER'S OBSERVED VALUES</h3>
        <table className="w-full border-2 border-gray-600 text-xs">
          <thead>
            <tr className="border-b-2 border-gray-600 bg-gray-100">
              <th className="border-r border-gray-600 p-2 text-gray-900 w-24">Core Values</th>
              <th className="border-r border-gray-600 p-2 text-gray-900">Behavior Statements</th>
              <th className="border-r border-gray-600 p-1.5 w-8 text-gray-900">1</th>
              <th className="border-r border-gray-600 p-1.5 w-8 text-gray-900">2</th>
              <th className="border-r border-gray-600 p-1.5 w-8 text-gray-900">3</th>
              <th className="p-1.5 w-8 text-gray-900">4</th>
            </tr>
          </thead>
          <tbody>
            {[
              { value: '1. Maka-Diyos', behaviors: ["Expresses one's spiritual beliefs while respecting others.", "Shows adherence to ethical principles by upholding truth."] },
              { value: '2. Makatao', behaviors: ["Is sensitive to individual, social, and cultural differences.", "Demonstrates contributions towards solidarity."] },
              { value: '3. Maka-Kalikasan', behaviors: ["Cares for environment and utilizes resources wisely."] },
              { value: '4. Maka-Bansa', behaviors: ["Demonstrates pride in being a Filipino.", "Demonstrates appropriate behavior in school and community."] }
            ].map((cv, i) => (
              <React.Fragment key={i}>
                {cv.behaviors.map((b, j) => (
                  <tr key={`${i}-${j}`} className="border-b border-gray-600">
                    {j === 0 && <td rowSpan={cv.behaviors.length} className="border-r border-gray-600 p-2 font-bold text-gray-900 align-top">{cv.value}</td>}
                    <td className="border-r border-gray-600 p-2 text-gray-800">{b}</td>
                    <td className="border-r border-gray-600 p-2"></td>
                    <td className="border-r border-gray-600 p-2"></td>
                    <td className="border-r border-gray-600 p-2"></td>
                    <td className="p-2"></td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        <div className="mt-2 text-xs text-gray-800">
          <strong>Marking:</strong> AO - Always Observed | SO - Sometimes Observed | RO - Rarely Observed | NO - Not Observed
        </div>
      </div>

      {/* Attendance Record */}
      <div className="mb-6">
        <h3 className="font-bold text-sm mb-2 bg-gray-200 p-2 text-gray-900 border border-gray-400">ATTENDANCE RECORD</h3>
        <table className="w-full border-2 border-gray-600 text-xs">
          <thead>
            <tr className="border-b border-gray-600 bg-gray-100">
              <th className="border-r border-gray-600 p-1.5 text-gray-900"></th>
              {['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'Total'].map(m => (
                <th key={m} className="border-r border-gray-600 p-1 text-gray-900 text-center">{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {['School Days', 'Days Present', 'Days Absent'].map(row => (
              <tr key={row} className="border-b border-gray-600">
                <td className="border-r border-gray-600 p-1.5 font-medium text-gray-900">{row}</td>
                {Array(12).fill('').map((_, i) => (
                  <td key={i} className="border-r border-gray-600 p-1.5 text-center"></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Parent/Guardian Signature */}
      <div className="mb-6 border-2 border-gray-600 p-4">
        <h3 className="font-bold text-sm mb-3 text-gray-900">PARENT / GUARDIAN'S SIGNATURE</h3>
        <div className="grid grid-cols-4 gap-4 text-xs">
          {['Term 1', 'Term 2', 'Term 3'].map(q => (
            <div key={q}>
              <p className="text-gray-900 mb-6">{q}</p>
              <div className="border-b border-gray-600"></div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer Signatures */}
      <div className="grid grid-cols-2 gap-8 mt-8 pt-4 border-t-2 border-gray-400">
        <div className="text-center">
          <div className="border-b border-gray-600 mx-8 mb-1 min-h-[2rem] flex items-end justify-center font-bold text-gray-900">
            {data.student.adviser || ""}
          </div>
          <p className="text-sm text-gray-900 font-medium">Class Adviser</p>
        </div>
        <div className="text-center">
          <div className="border-b border-gray-600 mx-8 mb-1 h-8"></div>
          <p className="text-sm text-gray-900 font-medium">School Principal</p>
        </div>
      </div>
    </div>
  );

  // Render SF10 Content Helper
  const renderSF10Content = (data: SF10Data) => (
    <div className="bg-white border-2 border-gray-400 shadow-xl print-form p-8 mb-8">
      {/* Header with DepEd Logo */}
      <div className="flex items-start justify-between mb-4 pb-4 border-b-2 border-gray-400">
        <div className="w-20">
          <img src="/DepEd.png" alt="DepEd Logo" className="w-16 h-16 object-contain" />
        </div>
        <div className="flex-1 text-center">
          <h2 className="font-bold text-base text-gray-900">Republic of the Philippines</h2>
          <h3 className="font-bold text-sm text-gray-900">Department of Education</h3>
          {schoolRegion && <p className="text-sm text-gray-800 mt-1">{schoolRegion}</p>}
          {schoolDivision && <p className="text-sm text-gray-800">Division of {schoolDivision}</p>}
          {schoolName && <p className="text-sm text-gray-800">{schoolName}</p>}
        </div>
        <div className="w-20 flex items-center justify-center">
          {fullLogoUrl ? (
            <img src={fullLogoUrl} alt="School Logo" className="w-16 h-16 object-contain" />
          ) : (
            <img src="/DepEd.png" alt="DepEd Seal" className="w-16 h-16 object-contain" />
          )}
        </div>
      </div>

      {/* Title */}
      <div className="text-center mb-4">
        <h1 className="text-lg font-bold text-gray-900 uppercase">Learner's Permanent Academic Record for Junior High School</h1>
        <p className="text-xs text-gray-700 mt-1">(Formerly Form 137)</p>
      </div>

      {/* Student's Personal Information */}
      <div className="mb-4 border-2 border-gray-600">
        <div className="bg-gray-200 p-1.5 border-b-2 border-gray-600">
          <h3 className="font-bold text-xs text-gray-900">LEARNER'S INFORMATION</h3>
        </div>
        <div className="p-3 text-xs">
          <div className="grid grid-cols-5 gap-3 mb-2">
            <div className="col-span-2">
              <label className="font-bold text-gray-900">LAST NAME:</label>
              <div className="border-b border-gray-600 mt-1 text-gray-900 pb-1">{data.student.name.split(',')[0]?.trim() || ''}</div>
            </div>
            <div className="col-span-2">
              <label className="font-bold text-gray-900">FIRST NAME:</label>
              <div className="border-b border-gray-600 mt-1 text-gray-900 pb-1">{data.student.name.split(',')[1]?.trim().split(' ')[0] || ''}</div>
            </div>
            <div>
              <label className="font-bold text-gray-900">MIDDLE NAME:</label>
              <div className="border-b border-gray-600 mt-1 text-gray-900 pb-1">{data.student.name.split(',')[1]?.trim().split(' ').slice(1).join(' ') || ''}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="font-bold text-gray-900">LRN:</label>
              <div className="border-b border-gray-600 mt-1 font-mono text-gray-900 pb-1">{data.student.lrn}</div>
            </div>
            <div>
              <label className="font-bold text-gray-900">BIRTHDATE:</label>
              <div className="border-b border-gray-600 mt-1 text-gray-900 pb-1">{data.student.birthDate || ''}</div>
            </div>
            <div>
              <label className="font-bold text-gray-900">SEX:</label>
              <div className="border-b border-gray-600 mt-1 text-gray-900 pb-1">{data.student.gender}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Eligibility for JHS Enrolment */}
      <div className="mb-4 border-2 border-gray-600">
        <div className="bg-gray-200 p-1.5 border-b-2 border-gray-600">
          <h3 className="font-bold text-xs text-gray-900">ELIGIBILITY FOR JHS ENROLMENT</h3>
        </div>
        <div className="p-2 text-xs grid grid-cols-3 gap-3">
          <div className="text-gray-900">
            <label>☐ Grade 6 Completion Certificate</label>
          </div>
          <div className="text-gray-900">
            <label>☐ Elementary SF10</label>
          </div>
          <div className="text-gray-900">
            <label>☐ PEPT Certificate</label>
          </div>
        </div>
      </div>

      {/* Academic Records */}
      {data.schoolRecords.map((record: any, recordIndex: number) => (
        <div key={recordIndex} className="mb-4 border-2 border-gray-600 page-break-inside-avoid">
          {/* School Year Header */}
          <div className="p-2 border-b-2 border-gray-600 bg-gray-100">
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="font-bold text-gray-900">School Year: </span>
                <span className="text-gray-900">{record.schoolYear}</span>
                <span className="font-bold text-gray-900 ml-4">Grade Level: </span>
                <span className="text-gray-900">{formatGradeLevel(record.gradeLevel)}</span>
              </div>
              <div>
                <span className="font-bold text-gray-900">Section: </span>
                <span className="text-gray-900">{record.section}</span>
              </div>
            </div>
          </div>

          {/* Scholastic Record Table */}
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b-2 border-gray-600 bg-gray-200">
                <th rowSpan={2} className="border-r border-gray-600 p-1.5 text-left text-gray-900">
                  LEARNING AREAS
                </th>
                <th colSpan={3} className="border-r border-gray-600 p-1.5 text-center text-gray-900">
                  Term Rating
                </th>
                <th rowSpan={2} className="border-r border-gray-600 p-1.5 text-center text-gray-900 w-16">
                  Final<br/>Rating
                </th>
                <th rowSpan={2} className="p-1.5 text-center text-gray-900 w-20">
                  Action<br/>Taken
                </th>
              </tr>
              <tr className="border-b-2 border-gray-600 bg-gray-200">
                <th className="border-r border-gray-600 p-1.5 w-12 text-center text-gray-900">1</th>
                <th className="border-r border-gray-600 p-1.5 w-12 text-center text-gray-900">2</th>
                <th className="border-r border-gray-600 p-1.5 w-12 text-center text-gray-900">3</th>
              </tr>
            </thead>
            <tbody>
              {record.subjectGrades.map((sg: any, idx: number) => (
                <tr key={idx} className="border-b border-gray-600">
                  <td className="border-r border-gray-600 p-1.5 text-gray-900">{sg.subjectName}</td>
                  <td className={`border-r border-gray-600 p-1.5 text-center font-medium ${(sg.T1 ?? 0) < 75 && sg.T1 ? 'text-red-600' : 'text-gray-900'}`}>
                    {sg.T1 ?? ''}
                  </td>
                  <td className={`border-r border-gray-600 p-1.5 text-center font-medium ${(sg.T2 ?? 0) < 75 && sg.T2 ? 'text-red-600' : 'text-gray-900'}`}>
                    {sg.T2 ?? ''}
                  </td>
                  <td className={`border-r border-gray-600 p-1.5 text-center font-medium ${(sg.T3 ?? 0) < 75 && sg.T3 ? 'text-red-600' : 'text-gray-900'}`}>
                    {sg.T3 ?? ''}
                  </td>
                  <td className={`border-r border-gray-600 p-1.5 text-center font-bold ${(sg.final ?? 0) < 75 && sg.final ? 'text-red-600' : 'text-gray-900'}`}>
                    {sg.final ?? ''}
                  </td>
                  <td className="p-1.5 text-center text-xs text-gray-900">{sg.remarks || ''}</td>
                </tr>
              ))}

              {/* General Average Row */}
              <tr className="border-t-2 border-gray-600 bg-gray-200 font-bold">
                <td colSpan={5} className="border-r border-gray-600 p-1.5 text-right text-gray-900">General Average:</td>
                <td className="border-r border-gray-600 p-1.5 text-center text-sm text-gray-900">
                  {record.generalAverage?.toFixed(2) ?? ''}
                </td>
                <td className="p-1.5"></td>
              </tr>
            </tbody>
          </table>

          {/* Remarks and Certification Section */}
          <div className="border-t-2 border-gray-600 p-2 bg-white">
            <div className="text-xs mb-2">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <span className="font-bold text-gray-900">Prepared by: </span>
                  <span className="text-gray-900">_________________________</span>
                </div>
                <div>
                  <span className="font-bold text-gray-900">Date: </span>
                  <span className="text-gray-900">_____________</span>
                </div>
              </div>
              <div className="text-xs text-gray-700 italic mt-1">Signature of Adviser over Printed Name</div>
            </div>
            
            <div className="border-t border-gray-400 pt-2 mt-2">
              <div className="flex items-center gap-3 text-xs">
                <span className="font-bold text-gray-900">Remarks:</span>
                <label className="flex items-center gap-1">
                  <input type="checkbox" className="w-3 h-3" />
                  <span className="text-gray-900">PROMOTED to Grade ____</span>
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" className="w-3 h-3" />
                  <span className="text-gray-900">NOT PROMOTED</span>
                </label>
              </div>
              {record.honors && (
                <div className="mt-1 text-xs">
                  <span className="font-bold text-gray-900">Award/Recognition: </span>
                  <span className="text-amber-700 font-semibold">{record.honors}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-6 mt-3 text-xs">
              <div className="text-center">
                <div className="border-b border-gray-600 mt-6 mx-8"></div>
                <p className="mt-0.5 text-gray-900">Signature of Adviser</p>
              </div>
              <div className="text-center">
                <div className="border-b border-gray-600 mt-6 mx-8"></div>
                <p className="mt-0.5 text-gray-900">Signature of Principal/School Head</p>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Footer Certification */}
      <div className="mt-4 pt-3 border-t-2 border-gray-600 text-xs">
        <p className="text-center text-gray-900 font-bold mb-2">CERTIFICATION</p>
        <p className="text-gray-700 italic text-center leading-relaxed">
          I CERTIFY that this is a true record of {data.student.name.split(',')[1]?.trim().split(' ')[0] || ''} {data.student.name.split(',')[0] || ''} 
          {' '}with LRN {data.student.lrn} and that he/she is eligible for admission to Grade ______.
        </p>
        <div className="grid grid-cols-2 gap-8 mt-4">
          <div className="text-center">
            <div className="border-b border-gray-600 mt-8 mx-12"></div>
            <p className="mt-1 text-xs text-gray-900">Date</p>
          </div>
          <div className="text-center">
            <div className="border-b border-gray-600 mt-8 mx-12"></div>
            <p className="mt-1 text-xs text-gray-900">School Head/Principal</p>
            <p className="text-xs text-gray-700">(Signature over Printed Name)</p>
          </div>
        </div>
      </div>

      {/* Official Seal */}
      <div className="text-center mt-4 text-xs text-gray-600 italic">
        <p>(School Seal)</p>
        <p className="mt-2">Not valid without official seal</p>
      </div>
    </div>
  );

  // Form List View
  if (viewMode === "list") {
    return (
      <div className="space-y-6 animate-fade-in">
        {/* Breadcrumb */}
        <Breadcrumb
          items={[
            { label: "Dashboard", href: "/registrar" },
            { label: "School Forms" },
          ]}
        />
        
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            DepEd School Forms
          </h1>
          <p className="text-gray-600 mt-1">
            Generate and view official Department of Education forms
          </p>
        </div>

        {/* Error Display */}
        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                  <FileText className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Error Loading Data</p>
                  <p className="text-sm text-gray-600">{error}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <Card className="border-0 shadow-lg rounded-2xl p-0">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="flex items-center gap-1 mb-2">
                  <label className="block text-sm font-medium text-gray-700">School Year</label>
                  <HelpTooltip content="Select the school year for which to generate forms" />
                </div>
                <Select value={schoolYear} onValueChange={(v: string | null) => v && setSchoolYear(v)}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {schoolYears.map((sy) => (
                      <SelectItem key={sy} value={sy}>{sy}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Grade Filter</label>
                <Select value={selectedGrade} onValueChange={(v: string | null) => {
                  if (v) {
                    setSelectedGrade(v);
                    setSelectedSection("");
                    setStudents([]);
                    setSelectedStudent("");
                  }
                }}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue>
                      {selectedGrade === "ALL" ? "All Grades" : `Grade ${formatGradeLevel(selectedGrade)}`}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Grades</SelectItem>
                    {uniqueGradeLevels.map((gl) => (
                      <SelectItem key={gl} value={gl}>
                        Grade {formatGradeLevel(gl)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Section Filter</label>
                <Select value={selectedSection} onValueChange={(v: string | null) => {
                  if (v) {
                    setSelectedSection(v);
                    setSelectedStudent("");
                  }
                }}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue>
                      {(() => {
                        const section = sections.find(s => s.id === selectedSection);
                        return section ? section.name : "Select section";
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {filteredSectionsForDropdown.map((section) => (
                      <SelectItem key={section.id} value={section.id}>
                        {selectedGrade === "ALL" ? `Grade ${formatGradeLevel(section.gradeLevel)} - ${section.name}` : section.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Forms Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {schoolForms.map((form, formIndex) => {
            const isDev = form.status === "dev";

            return (
              <Card 
                key={form.id} 
                className={`group border-0 shadow-lg shadow-gray-200/50 transition-all duration-300 bg-white overflow-hidden rounded-2xl p-0 ${isDev ? 'opacity-75 grayscale-[0.3]' : 'hover:shadow-xl'}`}
              >
                <CardHeader className="border-b border-gray-100 px-6 py-4" style={{ backgroundColor: isDev ? '#f8fafc' : `${themeColors.primary}08` }}>
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl text-white shadow-sm ${!isDev ? 'group-hover:scale-110 transition-transform shadow-lg' : ''}`} style={{ backgroundColor: isDev ? '#94a3b8' : themeColors.primary }}>
                      <form.icon className="w-5 h-5" />
                    </div>
                    <div className="flex flex-col flex-1">
                      <div className="flex items-center justify-between">
                        <Badge className="font-bold text-sm border border-transparent" style={{ backgroundColor: isDev ? '#f1f5f9' : `${themeColors.primary}15`, color: isDev ? '#64748b' : themeColors.primary }}>
                          {form.id}
                        </Badge>
                        {isDev && (
                          <Badge variant="outline" className="text-[10px] bg-slate-100 text-slate-500 border-slate-200 uppercase tracking-wider py-0 px-1.5 h-4">
                            In Dev
                          </Badge>
                        )}
                      </div>
                      <CardTitle className={`text-base font-bold mt-1 ${isDev ? 'text-slate-700' : 'text-gray-900'}`}>
                        {form.name}
                      </CardTitle>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6 flex flex-col h-full">
                  <p className={`text-sm mb-6 flex-1 ${isDev ? 'text-slate-500' : 'text-gray-600'}`}>
                    {form.description}
                  </p>
                  
                  <div className="flex mt-auto">
                    {(form.id === "SF9" || form.id === "SF10") && !isDev ? (
                      <Button
                        onClick={() => form.id === "SF9" ? handleViewSF9() : handleViewSF10()}
                        disabled={!selectedStudent}
                        className="rounded-xl w-full text-white"
                        style={{ backgroundColor: themeColors.primary }}
                        title={!selectedStudent ? "Select a student first" : undefined}
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        View
                      </Button>
                    ) : (
                      <Button
                        onClick={() => {
                          if (form.id === "SF8") handleViewSF8();
                          else if (form.id === "SF9") handleViewSF9();
                          else if (form.id === "SF10") handleViewSF10();
                        }}
                        disabled={
                          isDev ||
                          (form.id === "SF8" && !selectedSection) ||
                          ((form.id === "SF9" || form.id === "SF10") && !selectedStudent)
                        }
                        className="rounded-xl w-full"
                        variant={isDev ? "outline" : "default"}
                        style={!isDev ? { backgroundColor: themeColors.primary, color: 'white' } : {}}
                      >
                        {isDev ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin-slow opacity-50" />
                            Under Development
                          </>
                        ) : (
                          <>
                            <Eye className="w-4 h-4 mr-2" />
                            View Form
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Student List for Quick Access */}
        {selectedSection && students.length > 0 && (
          <Card className="border-0 shadow-lg rounded-2xl p-0">
            <CardHeader className="border-b px-6 py-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                {/* Left: title + selection badge */}
                <div className="flex items-center gap-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="w-4 h-4" style={{ color: themeColors.primary }} />
                    Students
                    <span className="text-sm font-normal text-gray-500">({filteredStudents.length})</span>
                  </CardTitle>
                  {selectedStudentIds.length > 0 && (
                    <span
                      className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
                      style={{ backgroundColor: `${themeColors.primary}15`, color: themeColors.primary }}
                    >
                      {selectedStudentIds.length} selected
                    </span>
                  )}
                </div>

                {/* Right: actions + search */}
                <div className="flex items-center gap-2">
                  {selectedStudentIds.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          className="rounded-xl h-9 text-white gap-1.5"
                          style={{ backgroundColor: themeColors.primary }}
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Print&nbsp;Selected
                          <ChevronRight className="w-3.5 h-3.5 rotate-90 opacity-70" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onClick={() => handleBulkPrint('sf9')}>
                          <FileText className="w-4 h-4 mr-2" />
                          SF9 — Report Cards
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleBulkPrint('sf10')}>
                          <FolderOpen className="w-4 h-4 mr-2" />
                          SF10 — Permanent Records
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="rounded-xl h-9 gap-1.5">
                        <Printer className="w-3.5 h-3.5" />
                        Print All
                        <ChevronRight className="w-3.5 h-3.5 rotate-90 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem onClick={() => handleBulkPrint('sf9', true)}>
                        <FileText className="w-4 h-4 mr-2" />
                        SF9 — Report Cards
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleBulkPrint('sf10', true)}>
                        <FolderOpen className="w-4 h-4 mr-2" />
                        SF10 — Permanent Records
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <div className="relative w-48">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <Input
                      placeholder="Search students…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 rounded-xl h-9 text-sm"
                    />
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50/80">
                    <TableHead className="w-10 pl-4">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-gray-300 cursor-pointer accent-primary"
                        checked={selectedStudentIds.length === filteredStudents.length && filteredStudents.length > 0}
                        onChange={handleToggleAll}
                        title="Select all"
                      />
                    </TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wide">LRN</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Gender</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStudents.map((student) => {
                    const isSelected = selectedStudentIds.includes(student.id);
                    return (
                    <TableRow
                      key={student.id}
                      className={`transition-colors cursor-pointer ${isSelected ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-gray-50'}`}
                      onClick={() => handleToggleStudent(student.id)}
                    >
                      <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-gray-300 cursor-pointer accent-primary"
                          checked={isSelected}
                          onChange={() => handleToggleStudent(student.id)}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm text-gray-600">{student.lrn}</TableCell>
                      <TableCell>
                        <span className={`font-medium ${isSelected ? 'text-primary' : 'text-gray-900'}`}>
                          {student.lastName}, {student.firstName} {student.middleName || ""} {student.suffix || ""}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-xs ${(student.gender ?? "").toLowerCase() === "male" ? "border-blue-200 text-blue-600 bg-blue-50" : "border-pink-200 text-pink-600 bg-pink-50"}`}
                        >
                          {student.gender}
                        </Badge>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg hover:bg-gray-100">
                              <MoreVertical className="w-4 h-4 text-gray-400" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => handleViewSF9(student.id)} className="gap-2">
                              <FileText className="w-4 h-4 text-blue-500" />
                              <span>View SF9</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleViewSF10(student.id)} className="gap-2">
                              <FolderOpen className="w-4 h-4 text-green-500" />
                              <span>View SF10</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )})}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // SF8 View - Health and Nutrition Form
  if (viewMode === "sf8" && sf8Data) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={handleBack} className="rounded-xl">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </div>

        <Card className="border-0 shadow-lg rounded-2xl p-0">
          <CardContent className="p-12">
            <div className="text-center">
              <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: `${themeColors.primary}15` }}>
                <BookOpen className="w-10 h-10" style={{ color: themeColors.primary }} />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">SF8 - School Health and Nutrition Form</h2>
              <p className="text-gray-600 mb-6">
                This form is currently not available. The SF8 health and nutrition records will be implemented in a future update.
              </p>
              <div className="rounded-xl p-4 text-sm text-left max-w-md mx-auto border" style={{ backgroundColor: `${themeColors.primary}10`, borderColor: `${themeColors.primary}30` }}>
                <p className="font-medium mb-2" style={{ color: themeColors.primary }}>What is SF8?</p>
                <p style={{ color: `${themeColors.primary}bb` }}>
                  SF8 (School Form 8) is the School Health and Nutrition Form that records student health information, 
                  immunizations, medical history, nutritional status, and health-related interventions.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (viewMode === "bulk_sf9" && bulkSf9Data.length > 0) {
    return (
      <div className="space-y-6 animate-fade-in max-w-[860px] mx-auto">
        <div className="flex items-center justify-between print-hide">
          <Button variant="ghost" onClick={handleBack} className="rounded-xl">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <Button onClick={() => executePrint(bulkPrintRef, "bulk-sf9-print-style")} className="rounded-xl text-white" style={{ backgroundColor: themeColors.primary }}>
            <Printer className="w-4 h-4 mr-2" />
            Print {bulkSf9Data.length} SF9 Forms
          </Button>
        </div>

        <div ref={bulkPrintRef}>
          {bulkSf9Data.map((item, idx) => (
            <div key={`${item.student.lrn}-${idx}`}>{renderSF9Content(item)}</div>
          ))}
        </div>
      </div>
    );
  }

  if (viewMode === "bulk_sf10" && bulkSf10Data.length > 0) {
    return (
      <div className="space-y-6 animate-fade-in max-w-[900px] mx-auto">
        <div className="flex items-center justify-between print-hide">
          <Button variant="ghost" onClick={handleBack} className="rounded-xl">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <Button onClick={() => executePrint(bulkPrintRef, "bulk-sf10-print-style")} className="rounded-xl text-white" style={{ backgroundColor: themeColors.primary }}>
            <Printer className="w-4 h-4 mr-2" />
            Print {bulkSf10Data.length} SF10 Forms
          </Button>
        </div>

        <div ref={bulkPrintRef}>
          {bulkSf10Data.map((item, idx) => (
            <div key={`${item.student.lrn}-${idx}`}>{renderSF10Content(item)}</div>
          ))}
        </div>
      </div>
    );
  }

  // SF9 View - Report Card (DepEd Official Format)
  if (viewMode === "sf9" && sf9Data) {
    const handlePrint = () => executePrint(sf9PrintRef, "sf9-print-style");

    return (
      <div className="space-y-6 animate-fade-in max-w-[860px] mx-auto">
        {/* Action Buttons - Hidden when printing */}
        <div className="flex items-center justify-between print-hide">
          <Button variant="ghost" onClick={handleBack} className="rounded-xl">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div className="flex gap-2">
            <Button onClick={handlePrint} className="rounded-xl text-white" style={{ backgroundColor: themeColors.primary }}>
              <Printer className="w-4 h-4 mr-2" />
              Print Form
            </Button>
          </div>
        </div>

        {/* SF9 Form - Official DepEd Format */}
        <div ref={sf9PrintRef} className="bg-white border-2 border-gray-400 shadow-xl print-form print-form-sf9 p-8">
          {/* Header with DepEd Logo */}
          <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-gray-400">
            <div className="w-20">
              <img src="/DepEd.png" alt="DepEd Logo" className="w-16 h-16 object-contain" />
            </div>
            <div className="flex-1 text-center">
              <p className="text-xs text-gray-700 mb-1">SF 9 - JHS</p>
              <h2 className="font-bold text-base text-gray-900">Republic of the Philippines</h2>
              <h3 className="font-bold text-sm text-gray-900">Department of Education</h3>
              <p className="text-sm text-gray-800 mt-1">{schoolRegion || "Region _____________"}</p>
              <p className="text-sm text-gray-800">{schoolDivision ? `Division of ${schoolDivision}` : "Division of _____________"}</p>
              <p className="text-sm text-gray-800 mt-1">District: _____________</p>
              <p className="text-sm text-gray-800">{schoolName ? `School: ${schoolName}` : "School: _____________"}</p>
            </div>
            <div className="w-20 flex items-center justify-center">
              {fullLogoUrl ? (
                <img src={fullLogoUrl} alt="School Logo" className="w-16 h-16 object-contain" />
              ) : (
                <img src="/DepEd.png" alt="DepEd Seal" className="w-16 h-16 object-contain" />
              )}
            </div>
          </div>

          {/* Title */}
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-gray-900 uppercase">Learner's Progress Report Card</h1>
          </div>

          {/* Student Information */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 mb-6 text-sm">
            <div>
              <span className="font-bold text-gray-900">Name: </span>
              <span className="border-b border-gray-400 text-gray-900 inline-block min-w-[200px]">{sf9Data.student.name}</span>
            </div>
            <div>
              <span className="font-bold text-gray-900">LRN: </span>
              <span className="border-b border-gray-400 text-gray-900 font-mono inline-block min-w-[150px]">{sf9Data.student.lrn}</span>
            </div>
            <div>
              <span className="font-bold text-gray-900">Age: </span>
              <span className="border-b border-gray-400 text-gray-900 inline-block min-w-[80px]">{sf9Data.student.age || "____"}</span>
            </div>
            <div>
              <span className="font-bold text-gray-900">Sex: </span>
              <span className="border-b border-gray-400 text-gray-900 inline-block min-w-[80px]">{sf9Data.student.gender || "____"}</span>
            </div>
            <div>
              <span className="font-bold text-gray-900">Grade: </span>
              <span className="border-b border-gray-400 text-gray-900 inline-block min-w-[80px]">{formatGradeLevel(sf9Data.student.gradeLevel)}</span>
            </div>
            <div>
              <span className="font-bold text-gray-900">Section: </span>
              <span className="border-b border-gray-400 text-gray-900 inline-block min-w-[120px]">{sf9Data.student.section}</span>
            </div>
            <div className="col-span-2">
              <span className="font-bold text-gray-900">School Year: </span>
              <span className="border-b border-gray-400 text-gray-900 inline-block min-w-[120px]">{sf9Data.student.schoolYear}</span>
            </div>
          </div>

          {/* Dear Parent Message */}
          <div className="bg-gray-100 p-4 rounded mb-6 text-sm border border-gray-400">
            <p className="font-bold text-gray-900 mb-2">Dear Parent,</p>
            <p className="text-gray-800 text-justify leading-relaxed">
              This report card shows the ability and progress your child has made in different learning areas as well as his/her core values. 
              The school welcomes you should you desire to know more about your child's progress.
            </p>
          </div>

          {/* Report on Learning Progress and Achievement */}
          <div className="mb-6">
            <h3 className="font-bold text-sm mb-2 bg-gray-200 p-2 text-gray-900 border border-gray-400">REPORT ON LEARNING PROGRESS AND ACHIEVEMENT</h3>
            <table className="w-full border-2 border-gray-600 text-sm">
              <thead>
                <tr className="border-b-2 border-gray-600 bg-gray-100">
                  <th rowSpan={2} className="border-r border-gray-600 p-2 text-left text-gray-900 w-44">Learning Areas</th>
                  <th colSpan={3} className="border-r border-gray-600 p-2 text-gray-900">Term</th>
                  <th rowSpan={2} className="border-r border-gray-600 p-2 text-gray-900 w-16">Final<br/>Rating</th>
                  <th rowSpan={2} className="p-2 text-gray-900 w-20">Remarks</th>
                </tr>
                <tr className="border-b-2 border-gray-600 bg-gray-100">
                  <th className="border-r border-gray-600 p-2 w-12 text-gray-900">1</th>
                  <th className="border-r border-gray-600 p-2 w-12 text-gray-900">2</th>
                  <th className="border-r border-gray-600 p-2 w-12 text-gray-900">3</th>
                </tr>
              </thead>
              <tbody>
                {sf9Data.subjectGrades.map((sg: any, index: number) => (
                  <tr key={index} className="border-b border-gray-600">
                    <td className="border-r border-gray-600 p-2 font-medium text-gray-900">{sg.subjectName}</td>
                    <td className={`border-r border-gray-600 p-2 text-center font-semibold ${(sg.T1 ?? 0) < 75 && sg.T1 ? 'text-red-600' : 'text-gray-900'}`}>
                      {sg.T1 ?? ''}
                    </td>
                    <td className={`border-r border-gray-600 p-2 text-center font-semibold ${(sg.T2 ?? 0) < 75 && sg.T2 ? 'text-red-600' : 'text-gray-900'}`}>
                      {sg.T2 ?? ''}
                    </td>
                    <td className={`border-r border-gray-600 p-2 text-center font-semibold ${(sg.T3 ?? 0) < 75 && sg.T3 ? 'text-red-600' : 'text-gray-900'}`}>
                      {sg.T3 ?? ''}
                    </td>
                    <td className={`border-r border-gray-600 p-2 text-center font-bold ${(sg.final ?? 0) < 75 && sg.final ? 'text-red-600' : 'text-gray-900'}`}>
                      {sg.final ?? ''}
                    </td>
                    <td className="p-2 text-center text-sm text-gray-900">
                      {sg.remarks || ''}
                    </td>
                  </tr>
                ))}
                <tr className="bg-gray-200 font-bold border-t-2 border-gray-600">
                  <td colSpan={4} className="border-r border-gray-600 p-2 text-right text-gray-900">General Average</td>
                  <td className="border-r border-gray-600 p-2 text-center text-lg text-gray-900">
                    {sf9Data.generalAverage?.toFixed(2) ?? ''}
                  </td>
                  <td className="p-2 text-center">
                    {sf9Data.honors && <span className="text-amber-700 text-xs">{sf9Data.honors}</span>}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Grading Scale */}
            <div className="mt-4 text-xs">
              <table className="border border-gray-600">
                <thead>
                  <tr className="bg-gray-200">
                    <th className="border border-gray-600 p-1.5 text-gray-900">Descriptors</th>
                    <th className="border border-gray-600 p-1.5 text-gray-900">Grading Scale</th>
                    <th className="border border-gray-600 p-1.5 text-gray-900">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td className="border border-gray-600 p-1.5 text-gray-900">Advancing</td><td className="border border-gray-600 p-1.5 text-center text-gray-900">90-100</td><td className="border border-gray-600 p-1.5 text-gray-900">Passed</td></tr>
                  <tr><td className="border border-gray-600 p-1.5 text-gray-900">Benchmarking</td><td className="border border-gray-600 p-1.5 text-center text-gray-900">80-89</td><td className="border border-gray-600 p-1.5 text-gray-900">Passed</td></tr>
                  <tr><td className="border border-gray-600 p-1.5 text-gray-900">Connecting</td><td className="border border-gray-600 p-1.5 text-center text-gray-900">75-79</td><td className="border border-gray-600 p-1.5 text-gray-900">Passed</td></tr>
                  <tr><td className="border border-gray-600 p-1.5 text-gray-900">Developing</td><td className="border border-gray-600 p-1.5 text-center text-gray-900">65-74</td><td className="border border-gray-600 p-1.5 text-gray-900">Failed</td></tr>
                  <tr><td className="border border-gray-600 p-1.5 text-gray-900">Emerging</td><td className="border border-gray-600 p-1.5 text-center text-gray-900">Below 65</td><td className="border border-gray-600 p-1.5 text-gray-900">Failed</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Page break: Core Values goes on back side (page 2) */}
          <div className="mb-6 sf9-page-break">
            <h3 className="font-bold text-sm mb-2 bg-gray-200 p-2 text-gray-900 border border-gray-400">REPORT ON LEARNER'S OBSERVED VALUES</h3>
            <table className="w-full border-2 border-gray-600 text-xs">
              <thead>
                <tr className="border-b-2 border-gray-600 bg-gray-100">
                  <th className="border-r border-gray-600 p-2 text-gray-900 w-24">Core Values</th>
                  <th className="border-r border-gray-600 p-2 text-gray-900">Behavior Statements</th>
                  <th className="border-r border-gray-600 p-1.5 w-8 text-gray-900">1</th>
                  <th className="border-r border-gray-600 p-1.5 w-8 text-gray-900">2</th>
                  <th className="border-r border-gray-600 p-1.5 w-8 text-gray-900">3</th>
                  <th className="p-1.5 w-8 text-gray-900">4</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { value: '1. Maka-Diyos', behaviors: ["Expresses one's spiritual beliefs while respecting others.", "Shows adherence to ethical principles by upholding truth."] },
                  { value: '2. Makatao', behaviors: ["Is sensitive to individual, social, and cultural differences.", "Demonstrates contributions towards solidarity."] },
                  { value: '3. Maka-Kalikasan', behaviors: ["Cares for environment and utilizes resources wisely."] },
                  { value: '4. Maka-Bansa', behaviors: ["Demonstrates pride in being a Filipino.", "Demonstrates appropriate behavior in school and community."] }
                ].map((cv, i) => (
                  <React.Fragment key={i}>
                    {cv.behaviors.map((b, j) => (
                      <tr key={`${i}-${j}`} className="border-b border-gray-600">
                        {j === 0 && <td rowSpan={cv.behaviors.length} className="border-r border-gray-600 p-2 font-bold text-gray-900 align-top">{cv.value}</td>}
                        <td className="border-r border-gray-600 p-2 text-gray-800">{b}</td>
                        <td className="border-r border-gray-600 p-2"></td>
                        <td className="border-r border-gray-600 p-2"></td>
                        <td className="border-r border-gray-600 p-2"></td>
                        <td className="p-2"></td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            <div className="mt-2 text-xs text-gray-800">
              <strong>Marking:</strong> AO - Always Observed | SO - Sometimes Observed | RO - Rarely Observed | NO - Not Observed
            </div>
          </div>

          {/* Attendance Record */}
          <div className="mb-6">
            <h3 className="font-bold text-sm mb-2 bg-gray-200 p-2 text-gray-900 border border-gray-400">ATTENDANCE RECORD</h3>
            <table className="w-full border-2 border-gray-600 text-xs">
              <thead>
                <tr className="border-b border-gray-600 bg-gray-100">
                  <th className="border-r border-gray-600 p-1.5 text-gray-900"></th>
                  {['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'Total'].map(m => (
                    <th key={m} className="border-r border-gray-600 p-1 text-gray-900 text-center">{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {['School Days', 'Days Present', 'Days Absent'].map(row => (
                  <tr key={row} className="border-b border-gray-600">
                    <td className="border-r border-gray-600 p-1.5 font-medium text-gray-900">{row}</td>
                    {Array(12).fill('').map((_, i) => (
                      <td key={i} className="border-r border-gray-600 p-1.5 text-center"></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Parent/Guardian Signature */}
          <div className="mb-6 border-2 border-gray-600 p-4">
            <h3 className="font-bold text-sm mb-3 text-gray-900">PARENT / GUARDIAN'S SIGNATURE</h3>
            <div className="grid grid-cols-4 gap-4 text-xs">
              {['Term 1', 'Term 2', 'Term 3'].map(q => (
                <div key={q}>
                  <p className="text-gray-900 mb-6">{q}</p>
                  <div className="border-b border-gray-600"></div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer Signatures */}
          <div className="grid grid-cols-2 gap-8 mt-8 pt-4 border-t-2 border-gray-400">
            <div className="text-center">
              <div className="border-b border-gray-600 mx-8 mb-1 min-h-[2rem] flex items-end justify-center font-bold text-gray-900">
                {sf9Data.student.adviser || ""}
              </div>
              <p className="text-sm text-gray-900 font-medium">Class Adviser</p>
            </div>
            <div className="text-center">
              <div className="border-b border-gray-600 mx-8 mb-1 h-8"></div>
              <p className="text-sm text-gray-900 font-medium">School Principal</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // SF10 View - Permanent Record (DepEd Official Format)
  if (viewMode === "sf10" && sf10Data) {
    const handlePrint = () => executePrint(sf10PrintRef, "sf10-print-style");

    return (
      <div className="space-y-6 animate-fade-in max-w-[900px] mx-auto">
        {/* Action Buttons - Hidden when printing */}
        <div className="flex items-center justify-between print-hide">
          <Button variant="ghost" onClick={handleBack} className="rounded-xl">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div className="flex gap-2">
            <Button onClick={handlePrint} className="rounded-xl text-white" style={{ backgroundColor: themeColors.primary }}>
              <Printer className="w-4 h-4 mr-2" />
              Print Form
            </Button>
          </div>
        </div>

        {/* SF10 Form - Official DepEd Format */}
        <div ref={sf10PrintRef} className="bg-white border-2 border-gray-400 shadow-xl print-form p-8">
          {/* Header with DepEd Logo */}
          <div className="flex items-start justify-between mb-4 pb-4 border-b-2 border-gray-400">
            <div className="w-20">
              <img src="/DepEd.png" alt="DepEd Logo" className="w-16 h-16 object-contain" />
            </div>
            <div className="flex-1 text-center">
              <h2 className="font-bold text-base text-gray-900">Republic of the Philippines</h2>
              <h3 className="font-bold text-sm text-gray-900">Department of Education</h3>
              {schoolRegion && <p className="text-sm text-gray-800 mt-1">{schoolRegion}</p>}
              {schoolDivision && <p className="text-sm text-gray-800">Division of {schoolDivision}</p>}
              {schoolName && <p className="text-sm text-gray-800">{schoolName}</p>}
            </div>
            <div className="w-20 flex items-center justify-center">
              {fullLogoUrl ? (
                <img src={fullLogoUrl} alt="School Logo" className="w-16 h-16 object-contain" />
              ) : (
                <img src="/DepEd.png" alt="DepEd Seal" className="w-16 h-16 object-contain" />
              )}
            </div>
          </div>

          {/* Title */}
          <div className="text-center mb-4">
            <h1 className="text-lg font-bold text-gray-900 uppercase">Learner's Permanent Academic Record for Junior High School</h1>
            <p className="text-xs text-gray-700 mt-1">(Formerly Form 137)</p>
          </div>

          {/* Student's Personal Information */}
          <div className="mb-4 border-2 border-gray-600">
            <div className="bg-gray-200 p-1.5 border-b-2 border-gray-600">
              <h3 className="font-bold text-xs text-gray-900">LEARNER'S INFORMATION</h3>
            </div>
            <div className="p-3 text-xs">
              <div className="grid grid-cols-5 gap-3 mb-2">
                <div className="col-span-2">
                  <label className="font-bold text-gray-900">LAST NAME:</label>
                  <div className="border-b border-gray-600 mt-1 text-gray-900 pb-1">{sf10Data.student.name.split(',')[0]?.trim() || ''}</div>
                </div>
                <div className="col-span-2">
                  <label className="font-bold text-gray-900">FIRST NAME:</label>
                  <div className="border-b border-gray-600 mt-1 text-gray-900 pb-1">{sf10Data.student.name.split(',')[1]?.trim().split(' ')[0] || ''}</div>
                </div>
                <div>
                  <label className="font-bold text-gray-900">MIDDLE NAME:</label>
                  <div className="border-b border-gray-600 mt-1 text-gray-900 pb-1">{sf10Data.student.name.split(',')[1]?.trim().split(' ').slice(1).join(' ') || ''}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-bold text-gray-900">LRN:</label>
                  <div className="border-b border-gray-600 mt-1 font-mono text-gray-900 pb-1">{sf10Data.student.lrn}</div>
                </div>
                <div>
                  <label className="font-bold text-gray-900">BIRTHDATE:</label>
                  <div className="border-b border-gray-600 mt-1 text-gray-900 pb-1">{sf10Data.student.birthDate || ''}</div>
                </div>
                <div>
                  <label className="font-bold text-gray-900">SEX:</label>
                  <div className="border-b border-gray-600 mt-1 text-gray-900 pb-1">{sf10Data.student.gender}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Eligibility for JHS Enrolment */}
          <div className="mb-4 border-2 border-gray-600">
            <div className="bg-gray-200 p-1.5 border-b-2 border-gray-600">
              <h3 className="font-bold text-xs text-gray-900">ELIGIBILITY FOR JHS ENROLMENT</h3>
            </div>
            <div className="p-2 text-xs grid grid-cols-3 gap-3">
              <div className="text-gray-900">
                <label>☐ Grade 6 Completion Certificate</label>
              </div>
              <div className="text-gray-900">
                <label>☐ Elementary SF10</label>
              </div>
              <div className="text-gray-900">
                <label>☐ PEPT Certificate</label>
              </div>
            </div>
          </div>

          {/* Academic Records */}
          {sf10Data.schoolRecords.map((record: any, recordIndex: number) => (
            <div key={recordIndex} className="mb-4 border-2 border-gray-600 page-break-inside-avoid">
              {/* School Year Header */}
              <div className="p-2 border-b-2 border-gray-600 bg-gray-100">
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="font-bold text-gray-900">School Year: </span>
                    <span className="text-gray-900">{record.schoolYear}</span>
                    <span className="font-bold text-gray-900 ml-4">Grade Level: </span>
                    <span className="text-gray-900">{formatGradeLevel(record.gradeLevel)}</span>
                  </div>
                  <div>
                    <span className="font-bold text-gray-900">Section: </span>
                    <span className="text-gray-900">{record.section}</span>
                  </div>
                </div>
              </div>

              {/* Scholastic Record Table */}
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b-2 border-gray-600 bg-gray-200">
                    <th rowSpan={2} className="border-r border-gray-600 p-1.5 text-left text-gray-900">
                      LEARNING AREAS
                    </th>
                    <th colSpan={3} className="border-r border-gray-600 p-1.5 text-center text-gray-900">
                      Term Rating
                    </th>
                    <th rowSpan={2} className="border-r border-gray-600 p-1.5 text-center text-gray-900 w-16">
                      Final<br/>Rating
                    </th>
                    <th rowSpan={2} className="p-1.5 text-center text-gray-900 w-20">
                      Action<br/>Taken
                    </th>
                  </tr>
                  <tr className="border-b-2 border-gray-600 bg-gray-200">
                    <th className="border-r border-gray-600 p-1.5 w-12 text-center text-gray-900">1</th>
                    <th className="border-r border-gray-600 p-1.5 w-12 text-center text-gray-900">2</th>
                    <th className="border-r border-gray-600 p-1.5 w-12 text-center text-gray-900">3</th>
                  </tr>
                </thead>
                <tbody>
                  {record.subjectGrades.map((sg: any, idx: number) => (
                    <tr key={idx} className="border-b border-gray-600">
                      <td className="border-r border-gray-600 p-1.5 text-gray-900">{sg.subjectName}</td>
                      <td className={`border-r border-gray-600 p-1.5 text-center font-medium ${(sg.T1 ?? 0) < 75 && sg.T1 ? 'text-red-600' : 'text-gray-900'}`}>
                        {sg.T1 ?? ''}
                      </td>
                      <td className={`border-r border-gray-600 p-1.5 text-center font-medium ${(sg.T2 ?? 0) < 75 && sg.T2 ? 'text-red-600' : 'text-gray-900'}`}>
                        {sg.T2 ?? ''}
                      </td>
                      <td className={`border-r border-gray-600 p-1.5 text-center font-medium ${(sg.T3 ?? 0) < 75 && sg.T3 ? 'text-red-600' : 'text-gray-900'}`}>
                        {sg.T3 ?? ''}
                      </td>
                      <td className={`border-r border-gray-600 p-1.5 text-center font-bold ${(sg.final ?? 0) < 75 && sg.final ? 'text-red-600' : 'text-gray-900'}`}>
                        {sg.final ?? ''}
                      </td>
                      <td className="p-1.5 text-center text-xs text-gray-900">{sg.remarks || ''}</td>
                    </tr>
                  ))}

                  {/* General Average Row */}
                  <tr className="border-t-2 border-gray-600 bg-gray-200 font-bold">
                    <td colSpan={5} className="border-r border-gray-600 p-1.5 text-right text-gray-900">General Average:</td>
                    <td className="border-r border-gray-600 p-1.5 text-center text-sm text-gray-900">
                      {record.generalAverage?.toFixed(2) ?? ''}
                    </td>
                    <td className="p-1.5"></td>
                  </tr>
                </tbody>
              </table>

              {/* Remarks and Certification Section */}
              <div className="border-t-2 border-gray-600 p-2 bg-white">
                <div className="text-xs mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <span className="font-bold text-gray-900">Prepared by: </span>
                      <span className="text-gray-900">_________________________</span>
                    </div>
                    <div>
                      <span className="font-bold text-gray-900">Date: </span>
                      <span className="text-gray-900">_____________</span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-700 italic mt-1">Signature of Adviser over Printed Name</div>
                </div>
                
                <div className="border-t border-gray-400 pt-2 mt-2">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-bold text-gray-900">Remarks:</span>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" className="w-3 h-3" />
                      <span className="text-gray-900">PROMOTED to Grade ____</span>
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" className="w-3 h-3" />
                      <span className="text-gray-900">NOT PROMOTED</span>
                    </label>
                  </div>
                  {record.honors && (
                    <div className="mt-1 text-xs">
                      <span className="font-bold text-gray-900">Award/Recognition: </span>
                      <span className="text-amber-700 font-semibold">{record.honors}</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-6 mt-3 text-xs">
                  <div className="text-center">
                    <div className="border-b border-gray-600 mt-6 mx-8"></div>
                    <p className="mt-0.5 text-gray-900">Signature of Adviser</p>
                  </div>
                  <div className="text-center">
                    <div className="border-b border-gray-600 mt-6 mx-8"></div>
                    <p className="mt-0.5 text-gray-900">Signature of Principal/School Head</p>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Footer Certification */}
          <div className="mt-4 pt-3 border-t-2 border-gray-600 text-xs">
            <p className="text-center text-gray-900 font-bold mb-2">CERTIFICATION</p>
            <p className="text-gray-700 italic text-center leading-relaxed">
              I CERTIFY that this is a true record of {sf10Data.student.name.split(',')[1]?.trim().split(' ')[0] || ''} {sf10Data.student.name.split(',')[0] || ''} 
              {' '}with LRN {sf10Data.student.lrn} and that he/she is eligible for admission to Grade ______.
            </p>
            <div className="grid grid-cols-2 gap-8 mt-4">
              <div className="text-center">
                <div className="border-b border-gray-600 mt-8 mx-12"></div>
                <p className="mt-1 text-xs text-gray-900">Date</p>
              </div>
              <div className="text-center">
                <div className="border-b border-gray-600 mt-8 mx-12"></div>
                <p className="mt-1 text-xs text-gray-900">School Head/Principal</p>
                <p className="text-xs text-gray-700">(Signature over Printed Name)</p>
              </div>
            </div>
          </div>

          {/* Official Seal */}
          <div className="text-center mt-4 text-xs text-gray-600 italic">
            <p>(School Seal)</p>
            <p className="mt-2">Not valid without official seal</p>
          </div>
        </div>
      </div>
    );
  }

  // Loading or fallback
  return (
    <div className="flex items-center justify-center h-64">
      <p className="text-gray-500">Loading...</p>
    </div>
  );
}
