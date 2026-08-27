import { useState } from "react";
import {
  Printer,
  FileText,
  Users,
  CheckCircle2,
  Clock,
  AlertCircle,
  Search,
  MoreVertical,
  Calendar,
  Layers,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useTheme } from "@/contexts/ThemeContext";

interface PrintJob {
  id: string;
  documentType: string;
  documentName: string;
  requestedBy: string;
  copies: number;
  status: "completed" | "in-progress" | "queued" | "failed";
  createdAt: string;
  completedAt?: string;
}

const printJobs: PrintJob[] = [
  { id: "PJ001", documentType: "SF9", documentName: "Report Cards - Grade 7A", requestedBy: "Maria Cruz", copies: 45, status: "completed", createdAt: "Mar 30, 2026 10:30 AM", completedAt: "Mar 30, 2026 10:35 AM" },
  { id: "PJ002", documentType: "SF10", documentName: "Permanent Record - Juan dela Cruz", requestedBy: "Maria Cruz", copies: 1, status: "completed", createdAt: "Mar 30, 2026 09:15 AM", completedAt: "Mar 30, 2026 09:16 AM" },
  { id: "PJ003", documentType: "SF1", documentName: "School Register - All Sections", requestedBy: "Maria Cruz", copies: 24, status: "in-progress", createdAt: "Mar 30, 2026 09:00 AM" },
  { id: "PJ004", documentType: "SF9", documentName: "Report Cards - Grade 8B", requestedBy: "Maria Cruz", copies: 42, status: "queued", createdAt: "Mar 30, 2026 08:45 AM" },
  { id: "PJ005", documentType: "SF2", documentName: "Daily Attendance - March 2026", requestedBy: "Maria Cruz", copies: 1, status: "queued", createdAt: "Mar 30, 2026 08:30 AM" },
  { id: "PJ006", documentType: "SF5", documentName: "Promotion Report - Grade 10", requestedBy: "Maria Cruz", copies: 120, status: "failed", createdAt: "Mar 29, 2026 03:00 PM" },
];

const quickPrintOptions = [
  { id: "sf9-all", name: "All Report Cards", icon: FileText, description: "Print SF9 for all students", form: "SF9", color: "blue" },
  { id: "sf10-gradlevel", name: "Permanent Records", icon: Users, description: "Print SF10 by grade level", form: "SF10", color: "blue" },
  { id: "sf1-section", name: "School Register", icon: Layers, description: "Print SF1 by section", form: "SF1", color: "amber" },
  { id: "sf2-monthly", name: "Attendance Reports", icon: Calendar, description: "Print SF2 for the month", form: "SF2", color: "amber" },
];

export default function PrintCenter() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { colors } = useTheme();

  const filteredJobs = printJobs.filter((job) => {
    const matchesSearch = 
      job.documentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.documentType.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || job.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const jobCounts = {
    total: printJobs.length,
    completed: printJobs.filter(j => j.status === "completed").length,
    inProgress: printJobs.filter(j => j.status === "in-progress").length,
    queued: printJobs.filter(j => j.status === "queued").length,
    failed: printJobs.filter(j => j.status === "failed").length,
  };

  const getStatusBadge = (status: PrintJob["status"]) => {
    switch (status) {
      case "completed":
        return (
          <Badge className="border-0 font-medium" style={{ backgroundColor: `${colors.primary}20`, color: colors.primary }}>
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Completed
          </Badge>
        );
      case "in-progress":
        return (
          <Badge className="border-0 font-medium" style={{ backgroundColor: `${colors.secondary}25`, color: colors.secondary }}>
            <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
            In Progress
          </Badge>
        );
      case "queued":
        return (
          <Badge className="border-0 font-medium" style={{ backgroundColor: `${colors.accent}25`, color: colors.accent }}>
            <Clock className="w-3 h-3 mr-1" />
            Queued
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-100 text-red-700 border-0 font-medium">
            <AlertCircle className="w-3 h-3 mr-1" />
            Failed
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: '#111827' }}>
            Print Center
          </h1>
          <p style={{ color: '#6b7280' }} className="mt-1">
            Manage print jobs and batch print school forms
          </p>
        </div>
        <Button 
          className="gap-2 text-white font-semibold rounded-xl shadow-lg w-fit"
          style={{ backgroundColor: colors.primary }}
        >
          <Printer className="w-4 h-4" />
          New Print Job
        </Button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="border-0 shadow-lg shadow-gray-200/50 rounded-xl bg-white p-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500">Total Jobs</p>
                <p className="text-2xl font-bold text-gray-900">{jobCounts.total}</p>
              </div>
              <div className="p-2 rounded-lg bg-gray-100">
                <Layers className="w-5 h-5 text-gray-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg shadow-gray-200/50 rounded-xl bg-white p-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500">Completed</p>
                <p className="text-2xl font-bold" style={{ color: colors.primary }}>{jobCounts.completed}</p>
              </div>
              <div className="p-2 rounded-lg" style={{ backgroundColor: `${colors.primary}20` }}>
                <CheckCircle2 className="w-5 h-5" style={{ color: colors.primary }} />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg shadow-gray-200/50 rounded-xl bg-white p-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500">In Progress</p>
                <p className="text-2xl font-bold" style={{ color: colors.secondary }}>{jobCounts.inProgress}</p>
              </div>
              <div className="p-2 rounded-lg" style={{ backgroundColor: `${colors.secondary}20` }}>
                <RefreshCw className="w-5 h-5" style={{ color: colors.secondary }} />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg shadow-gray-200/50 rounded-xl bg-white p-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500">Queued</p>
                <p className="text-2xl font-bold" style={{ color: colors.accent }}>{jobCounts.queued}</p>
              </div>
              <div className="p-2 rounded-lg" style={{ backgroundColor: `${colors.accent}20` }}>
                <Clock className="w-5 h-5" style={{ color: colors.accent }} />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg shadow-gray-200/50 rounded-xl bg-white p-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500">Failed</p>
                <p className="text-2xl font-bold text-red-600">{jobCounts.failed}</p>
              </div>
              <div className="p-2 rounded-lg bg-red-100">
                <AlertCircle className="w-5 h-5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Print Options */}
      <Card className="border-0 shadow-xl shadow-gray-200/50 rounded-2xl bg-white p-0">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg" style={{ color: '#111827' }}>Quick Print</CardTitle>
          <CardDescription>Start a batch print job for common documents</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {quickPrintOptions.map((option) => (
              <div
                key={option.id}
                className={`p-4 rounded-xl border-2 border-dashed border-gray-200 hover:border-${option.color}-300 hover:bg-${option.color}-50/50 cursor-pointer transition-all group`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg bg-${option.color}-100 text-${option.color}-600 group-hover:bg-${option.color}-200 transition-colors`}>
                    <option.icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs font-semibold">
                        {option.form}
                      </Badge>
                    </div>
                    <h4 className="font-semibold text-gray-900 text-sm">{option.name}</h4>
                    <p className="text-xs text-gray-500 mt-0.5">{option.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Print Jobs Table */}
      <Card className="border-0 shadow-xl shadow-gray-200/50 rounded-2xl bg-white p-0">
        <CardHeader className="border-b border-gray-100">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-lg" style={{ color: '#111827' }}>Print Queue</CardTitle>
              <CardDescription>Recent and pending print jobs</CardDescription>
            </div>
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search jobs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-64 rounded-xl border-gray-200"
                />
              </div>
              <Select value={statusFilter} onValueChange={(val) => val && setStatusFilter(val)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="in-progress">In Progress</SelectItem>
                  <SelectItem value="queued">Queued</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">Job ID</TableHead>
                <TableHead className="font-semibold text-gray-600">Document</TableHead>
                <TableHead className="font-semibold text-gray-600">Form</TableHead>
                <TableHead className="font-semibold text-gray-600">Copies</TableHead>
                <TableHead className="font-semibold text-gray-600">Status</TableHead>
                <TableHead className="font-semibold text-gray-600">Created</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredJobs.map((job) => (
                <TableRow key={job.id} className="hover:bg-gray-50/50">
                  <TableCell className="font-mono text-sm" style={{ color: colors.primary }}>{job.id}</TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium text-gray-900">{job.documentName}</p>
                      <p className="text-xs text-gray-500">by {job.requestedBy}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-semibold">
                      {job.documentType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-gray-600">{job.copies}</TableCell>
                  <TableCell>{getStatusBadge(job.status)}</TableCell>
                  <TableCell className="text-gray-500 text-sm">{job.createdAt}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" />}>
                          <MoreVertical className="w-4 h-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>View Details</DropdownMenuItem>
                        {(job.status === "queued" || job.status === "failed") && (
                          <DropdownMenuItem>
                            {job.status === "failed" ? "Retry" : "Cancel"}
                          </DropdownMenuItem>
                        )}
                        {job.status === "completed" && (
                          <DropdownMenuItem>Download</DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
