import { useState, useEffect } from 'react';
import axios from 'axios';
import { getPortalToken } from './api';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

interface ParsedCell {
  row: number;
  col: number;
  value: any;
  formula?: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'formula' | 'empty';
  style: any;
  mergeInfo?: {
    rowSpan: number;
    colSpan: number;
    isMaster: boolean;
  };
}

interface ParsedSheet {
  name: string;
  rowCount: number;
  colCount: number;
  cells: ParsedCell[];
  columnWidths: number[];
  rowHeights: number[];
  mergedCells: string[];
}

interface TemplateData {
  templateId: string;
  formType: string;
  formName: string;
  fileName: string;
  mappedSheetName: string | null;
  parsedStructure: {
    sheets: ParsedSheet[];
    metadata: {
      creator?: string;
      created?: Date;
      modified?: Date;
    };
  };
}

interface UseTemplateResult {
  template: TemplateData | null;
  sheets: ParsedSheet[];
  activeSheet: ParsedSheet | null;
  loading: boolean;
  error: string | null;
  setActiveSheetByName: (name: string) => void;
  refetch: () => Promise<void>;
}

/**
 * Custom hook to load and manage Excel templates with styling
 * @param formType - Form type (SF1, SF2, etc.) or template ID
 * @param options - Additional options
 */
export function useTemplate(
  formType: string,
  options: {
    enabled?: boolean;
    sheetName?: string;
  } = {}
): UseTemplateResult {
  const { enabled = true, sheetName } = options;

  const [template, setTemplate] = useState<TemplateData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);

  const fetchTemplate = async () => {
    if (!formType || !enabled) return;

    try {
      setLoading(true);
      setError(null);

      const token = getPortalToken();
      if (!token) {
        throw new Error('Authentication required');
      }

      // First get the template metadata
      const templateResponse = await axios.get(
        `${SERVER_URL}/api/templates/${formType}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      const templateId = templateResponse.data.data.id;

      // Then get the styled structure
      const styledResponse = await axios.get(
        `${SERVER_URL}/api/templates/${templateId}/styled-preview`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: sheetName ? { sheet: sheetName } : {}
        }
      );

      setTemplate(styledResponse.data.data);

      // Set active sheet
      const sheets = styledResponse.data.data.parsedStructure.sheets;
      if (sheetName) {
        const sheetIndex = sheets.findIndex((s: ParsedSheet) => s.name === sheetName);
        setActiveSheetIndex(sheetIndex >= 0 ? sheetIndex : 0);
      } else {
        setActiveSheetIndex(0);
      }
    } catch (err: any) {
      console.error('Failed to load template:', err);
      setError(err.response?.data?.error || err.message || 'Failed to load template');
      setTemplate(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplate();
  }, [formType, enabled, sheetName]);

  const sheets = template?.parsedStructure?.sheets || [];
  const activeSheet = sheets[activeSheetIndex] || null;

  const setActiveSheetByName = (name: string) => {
    const index = sheets.findIndex(s => s.name === name);
    if (index >= 0) {
      setActiveSheetIndex(index);
    }
  };

  return {
    template,
    sheets,
    activeSheet,
    loading,
    error,
    setActiveSheetByName,
    refetch: fetchTemplate
  };
}

/**
 * Hook to fetch list of available templates
 */
export function useTemplateList() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      setError(null);

      const token = getPortalToken();
      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await axios.get(`${SERVER_URL}/api/templates`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setTemplates(response.data.data || []);
    } catch (err: any) {
      console.error('Failed to load templates:', err);
      setError(err.response?.data?.error || err.message || 'Failed to load templates');
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  return {
    templates,
    loading,
    error,
    refetch: fetchTemplates
  };
}
