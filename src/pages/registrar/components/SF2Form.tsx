import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface SF2FormProps {
  data: any;
  onBack: () => void;
}

export default function SF2Form({ data, onBack }: SF2FormProps) {
  const summary = Array.isArray(data) ? data : (data?.data || []);
  return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <h2 className="text-xl font-bold text-foreground">SF2 - Daily Attendance Report</h2>
            <p className="text-sm text-muted-foreground">Attendance summary per student</p>
          </div>
        </div>
        <Card className="border-0 shadow-lg rounded-2xl">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b">
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
                    <tr key={s.studentId || i} className="border-b hover:bg-muted/50">
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