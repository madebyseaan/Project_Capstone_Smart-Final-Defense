import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatGradeLevel } from "./formUtils";

interface SF6FormProps {
  sf6Data: any;
  onBack: () => void;
}

export default function SF6Form({ sf6Data, onBack }: SF6FormProps) {
  const sections = sf6Data.sections || [];
  const summary = sf6Data.summary || {};
  const byGradeLevel = sf6Data.byGradeLevel || {};
  const gradeOrder = ['GRADE_7', 'GRADE_8', 'GRADE_9', 'GRADE_10'];
  return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <h2 className="text-xl font-bold text-foreground">SF6 - Summary Promotion Report</h2>
            <p className="text-sm text-muted-foreground">School Year: {sf6Data.schoolYear}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
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
              <p className="text-2xl font-bold text-slate-500">{summary.noGrades || 0}</p>
              <p className="text-sm text-gray-500">Pending (no grades)</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-md rounded-xl">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-purple-600">
                {summary.gradedStudents ? Math.round((summary.promoted / summary.gradedStudents) * 100) : 0}%
              </p>
              <p className="text-sm text-gray-500">Promotion Rate</p>
            </CardContent>
          </Card>
        </div>
        {!!summary.noGrades && (
          <p className="text-xs text-muted-foreground -mt-3">
            Learners with no encoded grades yet are <span className="font-semibold">Pending</span>, not retained.
            Promotion rate is computed over graded learners only.
          </p>
        )}

        {/* By Grade Level */}
        <Card className="border-0 shadow-lg rounded-2xl">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="px-4 py-3 text-left font-semibold">Grade Level</th>
                    <th className="px-4 py-3 text-center font-semibold">Total</th>
                    <th className="px-4 py-3 text-center font-semibold">Promoted</th>
                    <th className="px-4 py-3 text-center font-semibold">Retained</th>
                    <th className="px-4 py-3 text-center font-semibold">Pending</th>
                    <th className="px-4 py-3 text-center font-semibold">Rate (graded)</th>
                  </tr>
                </thead>
                <tbody>
                  {gradeOrder.map((gl) => {
                    const data = byGradeLevel[gl];
                    if (!data) return null;
                    const graded = (data.promoted || 0) + (data.retained || 0);
                    const rate = graded > 0 ? Math.round((data.promoted / graded) * 100) : 0;
                    return (
                      <tr key={gl} className="border-b hover:bg-muted/50">
                        <td className="px-4 py-3 font-medium">{formatGradeLevel(gl)}</td>
                        <td className="px-4 py-3 text-center">{data.total}</td>
                        <td className="px-4 py-3 text-center text-green-600 font-semibold">{data.promoted}</td>
                        <td className="px-4 py-3 text-center text-red-600 font-semibold">{data.retained}</td>
                        <td className="px-4 py-3 text-center text-slate-500 font-semibold">{data.noGrades || 0}</td>
                        <td className="px-4 py-3 text-center font-semibold">{rate}%</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-muted/50 font-bold">
                    <td className="px-4 py-3">TOTAL</td>
                    <td className="px-4 py-3 text-center">{summary.totalStudents || 0}</td>
                    <td className="px-4 py-3 text-center text-green-600">{summary.promoted || 0}</td>
                    <td className="px-4 py-3 text-center text-red-600">{summary.retained || 0}</td>
                    <td className="px-4 py-3 text-center text-slate-500">{summary.noGrades || 0}</td>
                    <td className="px-4 py-3 text-center">
                      {summary.gradedStudents ? Math.round((summary.promoted / summary.gradedStudents) * 100) : 0}%
                    </td>
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
                  <tr className="bg-muted/50 border-b">
                    <th className="px-4 py-3 text-left font-semibold">Section</th>
                    <th className="px-4 py-3 text-left font-semibold">Grade</th>
                    <th className="px-4 py-3 text-left font-semibold">Program</th>
                    <th className="px-4 py-3 text-center font-semibold">Total</th>
                    <th className="px-4 py-3 text-center font-semibold">Promoted</th>
                    <th className="px-4 py-3 text-center font-semibold">Retained</th>
                    <th className="px-4 py-3 text-center font-semibold">Pending</th>
                    <th className="px-4 py-3 text-center font-semibold">Rate (graded)</th>
                  </tr>
                </thead>
                <tbody>
                  {sections.map((s: any) => {
                    const graded = (s.promoted || 0) + (s.retained || 0);
                    const rate = graded > 0 ? Math.round((s.promoted / graded) * 100) : 0;
                    return (
                    <tr key={s.sectionId} className="border-b hover:bg-muted/50">
                      <td className="px-4 py-3 font-medium">{s.sectionName}</td>
                      <td className="px-4 py-3">{formatGradeLevel(s.gradeLevel)}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-muted">{s.program}</span>
                      </td>
                      <td className="px-4 py-3 text-center">{s.totalStudents}</td>
                      <td className="px-4 py-3 text-center text-green-600 font-semibold">{s.promoted}</td>
                      <td className="px-4 py-3 text-center text-red-600 font-semibold">{s.retained}</td>
                      <td className="px-4 py-3 text-center text-slate-500 font-semibold">{s.noGrades || 0}</td>
                      <td className="px-4 py-3 text-center font-semibold">{rate}%</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
  );
}