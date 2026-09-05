import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Printer, FileSpreadsheet, RefreshCw, ZoomIn, ZoomOut, AlertCircle } from 'lucide-react';
import ExcelRenderer from '@/components/ExcelRenderer';
import { useTemplate, useTemplateList } from '@/lib/useTemplate';

/**
 * FormViewer - Example page showing how to use the Dynamic Template System
 * 
 * This page demonstrates:
 * 1. Loading templates uploaded by admin
 * 2. Rendering pixel-perfect Excel views
 * 3. Print-ready output
 * 4. No-code maintenance: Admin uploads new template, this page automatically uses it
 */

export default function FormViewer() {
  const [selectedFormType, setSelectedFormType] = useState<string>('SF9');
  const [scale, setScale] = useState(1);

  // Get list of available templates
  const { templates, loading: templatesLoading } = useTemplateList();

  // Load the selected template with styling
  const {
    template,
    activeSheet,
    sheets,
    loading,
    error,
    setActiveSheetByName,
    refetch
  } = useTemplate(selectedFormType, {
    enabled: !!selectedFormType
  });

  const handlePrint = () => {
    window.print();
  };

  const handleZoomIn = () => {
    setScale(prev => Math.min(prev + 0.1, 2));
  };

  const handleZoomOut = () => {
    setScale(prev => Math.max(prev - 0.1, 0.5));
  };

  const handleResetZoom = () => {
    setScale(1);
  };

  const activeTemplates = templates.filter(t => t.isActive);

  return (
    <div className="min-h-screen bg-background p-6">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">DepEd Form Viewer</h1>
            <p className="text-muted-foreground mt-1">
              View and print school forms using admin-uploaded templates
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={refetch}
              disabled={loading}
              className="gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              onClick={handlePrint}
              disabled={!activeSheet}
              className="gap-2 bg-primary hover:bg-primary/90"
            >
              <Printer className="w-4 h-4" />
              Print Form
            </Button>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="max-w-7xl mx-auto mb-6">
        <Card className="p-5">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Form Selection */}
            <div className="flex-1">
              <label className="block text-sm font-medium mb-2">
                Select Form Type
              </label>
              <Select
                value={selectedFormType}
                onValueChange={setSelectedFormType}
                disabled={templatesLoading}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a form...">
                    {activeTemplates.find((t) => t.formType === selectedFormType)?.formName || selectedFormType}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {activeTemplates.length === 0 && (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      No active templates available
                    </div>
                  )}
                  {activeTemplates.map((template) => (
                    <SelectItem key={template.formType} value={template.formType}>
                      {template.formName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Sheet Selection (for multi-sheet templates) */}
            {sheets.length > 1 && (
              <div className="flex-1">
                <label className="block text-sm font-medium mb-2">
                  Select Sheet
                </label>
                <Select
                  value={activeSheet?.name || ''}
                  onValueChange={setActiveSheetByName}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a sheet..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sheets.map((sheet) => (
                      <SelectItem key={sheet.name} value={sheet.name}>
                        {sheet.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Zoom Controls */}
            <div className="flex-shrink-0">
              <label className="block text-sm font-medium mb-2">
                Zoom ({Math.round(scale * 100)}%)
              </label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleZoomOut}
                  disabled={scale <= 0.5}
                >
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetZoom}
                >
                  Reset
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleZoomIn}
                  disabled={scale >= 2}
                >
                  <ZoomIn className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Info Banner */}
      <div className="max-w-7xl mx-auto mb-6">
        <Card className="p-4 bg-muted/50 border-border">
          <div className="flex items-start gap-3">
            <FileSpreadsheet className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div className="text-sm text-foreground">
              <strong>No-Code Maintenance:</strong> This page automatically uses the latest template uploaded by the admin.
              If DepEd updates the form format, the admin can simply upload a new template through the Template Manager—no coding needed!
            </div>
          </div>
        </Card>
      </div>

      {/* Content Area */}
      <div className="max-w-7xl mx-auto">
        <Card className="p-6">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-primary" />
                <p className="text-sm text-muted-foreground">Loading template...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Failed to load template</p>
                <p className="text-sm mt-1">{error}</p>
              </div>
            </div>
          )}

          {!loading && !error && !activeSheet && selectedFormType && (
            <div className="text-center py-20">
              <FileSpreadsheet className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">
                No active template found for {selectedFormType}
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Please ask your administrator to upload a template.
              </p>
            </div>
          )}

          {!loading && !error && activeSheet && (
            <div className="overflow-auto">
              <ExcelRenderer
                sheet={activeSheet}
                scale={scale}
                showGridlines={true}
              />
            </div>
          )}

          {!selectedFormType && !loading && (
            <div className="text-center py-20">
              <FileSpreadsheet className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">
                Select a form type to view the template
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* Template Info Footer */}
      {template && activeSheet && (
        <div className="max-w-7xl mx-auto mt-4">
          <Card className="p-4">
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <div>
                <strong>Form:</strong> {template.formName}
              </div>
              <div>
                <strong>File:</strong> {template.fileName}
              </div>
              <div>
                <strong>Sheet:</strong> {activeSheet.name}
              </div>
              <div>
                <strong>Size:</strong> {activeSheet.rowCount} rows × {activeSheet.colCount} columns
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
