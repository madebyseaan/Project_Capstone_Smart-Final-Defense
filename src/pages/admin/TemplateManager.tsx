import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Upload, FileSpreadsheet, Download, Trash2, Power, Info, AlertCircle, CheckCircle2, Eye, Search, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';
import ExcelRenderer from '@/components/ExcelRenderer';
import { getPortalToken } from "@/lib/api";
import { PageHeader } from "@/components/layout/PageHeader";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

interface ExcelTemplate {
  id: string;
  formType: string;
  formName: string;
  description: string | null;
  filePath: string;
  fileName: string;
  fileSize: number;
  sheetName: string | null;
  placeholders: string[] | null;
  instructions: string | null;
  isActive: boolean;
  uploadedBy: string;
  uploadedByName: string;
  createdAt: string;
  updatedAt: string;
}

interface TemplatePreviewSheet {
  sheetName: string;
  isMappedSheet: boolean;
  totalRows: number;
  previewRows: string[][];
}

interface TemplatePreviewData {
  templateId: string;
  formType: string;
  formName: string;
  fileName: string;
  mappedSheetName: string | null;
  maxRows: number;
  maxCols: number;
  sheets: TemplatePreviewSheet[];
}

const FORM_TYPES = [
  {
    value: 'SF1_7_BUNDLE',
    label: 'SF1-SF7 Bundle (All-in-One Workbook)',
    description: 'Upload one workbook containing sheets for SF1 to SF7',
    isBundle: true
  },
  {
    value: 'SF1_10_BUNDLE',
    label: 'SF1-SF10 Bundle (All-in-One Workbook)',
    description: 'Upload one workbook containing sheets for SF1 to SF10',
    isBundle: true
  },
  { value: 'SF1', label: 'SF1 - School Register (Student Master List)', description: 'Complete roster of all enrolled students' },
  { value: 'SF2', label: 'SF2 - Daily Attendance Record', description: 'Daily attendance tracking with P/A/L/E marks' },
  { value: 'SF3', label: 'SF3 - Individual Learner Monitoring', description: 'Track individual student progress' },
  { value: 'SF4', label: 'SF4 - Quarterly Assessment Report', description: 'Quarter exam results and assessments' },
  { value: 'SF5', label: 'SF5 - Promotion/Completion Report', description: 'End of year advancement report' },
  { value: 'SF6', label: 'SF6 - Learner Information System', description: 'Comprehensive learner data' },
  { value: 'SF7', label: 'SF7 - School Personnel Assignment List', description: 'Personnel assignments and profiles' },
  { value: 'SF8', label: 'SF8 - Learner Basic Health and Nutrition Report', description: 'Learner health and nutritional status reporting form' },
  { value: 'SF9', label: 'SF9 - Progress Report (JHS/SHS)', description: 'Report card for junior and senior high school students' },
  { value: 'SF10', label: 'SF10 - Learner\'s Permanent Record', description: 'Student transcript and permanent record' }
];

export default function TemplateManager() {
  const [templates, setTemplates] = useState<ExcelTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [infoDialogOpen, setInfoDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<ExcelTemplate | null>(null);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewData, setPreviewData] = useState<TemplatePreviewData | null>(null);
  const [selectedPreviewSheet, setSelectedPreviewSheet] = useState('');
  const [styledPreviewData, setStyledPreviewData] = useState<any>(null);
  const [previewScale, setPreviewScale] = useState(0.7);
  const [viewMode, setViewMode] = useState<'styled' | 'simple'>('styled');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [formFilter, setFormFilter] = useState('ALL');
  
  // Upload form state
  const [uploadFormType, setUploadFormType] = useState('');
  const [uploadFormName, setUploadFormName] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadInstructions, setUploadInstructions] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    fetchTemplates();
  }, []);

  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      const matchesSearch =
        !searchQuery.trim() ||
        template.formName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        template.formType.toLowerCase().includes(searchQuery.toLowerCase()) ||
        template.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        template.uploadedByName.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' && template.isActive) ||
        (statusFilter === 'INACTIVE' && !template.isActive);

      const matchesForm = formFilter === 'ALL' || template.formType === formFilter;
      return matchesSearch && matchesStatus && matchesForm;
    });
  }, [templates, searchQuery, statusFilter, formFilter]);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      setLoadError('');
      const token = getPortalToken();
      const response = await axios.get(`${SERVER_URL}/api/templates`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTemplates(response.data.data || []);
    } catch (error: any) {
      console.error('Failed to fetch templates:', error);
      const status = error?.response?.status;
      const message = error?.response?.data?.message || error?.response?.data?.error;
      if (status === 401 || status === 403) {
        setLoadError('Session expired or invalid token. Please log out and log in again, then refresh this page.');
      } else {
        setLoadError(message || 'Failed to load SF templates from server.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadFormType || !uploadFormName || !uploadFile) {
      setUploadError('Please fill in all required fields and select a file');
      return;
    }

    // Check for existing templates
    const existingTemplates: string[] = [];
    if (uploadFormType === 'SF1_10_BUNDLE' || uploadFormType === 'SF1_7_BUNDLE') {
      const bundleForms = uploadFormType === 'SF1_7_BUNDLE'
        ? ['SF1', 'SF2', 'SF3', 'SF4', 'SF5', 'SF6', 'SF7']
        : ['SF1', 'SF2', 'SF3', 'SF4', 'SF5', 'SF6', 'SF7', 'SF8', 'SF9', 'SF10'];
      bundleForms.forEach(formType => {
        if (templates.some(t => t.formType === formType)) {
          existingTemplates.push(formType);
        }
      });
    } else {
      if (templates.some(t => t.formType === uploadFormType)) {
        existingTemplates.push(uploadFormType);
      }
    }

    if (existingTemplates.length > 0) {
      const confirmed = window.confirm(
        `WARNING: The following form template(s) already exist: ${existingTemplates.join(', ')}\n\n` +
        `Uploading will REPLACE the existing template(s).\n\n` +
        `Do you want to continue and overwrite?`
      );
      if (!confirmed) {
        return;
      }
    }

    try {
      setUploading(true);
      setUploadError('');
      setUploadSuccess('');

      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('formName', uploadFormName);

      if (uploadFormType === 'SF1_10_BUNDLE' || uploadFormType === 'SF1_7_BUNDLE') {
        const selectedBundleForms = uploadFormType === 'SF1_7_BUNDLE'
          ? ['SF1', 'SF2', 'SF3', 'SF4', 'SF5', 'SF6', 'SF7']
          : ['SF1', 'SF2', 'SF3', 'SF4', 'SF5', 'SF6', 'SF7', 'SF8', 'SF9', 'SF10'];
        formData.append('uploadMode', 'bundle');
        formData.append('formType', uploadFormType);
        formData.append('formTypes', JSON.stringify(selectedBundleForms));
      } else {
        formData.append('uploadMode', 'single');
        formData.append('formType', uploadFormType);
      }

      if (uploadDescription) formData.append('description', uploadDescription);
      if (uploadInstructions) formData.append('instructions', uploadInstructions);

      const token = getPortalToken();
      const response = await axios.post(`${SERVER_URL}/api/templates/upload`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      });

      setUploadSuccess(response.data.message || 'Template uploaded successfully');
      
      // Refresh template list
      await fetchTemplates();
      
      // Reset form
      setTimeout(() => {
        setUploadDialogOpen(false);
        setUploadFormType('');
        setUploadFormName('');
        setUploadDescription('');
        setUploadInstructions('');
        setUploadFile(null);
        setUploadSuccess('');
      }, 2000);

    } catch (error: any) {
      console.error('Upload failed:', error);
      const errorData = error.response?.data;
      let errorMessage = errorData?.error || 'Failed to upload template';
      
      if (errorData?.missingForms && errorData?.availableSheets) {
        errorMessage += `\n\nCould not map: ${errorData.missingForms.join(', ')}`;
        errorMessage += `\n\nAvailable sheets in file: ${errorData.availableSheets.join(', ')}`;
        errorMessage += '\n\nPlease ensure your workbook sheet names clearly identify each form (e.g., "SF8", "Nutritional Status", "SF9", "front/back" for SF10).';
      }
      
      setUploadError(errorMessage);
    } finally {
      setUploading(false);
    }
  };

  const handleToggleActive = async (template: ExcelTemplate) => {
    try {
      const token = getPortalToken();
      await axios.post(`${SERVER_URL}/api/templates/${template.id}/toggle`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      await fetchTemplates();
    } catch (error: any) {
      console.error('Failed to toggle template:', error);
      alert(error.response?.data?.error || 'Failed to toggle template');
    }
  };

  const handleDelete = async (template: ExcelTemplate) => {
    if (!confirm(`Are you sure you want to delete the ${template.formName} template?`)) {
      return;
    }

    try {
      const token = getPortalToken();
      await axios.delete(`${SERVER_URL}/api/templates/${template.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      await fetchTemplates();
    } catch (error: any) {
      console.error('Failed to delete template:', error);
      alert(error.response?.data?.error || 'Failed to delete template');
    }
  };

  const toggleTemplateSelection = (templateId: string) => {
    setSelectedTemplateIds((prev) =>
      prev.includes(templateId) ? prev.filter((id) => id !== templateId) : [...prev, templateId]
    );
  };

  const handleToggleSelectAll = () => {
    const filteredIds = filteredTemplates.map((template) => template.id);
    const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedTemplateIds.includes(id));

    if (allFilteredSelected) {
      setSelectedTemplateIds((prev) => prev.filter((id) => !filteredIds.includes(id)));
      return;
    }

    setSelectedTemplateIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
  };

  const handleDeleteSelected = async () => {
    if (selectedTemplateIds.length === 0) return;

    const confirmed = window.confirm(
      `Delete ${selectedTemplateIds.length} selected template(s)? This action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      setBulkDeleting(true);
      const token = getPortalToken();
      await Promise.all(
        selectedTemplateIds.map((templateId) =>
          axios.delete(`${SERVER_URL}/api/templates/${templateId}`, {
            headers: { Authorization: `Bearer ${token}` }
          })
        )
      );
      setSelectedTemplateIds([]);
      await fetchTemplates();
    } catch (error: any) {
      console.error('Failed to delete selected templates:', error);
      alert(error.response?.data?.error || 'Failed to delete selected templates');
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleDeleteAllTemplates = async () => {
    if (filteredTemplates.length === 0) return;

    const confirmed = window.confirm(
      `Delete ALL ${filteredTemplates.length} template(s) in current view? This action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      setBulkDeleting(true);
      const token = getPortalToken();
      await Promise.all(
        filteredTemplates.map((template) =>
          axios.delete(`${SERVER_URL}/api/templates/${template.id}`, {
            headers: { Authorization: `Bearer ${token}` }
          })
        )
      );
      setSelectedTemplateIds([]);
      await fetchTemplates();
    } catch (error: any) {
      console.error('Failed to delete all templates:', error);
      alert(error.response?.data?.error || 'Failed to delete all templates');
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleDownload = async (template: ExcelTemplate) => {
    try {
      const token = getPortalToken();
      const response = await axios.get(`${SERVER_URL}/api/templates/${template.formType}/download`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob'
      });

      // Create clean, descriptive filename
      const cleanFileName = `${template.formType}-${template.formName.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_')}.xlsx`;

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', cleanFileName);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error: any) {
      console.error('Failed to download template:', error);
      alert('Failed to download template');
    }
  };

  const showInfo = (template: ExcelTemplate) => {
    setSelectedTemplate(template);
    setInfoDialogOpen(true);
  };

  const handleViewTemplate = async (template: ExcelTemplate) => {
    try {
      setPreviewLoading(true);
      setPreviewError('');
      setPreviewData(null);
      setStyledPreviewData(null);
      setSelectedPreviewSheet('');
      setPreviewDialogOpen(true);
      setViewMode('styled');
      setPreviewScale(0.7);

      const token = getPortalToken();
      
      // Load styled preview first (pixel-perfect rendering)
      try {
        const styledResponse = await axios.get(`${SERVER_URL}/api/templates/${template.id}/styled-preview`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setStyledPreviewData(styledResponse.data.data);
        setSelectedPreviewSheet(styledResponse.data.data.parsedStructure.sheets[0]?.name || '');
      } catch (styledError) {
        console.warn('Styled preview not available, falling back to simple view:', styledError);
        setViewMode('simple');
      }
      
      // Also load simple preview as fallback
      const response = await axios.get(`${SERVER_URL}/api/templates/${template.id}/preview`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const loadedData = response.data.data as TemplatePreviewData;
      setPreviewData(loadedData);
      if (!styledPreviewData) {
        setSelectedPreviewSheet(loadedData.sheets[0]?.sheetName || '');
      }
    } catch (error: any) {
      console.error('Failed to load template preview:', error);
      setPreviewError(error.response?.data?.error || 'Failed to load template preview');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleOpenExactWorkbook = async () => {
    if (!previewData) return;

    try {
      const token = getPortalToken();
      const response = await axios.get(`${SERVER_URL}/api/templates/${previewData.formType}/download`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob'
      });

      // Create clean, descriptive filename
      const cleanFileName = `${previewData.formType}-${previewData.formName.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_')}.xlsx`;

      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = window.URL.createObjectURL(blob);

      // Try opening first so systems with Excel web handler can preview directly.
      const opened = window.open(url, '_blank');

      // Always provide a fallback download for exact desktop viewing/printing.
      if (!opened) {
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', cleanFileName);
        document.body.appendChild(link);
        link.click();
        link.remove();
      }

      window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (error: any) {
      console.error('Failed to open exact workbook:', error);
      setPreviewError(error.response?.data?.error || 'Failed to open workbook file');
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Excel Template Manager"
        description="Upload, review, and maintain DepEd School Form templates"
      />

      {/* Template System Benefits - Moved up */}
      <Card className="p-6 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="space-y-2">
            <h3 className="font-semibold text-blue-900 dark:text-blue-100">Why Use Templates?</h3>
            <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1.5">
              <li>• <strong>Automatic Form Filling:</strong> Upload your Excel format once, and the system fills it with student data automatically</li>
              <li>• <strong>No Programming Needed:</strong> Change your form layout anytime by uploading a new template—no code required</li>
              <li>• <strong>Smart Placeholders:</strong> Use markers like <code className="bg-blue-100 dark:bg-blue-900 px-1.5 py-0.5 rounded text-xs">{'{{SCHOOL_NAME}}'}</code> that get replaced with real school information</li>
              <li>• <strong>Bulk Student Data:</strong> List all students by wrapping with <code className="bg-blue-100 dark:bg-blue-900 px-1.5 py-0.5 rounded text-xs">{'{{#STUDENTS}}'}</code> and <code className="bg-blue-100 dark:bg-blue-900 px-1.5 py-0.5 rounded text-xs">{'{{/STUDENTS}}'}</code></li>
            </ul>
          </div>
        </div>
      </Card>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-5 hover:shadow-md transition-shadow">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Templates</p>
          <p className="text-3xl font-bold mt-2">{templates.length}</p>
        </Card>
        <Card className="p-5 hover:shadow-md transition-shadow">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active</p>
          <p className="text-3xl font-bold text-green-600 mt-2">{templates.filter((t) => t.isActive).length}</p>
        </Card>
        <Card className="p-5 hover:shadow-md transition-shadow">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Filtered Results</p>
          <p className="text-3xl font-bold mt-2">{filteredTemplates.length}</p>
        </Card>
      </div>

      {/* Search and Filter Section */}
      <Card className="p-5">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={handleDeleteSelected}
              disabled={bulkDeleting || selectedTemplateIds.length === 0}
              className="h-10 text-red-600 border-red-300 hover:text-red-700"
            >
              Delete Selected ({selectedTemplateIds.length})
            </Button>
            <Button
              variant="outline"
              onClick={handleDeleteAllTemplates}
              disabled={bulkDeleting || filteredTemplates.length === 0}
              className="h-10 text-red-700 border-red-400 hover:text-red-800"
            >
              Delete All (View)
            </Button>
            <Button onClick={() => setUploadDialogOpen(true)} disabled={bulkDeleting} className="h-10">
              <Upload className="w-4 h-4 mr-2" />
              Upload Template
            </Button>
            <Button
              variant="outline"
              onClick={fetchTemplates}
              disabled={loading || bulkDeleting}
              className="h-10"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by form, template name, file, or uploader..."
              className="pl-9"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')}
            className="px-3 py-2 border rounded-md text-sm bg-white"
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
            <select
              value={formFilter}
              onChange={(e) => setFormFilter(e.target.value)}
              className="px-3 py-2 border rounded-md text-sm bg-white"
            >
              <option value="ALL">All Forms</option>
              {Array.from(new Set(templates.map((t) => t.formType))).sort().map((formType) => (
                <option key={formType} value={formType}>{formType}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          <strong>Tip:</strong> Select rows from filtered results, then click "Delete Selected" to remove multiple templates at once.
        </p>
      </Card>

      {/* Templates Table */}
      <Card className="overflow-hidden">
        {loadError && (
          <div className="m-4 flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold">Could not load templates</p>
              <p>{loadError}</p>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-center">
                <input
                  type="checkbox"
                  checked={
                    filteredTemplates.length > 0 &&
                    filteredTemplates.every((template) => selectedTemplateIds.includes(template.id))
                  }
                  onChange={handleToggleSelectAll}
                  disabled={filteredTemplates.length === 0 || bulkDeleting}
                  aria-label="Select all templates"
                />
              </TableHead>
              <TableHead>Form Type</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>File</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Uploaded By</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8">
                  Loading templates...
                </TableCell>
              </TableRow>
            ) : filteredTemplates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8">
                  <FileSpreadsheet className="w-12 h-12 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-muted-foreground">
                    {templates.length === 0 ? 'No templates uploaded yet' : 'No templates match your current filters'}
                  </p>
                  {templates.length === 0 ? (
                    <Button onClick={() => setUploadDialogOpen(true)} variant="link">
                      Upload your first template
                    </Button>
                  ) : (
                    <Button
                      onClick={() => {
                        setSearchQuery('');
                        setStatusFilter('ALL');
                        setFormFilter('ALL');
                      }}
                      variant="link"
                    >
                      Clear filters
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              filteredTemplates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="text-center">
                    <input
                      type="checkbox"
                      checked={selectedTemplateIds.includes(template.id)}
                      onChange={() => toggleTemplateSelection(template.id)}
                      disabled={bulkDeleting}
                      aria-label={`Select ${template.formType} template`}
                    />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{template.formType}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">{template.formName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4" />
                      {template.fileName}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{formatFileSize(template.fileSize)}</TableCell>
                  <TableCell className="text-sm">{template.uploadedByName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(template.updatedAt)}
                  </TableCell>
                  <TableCell>
                    {template.isActive ? (
                      <Badge variant="default" className="bg-green-600">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleViewTemplate(template)}
                        title="View Template"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => showInfo(template)}
                        title="View Details"
                      >
                        <Info className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDownload(template)}
                        title="Download Template"
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleToggleActive(template)}
                        title={template.isActive ? 'Deactivate' : 'Activate'}
                      >
                        <Power className={`w-4 h-4 ${template.isActive ? 'text-green-600' : 'text-muted-foreground'}`} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(template)}
                        title="Delete Template"
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>
      </Card>

      {/* Upload Dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="w-[95vw] max-w-[95vw] lg:max-w-[1400px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload Excel Template</DialogTitle>
            <DialogDescription>
              Upload a DepEd School Form template with placeholders for dynamic data
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            {uploadError && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold mb-1">Upload Failed</p>
                  <p className="text-sm whitespace-pre-line">{uploadError}</p>
                </div>
              </div>
            )}

            {uploadSuccess && (
              <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
                <CheckCircle2 className="w-5 h-5" />
                <p className="text-sm font-semibold">{uploadSuccess}</p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="formType" className="text-sm font-semibold">Form Type *</Label>
              <select
                id="formType"
                value={uploadFormType}
                onChange={(e) => {
                  setUploadFormType(e.target.value);
                  const selectedForm = FORM_TYPES.find((f) => f.value === e.target.value);
                  if (selectedForm && !uploadFormName) {
                    setUploadFormName(selectedForm.label);
                  } else if (selectedForm?.value === 'SF1_10_BUNDLE' || selectedForm?.value === 'SF1_7_BUNDLE') {
                    setUploadFormName(
                      selectedForm.value === 'SF1_7_BUNDLE'
                        ? 'School Forms 1-7 Bundle Template'
                        : 'School Forms 1-10 Bundle Template'
                    );
                  }
                }}
                className="w-full px-3 py-2.5 border rounded-md text-sm bg-white"
              >
                <option value="">Select a form type...</option>
                {FORM_TYPES.map((form) => (
                  <option key={form.value} value={form.value}>
                    {form.label}
                  </option>
                ))}
              </select>
              {uploadFormType && (
                <p className="text-sm text-muted-foreground">
                  {FORM_TYPES.find((f) => f.value === uploadFormType)?.description}
                </p>
              )}
              {(uploadFormType === 'SF1_10_BUNDLE' || uploadFormType === 'SF1_7_BUNDLE') && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  {uploadFormType === 'SF1_7_BUNDLE'
                    ? 'The system will auto-map sheets to SF1-SF7 using sheet names (for example, "School Form 1 (SF1)").'
                    : 'The system will auto-map sheets to SF1-SF10 using sheet names (for example, "School Form 1 (SF1)").'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="formName" className="text-sm font-semibold">Template Name *</Label>
              <Input
                id="formName"
                value={uploadFormName}
                onChange={(e) => setUploadFormName(e.target.value)}
                placeholder="e.g., School Form 2 - Daily Attendance Record"
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-semibold">Description (Optional)</Label>
              <Input
                id="description"
                value={uploadDescription}
                onChange={(e) => setUploadDescription(e.target.value)}
                placeholder="Brief description of this template"
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="instructions" className="text-sm font-semibold">Usage Instructions (Optional)</Label>
              <textarea
                id="instructions"
                value={uploadInstructions}
                onChange={(e) => setUploadInstructions(e.target.value)}
                placeholder="How to use this template and what data it expects"
                rows={4}
                className="w-full px-3 py-2 border rounded-md text-sm resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="file" className="text-sm font-semibold">Excel File *</Label>
              <Input
                id="file"
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              />
              <p className="text-sm text-muted-foreground">
                Upload an Excel file (.xlsx or .xls).
                {(uploadFormType === 'SF1_10_BUNDLE' || uploadFormType === 'SF1_7_BUNDLE')
                  ? uploadFormType === 'SF1_7_BUNDLE'
                    ? ' For all-in-one files, include separate sheets for SF1 to SF7.'
                    : ' For all-in-one files, include separate sheets for SF1 to SF10.'
                  : ` Use placeholders like {{SCHOOL_NAME}}, {{DATE}}, etc.`}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadDialogOpen(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading ? 'Uploading...' : 'Upload Template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Info Dialog */}
      <Dialog open={infoDialogOpen} onOpenChange={setInfoDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedTemplate?.formName}</DialogTitle>
            <DialogDescription>{selectedTemplate?.formType}</DialogDescription>
          </DialogHeader>

          {selectedTemplate && (
            <div className="space-y-4 py-4">
              <div>
                <Label className="text-sm font-semibold">Description</Label>
                <p className="text-sm mt-1">{selectedTemplate.description || 'No description provided'}</p>
              </div>

              <div>
                <Label className="text-sm font-semibold">File Information</Label>
                <div className="mt-1 text-sm space-y-1">
                  <p>• File: {selectedTemplate.fileName}</p>
                  <p>• Size: {formatFileSize(selectedTemplate.fileSize)}</p>
                  {selectedTemplate.sheetName && <p>• Sheet Mapping: {selectedTemplate.sheetName}</p>}
                  <p>• Uploaded by: {selectedTemplate.uploadedByName}</p>
                  <p>• Created: {formatDate(selectedTemplate.createdAt)}</p>
                  <p>• Last updated: {formatDate(selectedTemplate.updatedAt)}</p>
                </div>
              </div>

              {selectedTemplate.placeholders && selectedTemplate.placeholders.length > 0 && (
                <div>
                  <Label className="text-sm font-semibold">Available Placeholders</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {selectedTemplate.placeholders.map((placeholder) => (
                      <code key={placeholder} className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                        {`{{${placeholder}}}`}
                      </code>
                    ))}
                  </div>
                </div>
              )}

              {selectedTemplate.instructions && (
                <div>
                  <Label className="text-sm font-semibold">Instructions</Label>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{selectedTemplate.instructions}</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setInfoDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Template Preview Dialog */}
      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Template Preview</DialogTitle>
            <DialogDescription>
              {viewMode === 'styled' ? 'Pixel-perfect view matching Excel exactly' : 'Simple table view of worksheet data'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-2">
            {previewLoading && (
              <div className="flex items-center justify-center py-20">
                <div className="text-center">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-blue-600" />
                  <p className="text-sm text-muted-foreground">Loading template...</p>
                </div>
              </div>
            )}

            {previewError && (
              <div className="flex items-start gap-3 p-4 rounded-md border border-red-200 bg-red-50 text-red-700 text-sm">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Failed to load preview</p>
                  <p className="mt-1">{previewError}</p>
                </div>
              </div>
            )}

            {(styledPreviewData || previewData) && !previewLoading && (
              <>
                {/* Info and Controls */}
                <div className="space-y-3">
                  <Card className="p-3 bg-blue-50 border-blue-200">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm space-y-1 flex-1">
                        <p><span className="font-semibold">Template:</span> {styledPreviewData?.formName || previewData?.formName}</p>
                        <p><span className="font-semibold">Form Type:</span> {styledPreviewData?.formType || previewData?.formType}</p>
                        <p><span className="font-semibold">File:</span> {styledPreviewData?.fileName || previewData?.fileName}</p>
                      </div>
                      <Button size="sm" onClick={handleOpenExactWorkbook} variant="outline">
                        <Download className="w-4 h-4 mr-2" />
                        Download Excel
                      </Button>
                    </div>
                  </Card>

                  {/* View Mode Toggle and Controls */}
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={viewMode === 'styled' ? 'default' : 'outline'}
                        onClick={() => setViewMode('styled')}
                        disabled={!styledPreviewData}
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        Styled View
                      </Button>
                      <Button
                        size="sm"
                        variant={viewMode === 'simple' ? 'default' : 'outline'}
                        onClick={() => setViewMode('simple')}
                      >
                        <FileSpreadsheet className="w-4 h-4 mr-2" />
                        Simple View
                      </Button>
                    </div>

                    {viewMode === 'styled' && styledPreviewData && (
                      <div className="flex items-center gap-2 ml-auto">
                        <span className="text-xs text-muted-foreground">
                          Zoom: {Math.round(previewScale * 100)}%
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPreviewScale(prev => Math.max(prev - 0.1, 0.3))}
                          disabled={previewScale <= 0.3}
                        >
                          <ZoomOut className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPreviewScale(1)}
                        >
                          Reset
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPreviewScale(prev => Math.min(prev + 0.1, 1.5))}
                          disabled={previewScale >= 1.5}
                        >
                          <ZoomIn className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Sheet Selection */}
                  {((viewMode === 'styled' && styledPreviewData?.parsedStructure.sheets.length > 1) ||
                    (viewMode === 'simple' && previewData?.sheets.length > 1)) && (
                    <div className="space-y-2">
                      <Label htmlFor="previewSheet" className="text-sm font-semibold">Worksheet</Label>
                      <select
                        id="previewSheet"
                        value={selectedPreviewSheet}
                        onChange={(e) => setSelectedPreviewSheet(e.target.value)}
                        className="w-full px-3 py-2 border rounded-md text-sm bg-white"
                      >
                        {viewMode === 'styled' && styledPreviewData?.parsedStructure.sheets.map((sheet: any) => (
                          <option key={sheet.name} value={sheet.name}>
                            {sheet.name}
                            {styledPreviewData.mappedSheetName === sheet.name ? ' (Mapped)' : ''}
                          </option>
                        ))}
                        {viewMode === 'simple' && previewData?.sheets.map((sheet) => (
                          <option key={sheet.sheetName} value={sheet.sheetName}>
                            {sheet.sheetName}
                            {sheet.isMappedSheet ? ' (Mapped)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Preview Content */}
                <Card className="p-0 overflow-hidden">
                  {viewMode === 'styled' && styledPreviewData ? (
                    (() => {
                      const activeSheet = styledPreviewData.parsedStructure.sheets.find((sheet: any) => sheet.name === selectedPreviewSheet) ||
                                          styledPreviewData.parsedStructure.sheets[0];
                      
                      if (!activeSheet) {
                        return <p className="p-4 text-sm text-muted-foreground">No worksheet data available.</p>;
                      }

                      return (
                        <div className="overflow-auto max-h-[60vh] p-4">
                          <ExcelRenderer
                            sheet={activeSheet}
                            scale={previewScale}
                            showGridlines={true}
                          />
                        </div>
                      );
                    })()
                  ) : (
                    (() => {
                      const activeSheet = previewData?.sheets.find((sheet) => sheet.sheetName === selectedPreviewSheet) ||
                                          previewData?.sheets[0];
                      
                      if (!activeSheet) {
                        return <p className="p-4 text-sm text-muted-foreground">No worksheet data available.</p>;
                      }

                      return (
                        <div className="space-y-2 p-4">
                          <div className="flex items-center gap-2">
                            <Badge variant={activeSheet.isMappedSheet ? 'default' : 'outline'}>
                              {activeSheet.isMappedSheet ? 'Mapped Sheet' : 'Unmapped Sheet'}
                            </Badge>
                            <p className="text-xs text-muted-foreground">
                              Total rows: {activeSheet.totalRows} | 
                              Showing: {Math.min(activeSheet.previewRows.length, previewData?.maxRows || 0)} rows × {previewData?.maxCols || 0} columns
                            </p>
                          </div>
                          <div className="overflow-auto border rounded-md max-h-[50vh]">
                            <table className="min-w-full text-xs border-collapse">
                              <thead className="sticky top-0 bg-muted z-10">
                                <tr>
                                  <th className="border px-2 py-1 text-left">#</th>
                                  {Array.from({ length: previewData?.maxCols || 0 }).map((_, index) => (
                                    <th key={index} className="border px-2 py-1 text-left min-w-[90px]">
                                      {index + 1}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {activeSheet.previewRows.map((row, rowIndex) => (
                                  <tr key={rowIndex}>
                                    <td className="border px-2 py-1 bg-gray-50 font-medium">{rowIndex + 1}</td>
                                    {row.map((cell, colIndex) => (
                                      <td key={colIndex} className="border px-2 py-1 align-top whitespace-pre-wrap">
                                        {cell}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })()
                  )}
                </Card>
              </>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setPreviewDialogOpen(false)}>Close</Button>
            <Button onClick={() => window.print()}>
              <Download className="w-4 h-4 mr-2" />
              Print Preview
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
