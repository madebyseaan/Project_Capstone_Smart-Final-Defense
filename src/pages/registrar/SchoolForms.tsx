import React, { useState, useEffect, useRef } from "react";
import {
  FolderOpen,
  FileText,
  Users,
  Clock,
  CheckCircle2,
  Printer,
  Eye,
  Search,
  ArrowLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  MoreVertical,
  PrinterIcon,
  Download
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
import api, { registrarApi, type Section, SERVER_URL, type SF9Data, type SF10Data, type SF1Data, type SF5Data } from "@/lib/api";

import { HelpTooltip } from "@/components/ui/tooltip";
import { useTheme } from "@/contexts/ThemeContext";
import SF5Form from "./components/SF5Form";

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
    status: "active",
  },
  {
    id: "SF2",
    name: "Daily Attendance",
    fullName: "School Form 2 - Daily Attendance Report",
    description: "Daily attendance tracking.",
    icon: Clock,
    color: "gray",
    status: "active",
  },
  {
    id: "SF5",
    name: "Promotion Report",
    fullName: "School Form 5 - Report on Promotion",
    description: "Final academic performance.",
    icon: CheckCircle2,
    color: "gray",
    status: "active",
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
  {
    id: "SF6",
    name: "Summary Promotion",
    fullName: "School Form 6 - Summary Promotion Report",
    description: "School-wide promotion statistics.",
    icon: FileText,
    color: "purple",
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

type ViewMode = "list" | "sf1" | "sf2" | "sf5" | "sf6" | "sf9" | "sf10" | "bulk_sf9" | "bulk_sf10";

export default function SchoolForms() {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [loading, setLoading] = useState(false);
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

  const { colors: themeColors, schoolName, schoolRegion, schoolDivision, logoUrl } = useTheme();
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

  // DepEd JHS learning area sort order (lower = higher priority)
  const DEPED_AREA_ORDER: Record<string, number> = {
    FIL: 1, ENG: 2, MATH: 3, SCI: 4, AP: 5, ESP: 6, TLE: 7, MAPEH: 8,
    DEVL_READING: 9,
    SPA_SPEC: 10, SPS_SPEC: 11,
    STE_RESEARCH: 12, STE_ENV_SCI: 13, STE_BIOTECH: 14,
    STE_APPLIED_CHEM: 15, STE_APPLIED_PHYS: 16, STE_ROBOTICS: 17,
  };

  // Display names for SF10 learning areas
  const DEPED_AREA_NAMES: Record<string, string> = {
    FIL: 'Filipino', ENG: 'English', MATH: 'Mathematics', SCI: 'Science',
    AP: 'Araling Panlipunan (AP)', ESP: 'Edukasyon sa Pagpapakatao (EsP)',
    TLE: 'Technology and Livelihood Education (TLE)',
    MAPEH: 'MAPEH',
    DEVL_READING: 'Developmental Reading',
    SPA_SPEC: 'Special Program in the Arts: Specialization',
    SPS_SPEC: 'Special Program in Sports: Specialization',
    STE_RESEARCH: 'Research', STE_ENV_SCI: 'Environmental Science',
    STE_BIOTECH: 'Biotechnology', STE_APPLIED_CHEM: 'Applied Chemistry',
    STE_APPLIED_PHYS: 'Applied Physics', STE_ROBOTICS: 'Robotics',
  };

  // Map individual ATLAS subject codes to SF10 grouped codes
  // Science: SCI_BIO, SCI_CHEM, SCI_ES → SCI (grouped)
  // TLE: TLE_AFA, TLE_FCS, TLE_ICT (with or without _EXP suffix) → TLE (grouped)
  // MAPEH: MUSIC, ARTS, PE, HEALTH → MAPEH (grouped, for historical seed data)
  const SF10_GROUP_MAP: Record<string, string> = {
    SCI_BIO: 'SCI', SCI_CHEM: 'SCI', SCI_ES: 'SCI', SCI: 'SCI',
    TLE_AFA: 'TLE', TLE_AFA_EXP: 'TLE',
    TLE_FCS: 'TLE', TLE_FCS_EXP: 'TLE',
    TLE_ICT: 'TLE', TLE_ICT_EXP: 'TLE',
    TLE: 'TLE',
    MUSIC: 'MAPEH', ARTS: 'MAPEH', PE: 'MAPEH', HEALTH: 'MAPEH', MAPEH: 'MAPEH',
  };

  // Extract the base SF10 code from a subject code (strip grade number)
  const sf10Code = (subjectCode: string): string =>
    subjectCode.toUpperCase().replace(/\d+$/, '').replace(/[^A-Z_]/g, '');

  // Map a raw SF10 code to its grouped code (if applicable)
  const sf10GroupCode = (code: string): string => SF10_GROUP_MAP[code] ?? code;

  // Build the SF10 learning area list from ATLAS subjectGrades (dynamic, per record)
  // Groups SCI_* into one "Science" row and TLE_* into one "TLE" row
  const buildSF10Areas = (subjectGrades: any[]) => {
    const seen = new Map<string, { code: string; name: string; order: number; subCodes: string[] }>();
    for (const sg of subjectGrades) {
      const rawCode = sf10Code(sg.subjectCode);
      const groupCode = sf10GroupCode(rawCode);
      if (!seen.has(groupCode)) {
        seen.set(groupCode, {
          code: groupCode,
          name: DEPED_AREA_NAMES[groupCode] ?? sg.subjectName.replace(/\s*\d+$/, ''),
          order: DEPED_AREA_ORDER[groupCode] ?? 99,
          subCodes: [],
        });
      }
      const entry = seen.get(groupCode)!;
      if (!entry.subCodes.includes(rawCode)) entry.subCodes.push(rawCode);
    }
    return Array.from(seen.values()).sort((a, b) => a.order - b.order);
  };

  // Get display values for a learning area (handles grouped subjects by averaging sub-grades)
  const getAreaDisplayValues = (area: { code: string; subCodes: string[] }, subjectGrades: any[]) => {
    // For non-grouped subjects (single subCode), match by subCode list
    if (area.subCodes.length <= 1) {
      const matched = subjectGrades.find((sg: any) => area.subCodes.includes(sf10Code(sg.subjectCode)));
      return { t1: matched?.T1 ?? null, t2: matched?.T2 ?? null, t3: matched?.T3 ?? null, final: matched?.final ?? null };
    }
    // For grouped subjects, average all matching sub-grades
    const subs = subjectGrades.filter((sg: any) => area.subCodes.includes(sf10Code(sg.subjectCode)));
    if (subs.length === 0) return { t1: null, t2: null, t3: null, final: null };
    const avg = (field: string) => {
      const vals = subs.map((s: any) => s[field]).filter((v: any) => v != null);
      return vals.length > 0 ? Math.round(vals.reduce((a: number, b: number) => a + b, 0) / vals.length) : null;
    };
    return { t1: avg('T1'), t2: avg('T2'), t3: avg('T3'), final: avg('final') };
  };

  // Render SF10 Content Helper — Official DepEd SF10-JHS Layout
  const renderSF10Content = (data: SF10Data) => {
    const studentFirstName = data.student.firstName || data.student.name.split(',')[1]?.trim().split(' ')[0] || '';
    const studentLastName = data.student.lastName || data.student.name.split(',')[0]?.trim() || '';
    const studentMiddleName = data.student.middleName || data.student.name.split(',')[1]?.trim().split(' ').slice(1).join(' ') || '';
    const studentNameExtension = data.student.nameExtension || '';

    return (
    <div className="bg-white border-2 border-gray-400 shadow-xl print-form p-6 mb-8 text-[11px] leading-tight">
      {/* SF10-JHS Label */}
      <div className="mb-1">
        <span className="font-bold text-gray-900 text-xs">SF10-JHS</span>
      </div>

      {/* Header — Republic / DepEd centered */}
      <div className="text-center mb-3">
        <p className="font-bold text-gray-900">Republic of the Philippines</p>
        <p className="font-bold text-gray-900">Department of Education</p>
      </div>

      {/* Title */}
      <div className="text-center mb-4">
        <h1 className="text-sm font-bold text-gray-900">Learner Permanent Academic Record for Junior High School (SF10-JHS)</h1>
        <p className="text-[10px] text-gray-700 mt-0.5">(Formerly Form 137)</p>
      </div>

      {/* LEARNER'S INFORMATION */}
      <div className="mb-3 border border-black">
        <div className="bg-gray-200 px-2 py-0.5 border-b border-black">
          <span className="font-bold text-[11px] text-gray-900">LEARNER&apos;S INFORMATION</span>
        </div>
        <div className="p-2">
          {/* Row 1: Last Name | First Name */}
          <div className="grid grid-cols-2 gap-4 mb-1">
            <div>
              <span className="font-bold text-gray-900">LAST NAME:</span>
              <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[150px]">{studentLastName}</span>
            </div>
            <div>
              <span className="font-bold text-gray-900">FIRST NAME:</span>
              <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[150px]">{studentFirstName}</span>
            </div>
          </div>
          {/* Row 2: Name Extension | Middle Name */}
          <div className="grid grid-cols-2 gap-4 mb-1">
            <div>
              <span className="font-bold text-gray-900">NAME EXTENSION (Jr, II):</span>
              <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[150px]">{studentNameExtension}</span>
            </div>
            <div>
              <span className="font-bold text-gray-900">MIDDLE NAME:</span>
              <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[150px]">{studentMiddleName}</span>
            </div>
          </div>
          {/* Row 3: LRN | Birthdate */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="font-bold text-gray-900">Learner Reference Number (LRN):</span>
              <span className="border-b border-gray-600 ml-1 font-mono text-gray-900 inline-block min-w-[150px]">{data.student.lrn}</span>
            </div>
            <div>
              <span className="font-bold text-gray-900">Birthdate (mm/dd/yyyy):</span>
              <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[150px]">{data.student.birthDate || ''}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ELIGIBILITY FOR JHS ENROLMENT */}
      <div className="mb-3 border border-black">
        <div className="bg-gray-200 px-2 py-0.5 border-b border-black">
          <span className="font-bold text-[11px] text-gray-900">ELIGIBILITY FOR JHS ENROLMENT</span>
        </div>
        <div className="p-2">
          {/* Row 1: Elementary School Completer + General Average */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-gray-900">☐ Elementary School Completer</span>
            <span className="ml-auto">
              <span className="font-bold text-gray-900">General Average:</span>
              <span className="border-b border-gray-600 ml-1 inline-block min-w-[60px] text-gray-900">&nbsp;</span>
            </span>
          </div>
          <div className="mb-1">
            <span className="font-bold text-gray-900 ml-4">Name of Elementary School:</span>
            <span className="border-b border-gray-600 ml-1 inline-block min-w-[300px] text-gray-900">&nbsp;</span>
          </div>
          {/* Row 2: Other Credential */}
          <div className="mb-1">
            <span className="font-bold text-gray-900">Other Credential Presented</span>
          </div>
          <div className="flex items-center gap-2 mb-1 ml-4">
            <span className="text-gray-900">☐ PEPT Passer</span>
            <span className="ml-4">
              <span className="font-bold text-gray-900">Rating:</span>
              <span className="border-b border-gray-600 ml-1 inline-block min-w-[60px] text-gray-900">&nbsp;</span>
            </span>
          </div>
          <div className="mb-1 ml-4">
            <span className="font-bold text-gray-900">Date of Examination/Assessment (mm/dd/yyyy):</span>
            <span className="border-b border-gray-600 ml-1 inline-block min-w-[100px] text-gray-900">&nbsp;</span>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <span className="text-gray-900">☐ ALS A &amp; E Passer</span>
          </div>
        </div>
      </div>

      {/* SCHOLASTIC RECORD — one per grade level */}
      {data.schoolRecords.map((record: any, recordIndex: number) => (
        <div key={recordIndex} className="mb-3 border border-black page-break-inside-avoid">
          {/* School / Grade / Section / SY Header */}
          <div className="p-2 border-b border-black">
            <div className="grid grid-cols-2 gap-2 mb-0.5">
              <div>
                <span className="font-bold text-gray-900">School:</span>
                <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[200px]">{record.school || schoolName || ''}</span>
              </div>
              <div>
                <span className="font-bold text-gray-900">School ID:</span>
                <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[80px]">{record.schoolId || ''}</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className="font-bold text-gray-900">Classified as Grade:</span>
                <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[40px]">{formatGradeLevel(record.gradeLevel)}</span>
              </div>
              <div>
                <span className="font-bold text-gray-900">Section:</span>
                <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[80px]">{record.section}</span>
              </div>
              <div>
                <span className="font-bold text-gray-900">School Year:</span>
                <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[80px]">{record.schoolYear}</span>
              </div>
            </div>
          </div>

          {/* Scholastic Record Table */}
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="border-b border-black">
                <th rowSpan={2} className="border-r border-black p-1 text-left text-gray-900 bg-gray-200" style={{ width: '30%' }}>
                  LEARNING AREAS
                </th>
                <th colSpan={3} className="border-r border-black p-1 text-center text-gray-900 bg-gray-200">
                  Term Rating
                </th>
                <th rowSpan={2} className="border-r border-black p-1 text-center text-gray-900 bg-gray-200" style={{ width: '10%' }}>
                  FINAL<br/>RATING
                </th>
                <th rowSpan={2} className="p-1 text-center text-gray-900 bg-gray-200" style={{ width: '12%' }}>
                  REMARKS
                </th>
              </tr>
              <tr className="border-b border-black">
                <th className="border-r border-black p-1 text-center text-gray-900 bg-gray-200" style={{ width: '8%' }}>1</th>
                <th className="border-r border-black p-1 text-center text-gray-900 bg-gray-200" style={{ width: '8%' }}>2</th>
                <th className="border-r border-black p-1 text-center text-gray-900 bg-gray-200" style={{ width: '8%' }}>3</th>
              </tr>
            </thead>
            <tbody>
              {buildSF10Areas(record.subjectGrades).map((area, idx) => {
                // Get display values (handles grouped subjects by averaging)
                const vals = getAreaDisplayValues(area, record.subjectGrades);

                const cellClass = (val: number | null) =>
                  `border-r border-black p-0.5 text-center ${(val ?? 0) < 75 && val != null ? 'text-red-600 font-bold' : 'text-gray-900'}`;

                // Backend quarterlyGrade values are already transmuted — display as-is
                const t1 = vals.t1;
                const t2 = vals.t2;
                const t3 = vals.t3;
                const finalGrade = vals.final;

                return (
                  <tr key={idx} className="border-b border-black">
                    <td className="border-r border-black p-0.5 text-gray-900 font-medium">
                      {area.name}
                    </td>
                    <td className={cellClass(t1)}>{t1 ?? ''}</td>
                    <td className={cellClass(t2)}>{t2 ?? ''}</td>
                    <td className={`${cellClass(t3)} border-r border-black`}>{t3 ?? ''}</td>
                    <td className={`border-r border-black p-0.5 text-center font-bold ${(finalGrade ?? 0) < 75 && finalGrade != null ? 'text-red-600' : 'text-gray-900'}`}>
                      {finalGrade ?? ''}
                    </td>
                    <td className="p-0.5 text-center text-gray-900">
                      {finalGrade != null ? (finalGrade >= 75 ? 'Passed' : 'Failed') : ''}
                    </td>
                  </tr>
                );
              })}

              {/* General Average Row */}
              <tr className="border-t-2 border-black bg-gray-100">
                <td colSpan={4} className="border-r border-black p-1 text-right font-bold text-gray-900">General Average:</td>
                <td className="border-r border-black p-1 text-center font-bold text-sm text-gray-900">
                  {record.generalAverage ?? ''}
                </td>
                <td className="p-1 text-center text-gray-900">
                  {record.generalAverage != null ? (record.generalAverage >= 75 ? 'Passed' : 'Failed') : ''}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Remedial Classes Section */}
          <div className="border-t border-black p-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold text-gray-900">Remedial Classes</span>
              <span className="text-gray-900 ml-4">
                Conducted from (mm/dd/yyyy)
                <span className="border-b border-gray-600 mx-1 inline-block min-w-[80px]">&nbsp;</span>
                to
                <span className="border-b border-gray-600 mx-1 inline-block min-w-[80px]">&nbsp;</span>
              </span>
            </div>
            <table className="w-full text-[10px] border-collapse mt-1">
              <thead>
                <tr className="border-b border-black">
                  <th className="border-r border-black p-0.5 text-left text-gray-900 bg-gray-100" style={{ width: '40%' }}>Learning Areas</th>
                  <th className="border-r border-black p-0.5 text-center text-gray-900 bg-gray-100" style={{ width: '15%' }}>Final Rating</th>
                  <th className="p-0.5 text-center text-gray-900 bg-gray-100" style={{ width: '25%' }}>Remedial Class Mark</th>
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2].map((i) => (
                  <tr key={i} className="border-b border-black">
                    <td className="border-r border-black p-0.5 h-4">&nbsp;</td>
                    <td className="border-r border-black p-0.5">&nbsp;</td>
                    <td className="p-0.5">&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Adviser / Principal Signatures */}
          <div className="grid grid-cols-2 gap-4 p-2 border-t border-black text-[10px]">
            <div className="text-center">
              <div className="border-b border-gray-600 mt-6 mx-4"></div>
              <p className="mt-0.5 text-gray-900">Signature of Adviser</p>
              <p className="text-gray-700 italic">(over Printed Name)</p>
            </div>
            <div className="text-center">
              <div className="border-b border-gray-600 mt-6 mx-4"></div>
              <p className="mt-0.5 text-gray-900">Signature of Principal/School Head</p>
              <p className="text-gray-700 italic">(over Printed Name)</p>
            </div>
          </div>
        </div>
      ))}

      {/* CERTIFICATION */}
      <div className="mt-3 border border-black p-3">
        <p className="font-bold text-gray-900 text-center mb-2">CERTIFICATION</p>
        <p className="text-gray-900 text-center leading-relaxed mb-3">
          I CERTIFY that this is a true record of {studentFirstName} {studentLastName}
          {' '}with LRN {data.student.lrn} and that he/she is eligible for admission to Grade ______.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="font-bold text-gray-900">Name of School:</span>
            <span className="border-b border-gray-600 ml-1 inline-block min-w-[180px] text-gray-900">{data.schoolSettings?.schoolName || schoolName || ''}</span>
          </div>
          <div>
            <span className="font-bold text-gray-900">School ID:</span>
            <span className="border-b border-gray-600 ml-1 inline-block min-w-[80px] text-gray-900">{data.schoolSettings?.schoolId || ''}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-8 mt-6">
          <div className="text-center">
            <div className="border-b border-gray-600 mt-6 mx-8"></div>
            <p className="mt-0.5 text-[10px] text-gray-900">Date</p>
          </div>
          <div className="text-center">
            <div className="border-b border-gray-600 mt-6 mx-8"></div>
            <p className="mt-0.5 text-[10px] text-gray-900">Signature of Principal/School Head over Printed Name</p>
          </div>
        </div>
      </div>
    </div>
    );
  };

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
            <div>T/O — Transferred Out</div>
            <div>T/I — Transferred In</div>
            <div>DRP — Dropped Out</div>
            <div>B/A — Balik-Aral</div>
            <div>CCT — 4Ps Recipient</div>
            <div>LWD — Learner with Disability</div>
            <div>ACL — Accelerated</div>
            <div>LE — Late Enrollment</div>
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
      <div className="space-y-6 animate-fade-in">
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
                  <SelectTrigger>
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
                  <SelectTrigger>
                    <SelectValue />
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
                  <SelectTrigger>
                    <SelectValue placeholder="Select section">
                      {(() => {
                        const section = sections.find(s => s.id === selectedSection);
                        if (!section) return "Select section";
                        return selectedGrade === "ALL"
                          ? `Grade ${formatGradeLevel(section.gradeLevel)} - ${section.name}`
                          : section.name;
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {filteredSectionsForDropdown.map((section) => (
                      <SelectItem key={section.id} value={section.id}>
                        {selectedGrade === "ALL" ? `Grade ${formatGradeLevel(section.gradeLevel)} - ${section.name}` : section.name}{section.program && section.program !== 'REGULAR' ? ` (${section.program})` : ''}
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
                    {(form.id === "SF1" || form.id === "SF2" || form.id === "SF5" || form.id === "SF6" || form.id === "SF9" || form.id === "SF10") && !isDev ? (
                      <Button
                        onClick={() => {
                          if (form.id === "SF1") handleViewSF1();
                          else if (form.id === "SF2") handleViewSF2();
                          else if (form.id === "SF5") handleViewSF5();
                          else if (form.id === "SF6") handleViewSF6();
                          else if (form.id === "SF9") handleViewSF9();
                          else if (form.id === "SF10") handleViewSF10();
                        }}
                        disabled={
                          (form.id === "SF1" || form.id === "SF2" || form.id === "SF5") && !selectedSection
                          || (form.id === "SF9" || form.id === "SF10") && !selectedStudent
                        }
                        className="rounded-xl w-full text-white"
                        style={{ backgroundColor: themeColors.primary }}
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        View
                      </Button>
                    ) : (
                      <Button
                        onClick={() => {
                          if (form.id === "SF9") handleViewSF9();
                          else if (form.id === "SF10") handleViewSF10();
                        }}
                        disabled={
                          isDev ||
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
                      <DropdownMenuTrigger render={
                        <Button
                          size="sm"
                          className="rounded-xl h-9 text-white gap-1.5"
                          style={{ backgroundColor: themeColors.primary }}
                        />
                      }>
                          <Printer className="w-3.5 h-3.5" />
                          Print&nbsp;Selected
                          <ChevronRight className="w-3.5 h-3.5 rotate-90 opacity-70" />
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
                    <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="rounded-xl h-9 gap-1.5" />}>
                        <Printer className="w-3.5 h-3.5" />
                        Print All
                        <ChevronRight className="w-3.5 h-3.5 rotate-90 opacity-50" />
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
                          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg hover:bg-gray-100" />}>
                              <MoreVertical className="w-4 h-4 text-gray-400" />
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
            <Button variant="ghost" onClick={handleBack} className="rounded-xl">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div>
              <h2 className="text-xl font-bold text-gray-900">SF1 - School Register</h2>
              <p className="text-sm text-gray-500">{sf1Data.section.name} ({sf1Data.section.gradeLevel?.replace("_", " ")}) - {sf1Data.section.schoolYear}</p>
              <p className="text-xs text-gray-400">
                {sf1Data.summary.maleCount} Male, {sf1Data.summary.femaleCount} Female, {sf1Data.summary.totalCount} Total
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleDownloadExcel} variant="outline" className="rounded-xl">
              <Download className="w-4 h-4 mr-2" />
              Download Excel
            </Button>
            <Button onClick={handlePrint} className="rounded-xl text-white" style={{ backgroundColor: themeColors.primary }}>
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
    const summary = Array.isArray(sf2Data) ? sf2Data : (sf2Data?.data || []);
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={handleBack} className="rounded-xl">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <h2 className="text-xl font-bold text-gray-900">SF2 - Daily Attendance Report</h2>
            <p className="text-sm text-gray-500">Attendance summary per student</p>
          </div>
        </div>
        <Card className="border-0 shadow-lg rounded-2xl">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="px-4 py-3 text-left font-semibold">Student</th>
                    <th className="px-4 py-3 text-center font-semibold">Present</th>
                    <th className="px-4 py-3 text-center font-semibold">Absent</th>
                    <th className="px-4 py-3 text-center font-semibold">Late</th>
                    <th className="px-4 py-3 text-center font-semibold">Excused</th>
                    <th className="px-4 py-3 text-center font-semibold">Total Days</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s: any, i: number) => (
                    <tr key={s.studentId || i} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{s.studentName || s.name || "-"}</td>
                      <td className="px-4 py-3 text-center text-green-600">{s.present ?? 0}</td>
                      <td className="px-4 py-3 text-center text-red-600">{s.absent ?? 0}</td>
                      <td className="px-4 py-3 text-center text-yellow-600">{s.late ?? 0}</td>
                      <td className="px-4 py-3 text-center text-blue-600">{s.excused ?? 0}</td>
                      <td className="px-4 py-3 text-center font-semibold">{(s.present ?? 0) + (s.absent ?? 0) + (s.late ?? 0) + (s.excused ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // SF5 View - Promotion Report
  if (viewMode === "sf5" && sf5Data) {
    const handlePrint = () => executePrint(sf5PrintRef, "sf5-print-style");

    return (
      <div className="space-y-6 animate-fade-in max-w-[900px] mx-auto">
        {/* Action Buttons — hidden when printing */}
        <div className="flex items-center justify-between print-hide">
          <Button variant="ghost" onClick={handleBack} className="rounded-xl">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <h2 className="text-xl font-bold text-gray-900">SF5 - Report on Promotion</h2>
            <p className="text-sm text-gray-500">{sf5Data.section.name} ({sf5Data.section.gradeLevel}) - {sf5Data.section.schoolYear}</p>
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
    const sections = sf6Data.sections || [];
    const summary = sf6Data.summary || {};
    const byGradeLevel = sf6Data.byGradeLevel || {};
    const gradeOrder = ['GRADE_7', 'GRADE_8', 'GRADE_9', 'GRADE_10'];
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={handleBack} className="rounded-xl">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <h2 className="text-xl font-bold text-gray-900">SF6 - Summary Promotion Report</h2>
            <p className="text-sm text-gray-500">School Year: {sf6Data.schoolYear}</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4">
          <Card className="border-0 shadow-md rounded-xl">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-blue-600">{summary.totalStudents || 0}</p>
              <p className="text-sm text-gray-500">Total Students</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-md rounded-xl">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{summary.promoted || 0}</p>
              <p className="text-sm text-gray-500">Promoted</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-md rounded-xl">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-red-600">{summary.retained || 0}</p>
              <p className="text-sm text-gray-500">Retained</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-md rounded-xl">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-purple-600">{summary.overallPromotionRate || 0}%</p>
              <p className="text-sm text-gray-500">Promotion Rate</p>
            </CardContent>
          </Card>
        </div>

        {/* By Grade Level */}
        <Card className="border-0 shadow-lg rounded-2xl">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="px-4 py-3 text-left font-semibold">Grade Level</th>
                    <th className="px-4 py-3 text-center font-semibold">Total</th>
                    <th className="px-4 py-3 text-center font-semibold">Promoted</th>
                    <th className="px-4 py-3 text-center font-semibold">Retained</th>
                    <th className="px-4 py-3 text-center font-semibold">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {gradeOrder.map((gl) => {
                    const data = byGradeLevel[gl];
                    if (!data) return null;
                    const rate = data.total > 0 ? Math.round((data.promoted / data.total) * 100) : 0;
                    return (
                      <tr key={gl} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{formatGradeLevel(gl)}</td>
                        <td className="px-4 py-3 text-center">{data.total}</td>
                        <td className="px-4 py-3 text-center text-green-600 font-semibold">{data.promoted}</td>
                        <td className="px-4 py-3 text-center text-red-600 font-semibold">{data.retained}</td>
                        <td className="px-4 py-3 text-center font-semibold">{rate}%</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-gray-50 font-bold">
                    <td className="px-4 py-3">TOTAL</td>
                    <td className="px-4 py-3 text-center">{summary.totalStudents || 0}</td>
                    <td className="px-4 py-3 text-center text-green-600">{summary.promoted || 0}</td>
                    <td className="px-4 py-3 text-center text-red-600">{summary.retained || 0}</td>
                    <td className="px-4 py-3 text-center">{summary.overallPromotionRate || 0}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* By Section */}
        <Card className="border-0 shadow-lg rounded-2xl">
          <CardHeader>
            <CardTitle className="text-lg">Section Details</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="px-4 py-3 text-left font-semibold">Section</th>
                    <th className="px-4 py-3 text-left font-semibold">Grade</th>
                    <th className="px-4 py-3 text-left font-semibold">Program</th>
                    <th className="px-4 py-3 text-center font-semibold">Total</th>
                    <th className="px-4 py-3 text-center font-semibold">Promoted</th>
                    <th className="px-4 py-3 text-center font-semibold">Retained</th>
                    <th className="px-4 py-3 text-center font-semibold">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {sections.map((s: any) => (
                    <tr key={s.sectionId} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{s.sectionName}</td>
                      <td className="px-4 py-3">{formatGradeLevel(s.gradeLevel)}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100">{s.program}</span>
                      </td>
                      <td className="px-4 py-3 text-center">{s.totalStudents}</td>
                      <td className="px-4 py-3 text-center text-green-600 font-semibold">{s.promoted}</td>
                      <td className="px-4 py-3 text-center text-red-600 font-semibold">{s.retained}</td>
                      <td className="px-4 py-3 text-center font-semibold">{s.promotionRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
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
        <div ref={sf10PrintRef}>
          {renderSF10Content(sf10Data)}
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
