import { useState, useEffect, useCallback, useMemo } from "react";
import { adminApi } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  Plus,
  Trash2,
  Archive,
  CheckCircle2,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { PageHeader } from "../../components/layout/PageHeader";
import { SearchInput } from "../../components/layout/SearchInput";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { DataTable, usePagination } from "@/components/data-table";
import { Dash } from "@/components/data-table/Dash";
import type { TableColumn } from "@/components/data-table";

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
  DRAFT: "bg-muted text-muted-foreground border-border",
  ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ARCHIVED: "bg-amber-50 text-amber-700 border-amber-200",
  COMPLETED: "bg-blue-50 text-blue-700 border-blue-200",
};

function errorText(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { message?: string } } };
  return e.response?.data?.message || fallback;
}

export default function SchoolYears() {
  const [years, setYears] = useState<SchoolYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SchoolYear | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchYears = useCallback(async () => {
    try {
      const res = await adminApi.getSchoolYears();
      setYears(res.data.schoolYears || []);
    } catch (err) {
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
    } catch (err) {
      setMessage({ type: "error", text: errorText(err, "Failed to create") });
    } finally {
      setCreating(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      await adminApi.updateSchoolYear(id, { status: newStatus });
      setMessage({ type: "success", text: `Status updated to ${newStatus}` });
      fetchYears();
    } catch (err) {
      setMessage({ type: "error", text: errorText(err, "Failed to update") });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await adminApi.deleteSchoolYear(deleteTarget.id);
      setMessage({ type: "success", text: `School year ${deleteTarget.label} deleted` });
      setDeleteTarget(null);
      fetchYears();
    } catch (err) {
      setMessage({ type: "error", text: errorText(err, "Failed to delete") });
    } finally {
      setDeleting(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return years;
    return years.filter(
      (y) => y.label.toLowerCase().includes(q) || y.status.toLowerCase().includes(q)
    );
  }, [years, search]);

  const pagination = usePagination({ totalRows: filtered.length });

  const columns: TableColumn<SchoolYear>[] = [
    {
      key: "label",
      header: "Label",
      skeleton: "name",
      cell: (year) => <span className="font-medium text-foreground">{year.label}</span>,
    },
    {
      key: "status",
      header: "Status",
      skeleton: "badge",
      cell: (year) => (
        <Badge
          variant="outline"
          className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[year.status] || ""}`}
        >
          {year.status}
        </Badge>
      ),
    },
    {
      key: "archived",
      header: "Archived",
      skeleton: "date",
      cell: (year) =>
        year.archivedAt ? (
          new Date(year.archivedAt).toLocaleDateString()
        ) : (
          <Dash />
        ),
    },
    {
      key: "created",
      header: "Created",
      skeleton: "date",
      cell: (year) => new Date(year.createdAt).toLocaleDateString(),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      className: "text-right",
      cell: (year) => (
        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
          {year.status === "DRAFT" && (
            <>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleStatusChange(year.id, "ACTIVE")}>
                Activate
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-destructive hover:text-destructive"
                onClick={() => setDeleteTarget(year)}
                aria-label={`Delete ${year.label}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </>
          )}
          {year.status === "ACTIVE" && (
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleStatusChange(year.id, "COMPLETED")}>
              <Archive className="w-4 h-4 mr-1" /> Complete
            </Button>
          )}
          {year.status === "COMPLETED" && (
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleStatusChange(year.id, "ARCHIVED")}>
              <Archive className="w-4 h-4 mr-1" /> Archive
            </Button>
          )}
          {year.status === "ARCHIVED" && (
            <span className="text-sm text-muted-foreground">Finalized</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
      {message && (
        <div
          className={`p-4 rounded-xl flex items-center gap-2 border-2 ${
            message.type === "success"
              ? "bg-primary/5 border-primary/20 text-primary"
              : "bg-destructive/5 border-destructive/20 text-destructive"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span className="text-sm font-medium">{message.text}</span>
          <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => setMessage(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <PageHeader
        title="School Years"
        description="Manage school year lifecycle and archival"
        actions={
          <Button
            onClick={() => setShowCreate(true)}
            variant="default"
            size="sm"
            className="font-semibold text-xs shadow-sm shadow-primary/20"
          >
            <Plus className="w-4 h-4 mr-1.5" /> Add Year
          </Button>
        }
      />

      <DataTable
        columns={columns}
        rows={filtered}
        loading={loading}
        title="School Years"
        description={`${filtered.length} record${filtered.length !== 1 ? "s" : ""} found`}
        emptyTitle="No school years yet"
        emptyHint='Click "Add Year" to create one.'
        emptySearchTerm={search}
        rowKey={(year) => year.id}
        pagination={pagination}
        toolbar={
          <div className="flex items-center gap-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search school years..."
            />
          </div>
        }
      />

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

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete school year"
        description={`Delete school year ${deleteTarget?.label ?? ""}? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
