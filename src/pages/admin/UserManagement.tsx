import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Users,
  Eye,
  Shield,
  UserCheck,
  ClipboardList,
  CheckCircle2,
  XCircle,
  Mail,
  Calendar,
  RefreshCw,
  Link2,
  Phone,
  Building2,
  Briefcase,
  BadgeCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { adminApi } from "@/lib/api";
import type { AdminUser } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { PageError } from "@/components/layout/PageError";
import { TableToolbar } from "@/components/data-table/TableToolbar";
import { DataTable, usePagination } from "@/components/data-table";
import type { TableColumn } from "@/components/data-table";
import { Dash } from "@/components/data-table/Dash";
import { AppModal } from "@/components/app-modal";

const roleLabels: Record<string, string> = {
  ADMIN: "Administrator",
  TEACHER: "Teacher",
  REGISTRAR: "Registrar",
};

const roleClasses: Record<string, string> = {
  ADMIN: "bg-primary/20 text-primary border-0",
  TEACHER: "bg-primary/15 text-primary border-0",
  REGISTRAR: "bg-primary/10 text-primary border-0",
};

const roleIcons: Record<string, ReactNode> = {
  ADMIN: <Shield className="w-3.5 h-3.5" />,
  TEACHER: <UserCheck className="w-3.5 h-3.5" />,
  REGISTRAR: <ClipboardList className="w-3.5 h-3.5" />,
};

function Field({ label, value }: { label: string; value?: ReactNode }) {
  const shown = value === null || value === undefined || value === "" ? <Dash /> : value;
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground break-words mt-0.5">{shown}</p>
    </div>
  );
}

function DetailSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-2.5 bg-muted/40 border-b border-border flex items-center gap-2">
        {icon}
        <p className="text-sm font-semibold text-foreground">{title}</p>
      </div>
      <div className="p-4 grid grid-cols-2 gap-4">{children}</div>
    </div>
  );
}

export default function UserManagement() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { colors } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRole, setSelectedRole] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await adminApi.getUsers({ role: selectedRole !== "all" ? selectedRole : undefined });
      setUsers(response.data.users);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch users:", err);
      setError("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const filteredUsers = users.filter((user) => {
    const fullName = `${user.firstName || ""} ${user.lastName || ""}`.toLowerCase();
    const matchesSearch =
      fullName.includes(searchQuery.toLowerCase()) ||
      user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
    const matchesRole = selectedRole === "all" || user.role === selectedRole;
    const matchesStatus = selectedStatus === "all" || (user.status?.toUpperCase() === "ACTIVE" ? "Active" : "Inactive") === selectedStatus;
    return matchesSearch && matchesRole && matchesStatus;
  });

  const userCounts = {
    total: users.length,
    admin: users.filter((u) => u.role === "ADMIN").length,
    teacher: users.filter((u) => u.role === "TEACHER").length,
    registrar: users.filter((u) => u.role === "REGISTRAR").length,
    active: users.filter((u) => u.status?.toUpperCase() === "ACTIVE").length,
  };

  const openViewDialog = (user: AdminUser) => {
    setSelectedUser(user);
    setIsViewOpen(true);
  };

  const pagination = usePagination({ totalRows: filteredUsers.length });

  const columns: TableColumn<AdminUser>[] = [
    {
      key: "user",
      header: "User",
      skeleton: "avatar",
      cell: (user) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10 ring-2 ring-offset-2 ring-border">
            <AvatarFallback className="text-white font-semibold" style={{ backgroundColor: colors.primary }}>
              {(user.firstName?.[0] || "U")}{(user.lastName?.[0] || "")}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-semibold text-foreground">
              {user.firstName || ""} {user.lastName || ""}
            </p>
            {user.email && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Mail className="w-3 h-3" />
                {user.email}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "employeeId",
      header: "Employee ID",
      skeleton: "number",
      cell: (user) => (
        <span className="font-mono text-sm text-muted-foreground">
          {user.enrollpro?.employeeId || user.teacher?.employeeId || user.username}
        </span>
      ),
    },
    {
      key: "role",
      header: "Role",
      skeleton: "badge",
      cell: (user) => (
        <Badge className={`font-medium flex items-center gap-1 w-fit ${roleClasses[user.role] || "bg-primary/10 text-primary border-0"}`}>
          {roleIcons[user.role]}
          {roleLabels[user.role]}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      skeleton: "badge",
      cell: (user) =>
        user.status?.toUpperCase() === "ACTIVE" ? (
          <Badge className="border-0 font-medium" style={{ backgroundColor: `${colors.primary}15`, color: colors.primary }}>
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Active
          </Badge>
        ) : (
          <Badge className="bg-muted text-muted-foreground border-0 font-medium">
            <XCircle className="w-3 h-3 mr-1" />
            Inactive
          </Badge>
        ),
    },
    {
      key: "lastActive",
      header: "Updated",
      skeleton: "date",
      cell: (user) => (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Calendar className="w-3.5 h-3.5" />
          {user.lastActive}
        </div>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      className: "text-right",
      cell: (user) => (
        <div className="flex items-center justify-end gap-1 whitespace-nowrap">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-3 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => openViewDialog(user)}>
            <Eye className="w-4 h-4" />
            View Details
          </Button>
        </div>
      ),
    },
  ];

  const ep = selectedUser?.enrollpro ?? null;
  const displayName = ep
    ? [ep.firstName, ep.middleName, ep.lastName].filter(Boolean).join(" ")
    : `${selectedUser?.firstName ?? ""} ${selectedUser?.lastName ?? ""}`.trim();
  const employmentStatus =
    ep?.isActive === true ? "Active" : ep?.isActive === false ? "Inactive" : null;

  if (error) {
    return (
      <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
        <PageError
          title="Unable to Load Users"
          message={error}
          onRetry={fetchUsers}
          retryLabel="Retry"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
      <PageHeader
        title="Users"
        description="View system users and their EnrollPro personnel profiles"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={fetchUsers}
            disabled={loading}
            className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {/* Trust strip */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border-2 border-primary/20 bg-primary/5 px-4 py-3 text-sm">
        <Link2 className="w-4 h-4 text-primary" />
        <span className="text-foreground">
          <strong>Accounts are provisioned in EnrollPro</strong> — this page is read-only.
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Total Users" value={userCounts.total} numericValue={userCounts.total} icon={<Users className="w-5 h-5 text-muted-foreground" />} />
        <StatCard label="Admins" value={userCounts.admin} numericValue={userCounts.admin} icon={<Shield className="w-5 h-5" style={{ color: colors.primary }} />} iconClassName="bg-primary/10" />
        <StatCard label="Teachers" value={userCounts.teacher} numericValue={userCounts.teacher} icon={<UserCheck className="w-5 h-5" style={{ color: colors.secondary }} />} iconClassName="bg-secondary/10" />
        <StatCard label="Registrars" value={userCounts.registrar} numericValue={userCounts.registrar} icon={<ClipboardList className="w-5 h-5" style={{ color: colors.accent }} />} iconClassName="bg-accent/10" />
        <StatCard label="Active" value={userCounts.active} numericValue={userCounts.active} icon={<CheckCircle2 className="w-5 h-5" style={{ color: colors.secondary }} />} iconClassName="bg-secondary/10" />
      </div>

      <DataTable
        columns={columns}
        rows={filteredUsers}
        loading={loading}
        title="All Users"
        description={`${filteredUsers.length} user${filteredUsers.length !== 1 ? "s" : ""} found`}
        emptyTitle="No users found"
        emptyHint="Try adjusting your search or filters"
        emptySearchTerm={searchQuery}
        rowKey={(user) => user.id}
        pagination={pagination}
        toolbar={
          <TableToolbar
            searchPlaceholder="Search users..."
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            filters={[
              {
                label: "Role",
                value: selectedRole,
                onChange: setSelectedRole,
                options: [
                  { label: "All Roles", value: "all" },
                  { label: "Administrator", value: "ADMIN" },
                  { label: "Teacher", value: "TEACHER" },
                  { label: "Registrar", value: "REGISTRAR" },
                ],
              },
              {
                label: "Status",
                value: selectedStatus,
                onChange: setSelectedStatus,
                options: [
                  { label: "All Status", value: "all" },
                  { label: "Active", value: "Active" },
                  { label: "Inactive", value: "Inactive" },
                ],
              },
            ]}
          />
        }
      />

      {/* View User Dialog */}
      <AppModal
        open={isViewOpen}
        onOpenChange={setIsViewOpen}
        size="lg"
        icon={<Eye className="w-6 h-6" />}
        title="User Details"
        hideFooter
      >
        {selectedUser && (
          <div className="space-y-4">
            {/* Identity */}
            <div className="flex items-start gap-4">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="text-white text-xl font-semibold" style={{ backgroundColor: colors.primary }}>
                  {(selectedUser.firstName?.[0] || "U")}{(selectedUser.lastName?.[0] || "")}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <h3 className="text-xl font-bold text-foreground truncate">{displayName || selectedUser.username}</h3>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Badge className={`font-medium ${roleClasses[selectedUser.role] || "bg-primary/10 text-primary border-0"}`}>
                    {roleIcons[selectedUser.role]}
                    <span className="ml-1">{roleLabels[selectedUser.role]}</span>
                  </Badge>
                  {selectedUser.status?.toUpperCase() === "ACTIVE" ? (
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Active</Badge>
                  ) : (
                    <Badge variant="outline" className="bg-muted text-muted-foreground border-border">Inactive</Badge>
                  )}
                  {ep && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                      <Link2 className="w-3 h-3" /> Synced from EnrollPro
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Account (SMART) */}
            <DetailSection title="System Account" icon={<Shield className="w-4 h-4 text-muted-foreground" />}>
              <Field label="Username" value={selectedUser.username} />
              <Field label="Role" value={roleLabels[selectedUser.role] || selectedUser.role} />
              <Field label="Account Status" value={selectedUser.status} />
              <Field label="Date Created" value={new Date(selectedUser.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} />
            </DetailSection>

            {/* Personnel (EnrollPro) */}
            <DetailSection title="Personnel Profile (EnrollPro)" icon={<BadgeCheck className="w-4 h-4 text-muted-foreground" />}>
              <Field label="Employee ID" value={ep?.employeeId || selectedUser.teacher?.employeeId} />
              <Field
                label="Employment Status"
                value={
                  employmentStatus ? (
                    <Badge variant="outline" className={employmentStatus === "Active" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-muted text-muted-foreground border-border"}>
                      {employmentStatus}
                    </Badge>
                  ) : null
                }
              />
              <Field
                label="Email"
                value={
                  selectedUser.email && (
                    <span className="inline-flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                      {selectedUser.email}
                    </span>
                  )
                }
              />
              <Field
                label="Contact Number"
                value={ep?.contactNumber && (
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                    {ep.contactNumber}
                  </span>
                )}
              />
              <Field label="Sex" value={ep?.sex} />
              <Field label="Specialization" value={ep?.specialization || selectedUser.teacher?.specialization} />
              <Field
                label="Designation"
                value={
                  ep?.designationTitle && (
                    <span className="inline-flex items-center gap-1.5">
                      <Briefcase className="w-3.5 h-3.5 text-muted-foreground" />
                      {ep.designationTitle}
                    </span>
                  )
                }
              />
              <Field label="Plantilla Position" value={ep?.plantillaPosition} />
              <Field
                label="Department"
                value={
                  ep?.department && (
                    <span className="inline-flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                      {ep.department}
                    </span>
                  )
                }
              />
            </DetailSection>

            {/* Teaching */}
            {selectedUser.role === "TEACHER" && (
              <DetailSection title="Teaching" icon={<ClipboardList className="w-4 h-4 text-muted-foreground" />}>
                <Field label="Active Class Assignments" value={String(selectedUser.activeAssignments ?? 0)} />
                <Field
                  label="Teaching Load"
                  value={
                    <Link to="/admin/assignments" className="text-primary hover:underline text-sm font-medium">
                      View teaching load →
                    </Link>
                  }
                />
              </DetailSection>
            )}

            {!ep && selectedUser.role === "TEACHER" && (
              <p className="text-xs text-muted-foreground">
                No linked EnrollPro personnel record found for this teacher. The profile may not be synced yet.
              </p>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4 border-t border-border">
              <Button variant="outline" className="rounded-xl" onClick={() => setIsViewOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </AppModal>
    </div>
  );
}
