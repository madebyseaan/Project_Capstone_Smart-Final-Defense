import { Response } from "express";

// Set of all connected SSE admin clients for audit logs
const auditClients = new Set<Response>();

// Set of all connected SSE clients for settings updates
const settingsClients = new Set<Response>();

// Set of all connected SSE clients for sync status updates
const syncClients = new Set<Response>();

export function addSseClient(res: Response) {
  auditClients.add(res);
}

export function removeSseClient(res: Response) {
  auditClients.delete(res);
}

export function addSettingsSseClient(res: Response) {
  settingsClients.add(res);
}

export function removeSettingsSseClient(res: Response) {
  settingsClients.delete(res);
}

export function addSyncSseClient(res: Response) {
  syncClients.add(res);
}

export function removeSyncSseClient(res: Response) {
  syncClients.delete(res);
}

export function broadcastLog(log: object) {
  const data = `data: ${JSON.stringify(log)}\n\n`;
  for (const client of auditClients) {
    try {
      client.write(data);
    } catch {
      auditClients.delete(client);
    }
  }
}

export function broadcastSettingsUpdate(settings: object) {
  const data = `data: ${JSON.stringify(settings)}\n\n`;
  for (const client of settingsClients) {
    try {
      client.write(data);
    } catch {
      settingsClients.delete(client);
    }
  }
}

export function broadcastSyncStatus(status: object) {
  const data = `data: ${JSON.stringify(status)}\n\n`;
  for (const client of syncClients) {
    try {
      client.write(data);
    } catch {
      syncClients.delete(client);
    }
  }
}

export function broadcastSseEvent(eventType: string, payload: object) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of syncClients) {
    try {
      client.write(message);
    } catch {
      syncClients.delete(client);
    }
  }
  for (const client of settingsClients) {
    try {
      client.write(message);
    } catch {
      settingsClients.delete(client);
    }
  }
}
