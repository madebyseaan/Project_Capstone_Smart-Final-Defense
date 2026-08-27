import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "../../lib/api";
import { useTheme } from "../../contexts/ThemeContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  Calendar,
  Plus,
  Trash2,
  Archive,
  CheckCircle2,
  Loader2,
  AlertTriangle,
} from "lucide-react";

interface SchoolYear {
  id: string;
  label: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  archivedAt: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  ACTIVE: "bg-green-100 text-green-700",
  ARCHIVED: "bg-yellow-100 text-yellow-700",
  COMPLETED: "bg-blue-100 text-blue-700",
};

export default function SchoolYears() {
  const navigate = useNavigate();
  const { colors } = useTheme();
  const [years, setYears] = useState<SchoolYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchYears = useCallback(async () => {
    try {
      const res = await adminApi.getSchoolYears();
      setYears(res.data.schoolYears || []);
    } catch (err: any) {
      console.error("Failed to load school years:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchYears();
  }, [fetchYears]);

  const handleCreate = async () => {
    if (!newLabel.trim()) return;
    setCreating(true);
    try {
      await adminApi.createSchoolYear({ label: newLabel.trim() });
      setMessage({ type: "success", text: `School year ${newLabel} created` });
      setNewLabel("");
      setShowCreate(false);
      fetchYears();
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.message || "Failed to create" });
    } finally {
      setCreating(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      await adminApi.updateSchoolYear(id, { status: newStatus });
      setMessage({ type: "success", text: `Status updated to ${newStatus}` });
      fetchYears();
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.message || "Failed to update" });
    }
  };

  const handleDelete = async (id: string, label: string) => {
    if (!confirm(`Delete school year ${label}?`)) return;
    try {
      await adminApi.deleteSchoolYear(id);
      setMessage({ type: "success", text: `School year ${label} deleted` });
      fetchYears();
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.message || "Failed to delete" });
    }
  };

  return (
    <div className="space-y-6">
      {message && (
        <div className={`p-4 rounded-lg flex items-center gap-2 ${message.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {message.type === "success" ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {message.text}
          <button className="ml-auto text-sm underline" onClick={() => setMessage(null)}>Dismiss</button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">School Years</h1>
          <p className="text-muted-foreground">Manage school year lifecycle and archival</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="w-4 h-4" /> Add Year
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            School Years — {years.length}
          </CardTitle>
          <CardDescription>Create, activate, and archive school years</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : years.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No school years created yet. Click "Add Year" to create one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Archived</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {years.map((year) => (
                  <TableRow key={year.id}>
                    <TableCell className="font-medium">{year.label}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLORS[year.status] || ""}>{year.status}</Badge>
                    </TableCell>
                    <TableCell>{year.archivedAt ? new Date(year.archivedAt).toLocaleDateString() : "—"}</TableCell>
                    <TableCell>{new Date(year.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right space-x-2">
                      {year.status === "DRAFT" && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => handleStatusChange(year.id, "ACTIVE")}>
                            Activate
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => handleDelete(year.id, year.label)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      {year.status === "ACTIVE" && (
                        <Button size="sm" variant="outline" onClick={() => handleStatusChange(year.id, "COMPLETED")}>
                          <Archive className="w-4 h-4 mr-1" /> Complete
                        </Button>
                      )}
                      {year.status === "COMPLETED" && (
                        <Button size="sm" variant="outline" onClick={() => handleStatusChange(year.id, "ARCHIVED")}>
                          <Archive className="w-4 h-4 mr-1" /> Archive
                        </Button>
                      )}
                      {year.status === "ARCHIVED" && (
                        <span className="text-sm text-muted-foreground">Finalized</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create School Year</DialogTitle>
            <DialogDescription>Enter the school year label (e.g. "2027-2028")</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="2027-2028"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !newLabel.trim()}>
              {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
