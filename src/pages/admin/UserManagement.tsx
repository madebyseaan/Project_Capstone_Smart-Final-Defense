import { useState, useEffect } from "react";
import {
  Users,
  Plus,
  Eye,
  Edit,
  Shield,
  UserCheck,
  ClipboardList,
  CheckCircle2,
  XCircle,
  Mail,
  Calendar,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Trash2,
  Save,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { adminApi } from "@/lib/api";
import type { AdminUser } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { TableToolbar } from "@/components/data-table/TableToolbar";
import { EmptyState } from "@/components/data-table/TableStates";

const roleLabels: Record<string, string> = {
  ADMIN: "Administrator",
  TEACHER: "Teacher",
  REGISTRAR: "Registrar",
};

const roleOpacity: Record<string, string> = {
  ADMIN: "18",
  TEACHER: "28",
  REGISTRAR: "38",
};

const roleIcons: Record<string, React.ReactNode> = {
  ADMIN: <Shield className="w-3.5 h-3.5" />,
  TEACHER: <UserCheck className="w-3.5 h-3.5" />,
  REGISTRAR: <ClipboardList className="w-3.5 h-3.5" />,
};

interface UserFormData {
  username: string;
  password: string;
  role: string;
  firstName: string;
  lastName: string;
  email: string;
  employeeId: string;
  specialization: string;
}

const initialFormData: UserFormData = {
  username: "",
  password: "",
  role: "TEACHER",
  firstName: "",
  lastName: "",
  email: "",
  employeeId: "",
  specialization: "",
};

export default function UserManagement() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { colors } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRole, setSelectedRole] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [formData, setFormData] = useState<UserFormData>(initialFormData);
  const [saving, setSaving] = useState(false);

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
    const matchesStatus = selectedStatus === "all" || user.status === selectedStatus;
    return matchesSearch && matchesRole && matchesStatus;
  });

  const userCounts = {
    total: users.length,
    admin: users.filter((u) => u.role === "ADMIN").length,
    teacher: users.filter((u) => u.role === "TEACHER").length,
    registrar: users.filter((u) => u.role === "REGISTRAR").length,
    active: users.filter((u) => u.status === "Active").length,
  };

  const handleCreate = async () => {
    try {
      setSaving(true);
      await adminApi.createUser({
        username: formData.username,
        password: formData.password,
        role: formData.role,
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email || undefined,
        employeeId: formData.role === "TEACHER" ? formData.employeeId : undefined,
        specialization: formData.role === "TEACHER" ? formData.specialization : undefined,
      });
      setIsCreateOpen(false);
      setFormData(initialFormData);
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to create user");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedUser) return;
    try {
      setSaving(true);
      await adminApi.updateUser(selectedUser.id, {
        username: formData.username,
        password: formData.password || undefined,
        role: formData.role,
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email || undefined,
        employeeId: formData.role === "TEACHER" ? formData.employeeId : undefined,
        specialization: formData.role === "TEACHER" ? formData.specialization : undefined,
      });
      setIsEditOpen(false);
      setSelectedUser(null);
      setFormData(initialFormData);
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to update user");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedUser) return;
    try {
      setSaving(true);
      await adminApi.deleteUser(selectedUser.id);
      setIsDeleteOpen(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to delete user");
    } finally {
      setSaving(false);
    }
  };

  const openEditDialog = (user: AdminUser) => {
    setSelectedUser(user);
    setFormData({
      username: user.username,
      password: "",
      role: user.role,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email || "",
      employeeId: user.teacher?.employeeId || "",
      specialization: user.teacher?.specialization || "",
    });
    setIsEditOpen(true);
  };

  const openViewDialog = (user: AdminUser) => {
    setSelectedUser(user);
    setIsViewOpen(true);
  };

  const openDeleteDialog = (user: AdminUser) => {
    setSelectedUser(user);
    setIsDeleteOpen(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading users...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500" />
          <p className="text-foreground font-medium">{error}</p>
          <Button onClick={fetchUsers} variant="outline" className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Management"
        description="Manage system users and their access permissions"
        actions={
          <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Add User
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Total Users" value={userCounts.total} icon={<Users className="w-5 h-5 text-muted-foreground" />} />
        <StatCard label="Admins" value={userCounts.admin} icon={<Shield className="w-5 h-5" style={{ color: colors.primary }} />} iconClassName="bg-primary/10" />
        <StatCard label="Teachers" value={userCounts.teacher} icon={<UserCheck className="w-5 h-5" style={{ color: colors.secondary }} />} iconClassName="bg-secondary/10" />
        <StatCard label="Registrars" value={userCounts.registrar} icon={<ClipboardList className="w-5 h-5" style={{ color: colors.accent }} />} iconClassName="bg-accent/10" />
        <StatCard label="Active" value={userCounts.active} icon={<CheckCircle2 className="w-5 h-5" style={{ color: colors.secondary }} />} iconClassName="bg-secondary/10" />
      </div>

      <Card className="border-0 shadow-lg shadow-muted/50 rounded-xl bg-card p-0">
        <div className="px-6 py-4 border-b border-border">
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
        </div>
        <div className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-[52px]">User</TableHead>
                  <TableHead>Employee ID</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.length === 0 ? (
                  <EmptyState
                    title="No users found"
                    hint="Try adjusting your search or filters"
                    icon={<Users className="w-10 h-10 text-muted-foreground/50" />}
                    columnCount={6}
                  />
                ) : (
                  filteredUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
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
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {user.teacher?.employeeId || user.username}
                      </TableCell>
                      <TableCell>
                        <Badge className="border-0 font-medium flex items-center gap-1 w-fit" style={{ backgroundColor: `${colors.primary}${roleOpacity[user.role] || '18'}`, color: colors.primary }}>
                          {roleIcons[user.role]}
                          {roleLabels[user.role]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {user.status === "Active" ? (
                          <Badge className="border-0 font-medium" style={{ backgroundColor: `${colors.primary}15`, color: colors.primary }}>
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Active
                          </Badge>
                        ) : (
                          <Badge className="bg-muted text-muted-foreground border-0 font-medium">
                            <XCircle className="w-3 h-3 mr-1" />
                            Inactive
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Calendar className="w-3.5 h-3.5" />
                          {user.lastActive}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 px-3"
                          onClick={() => openViewDialog(user)}
                        >
                          <Eye className="w-4 h-4" />
                          View Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-[500px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <Plus className="w-5 h-5 text-primary" />
              </div>
              Create New User
            </DialogTitle>
            <DialogDescription>
              Add a new user to the system. Fill in all required fields.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  placeholder="Juan"
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  placeholder="Dela Cruz"
                  className="rounded-xl"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">Username *</Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                placeholder="jdelacruz"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password *</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="••••••••"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="jdelacruz@school.edu.ph"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role *</Label>
              <Select value={formData.role} onValueChange={(val) => val && setFormData({ ...formData, role: val })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TEACHER">Teacher</SelectItem>
                  <SelectItem value="REGISTRAR">Registrar</SelectItem>
                  <SelectItem value="ADMIN">Administrator</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.role === "TEACHER" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="employeeId">Employee ID *</Label>
                  <Input
                    id="employeeId"
                    value={formData.employeeId}
                    onChange={(e) => setFormData({ ...formData, employeeId: e.target.value })}
                    placeholder="EMP-2025-001"
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="specialization">Specialization</Label>
                  <Input
                    id="specialization"
                    value={formData.specialization}
                    onChange={(e) => setFormData({ ...formData, specialization: e.target.value })}
                    placeholder="e.g., Mathematics, English"
                    className="rounded-xl"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)} className="rounded-xl">
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={saving || !formData.username || !formData.password || !formData.firstName || !formData.lastName || (formData.role === "TEACHER" && !formData.employeeId)}
              className="gap-2 text-white rounded-xl"
              style={{ backgroundColor: colors.primary }}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Create User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[500px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <Edit className="w-5 h-5 text-primary" />
              </div>
              Edit User
            </DialogTitle>
            <DialogDescription>
              Update user information. Leave password empty to keep current password.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="editFirstName">First Name *</Label>
                <Input
                  id="editFirstName"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editLastName">Last Name *</Label>
                <Input
                  id="editLastName"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  className="rounded-xl"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="editUsername">Username *</Label>
              <Input
                id="editUsername"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editPassword">New Password (leave empty to keep current)</Label>
              <Input
                id="editPassword"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="••••••••"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editEmail">Email</Label>
              <Input
                id="editEmail"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editRole">Role *</Label>
              <Select value={formData.role} onValueChange={(val) => val && setFormData({ ...formData, role: val })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TEACHER">Teacher</SelectItem>
                  <SelectItem value="REGISTRAR">Registrar</SelectItem>
                  <SelectItem value="ADMIN">Administrator</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.role === "TEACHER" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="editEmployeeId">Employee ID *</Label>
                  <Input
                    id="editEmployeeId"
                    value={formData.employeeId}
                    onChange={(e) => setFormData({ ...formData, employeeId: e.target.value })}
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editSpecialization">Specialization</Label>
                  <Input
                    id="editSpecialization"
                    value={formData.specialization}
                    onChange={(e) => setFormData({ ...formData, specialization: e.target.value })}
                    className="rounded-xl"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)} className="rounded-xl">
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={saving || !formData.username || !formData.firstName || !formData.lastName}
              className="gap-2 text-white rounded-xl"
              style={{ backgroundColor: colors.primary }}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View User Dialog */}
      <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
        <DialogContent className="sm:max-w-[450px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-secondary/10">
                <Eye className="w-5 h-5 text-secondary" />
              </div>
              User Details
            </DialogTitle>
          </DialogHeader>
          {selectedUser && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  <AvatarFallback className="text-white text-xl font-semibold" style={{ backgroundColor: colors.primary }}>
                    {(selectedUser.firstName?.[0] || "U")}{(selectedUser.lastName?.[0] || "")}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="text-xl font-bold text-foreground">
                    {selectedUser.firstName} {selectedUser.lastName}
                  </h3>
                  <Badge className="border-0 mt-1" style={{ backgroundColor: `${colors.primary}${roleOpacity[selectedUser.role] || '18'}`, color: colors.primary }}>
                    {roleIcons[selectedUser.role]}
                    <span className="ml-1">{roleLabels[selectedUser.role]}</span>
                  </Badge>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
                <div>
                  <p className="text-xs text-muted-foreground">Employee ID</p>
                  <p className="font-mono font-medium">{selectedUser.teacher?.employeeId || selectedUser.username}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p className="font-medium">{selectedUser.email || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge className={selectedUser.status === "Active" ? "border-0" : "bg-muted text-muted-foreground border-0"} style={selectedUser.status === "Active" ? { backgroundColor: `${colors.primary}15`, color: colors.primary } : undefined}>
                    {selectedUser.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Last Active</p>
                  <p className="font-medium">{selectedUser.lastActive}</p>
                </div>
                {selectedUser.teacher?.specialization && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Specialization</p>
                    <p className="font-medium">{selectedUser.teacher.specialization}</p>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsViewOpen(false)} className="rounded-xl">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-[400px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <div className="p-2 rounded-lg bg-destructive/10">
                <Trash2 className="w-5 h-5 text-destructive" />
              </div>
              Delete User
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this user? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {selectedUser && (
            <div className="py-4">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="text-white font-semibold" style={{ backgroundColor: colors.primary }}>
                    {(selectedUser.firstName?.[0] || "U")}{(selectedUser.lastName?.[0] || "")}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold">{selectedUser.firstName} {selectedUser.lastName}</p>
                  <p className="text-sm text-muted-foreground">@{selectedUser.username}</p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)} className="rounded-xl">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={saving}
              className="gap-2 rounded-xl"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Delete User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
