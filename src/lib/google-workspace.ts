import { supabase } from "@/integrations/supabase/client";

type WorkspaceToolResult<T> = {
  jsonrpc?: string;
  id?: string | number | null;
  error?: { code?: number; message?: string };
  result?: {
    structuredContent?: T;
    isError?: boolean;
  };
};

export type ProjectWorkspaceResult = {
  success: boolean;
  created: boolean;
  project_id?: string;
  project_name?: string;
  operations_folder_id: string;
  finance_folder_id?: string | null;
  operations_folder_url: string;
  finance_folder_url?: string | null;
  error?: string;
};

export type WorkspaceResource = {
  resource_key: string;
  resource_id: string;
  resource_name: string;
  resource_type: "drive" | "folder";
  updated_at: string;
};

export type GoogleWorkspaceStatus = {
  connected: boolean;
  oauth_server_configured: boolean;
  google_account: string | null;
  resources: WorkspaceResource[];
  operations_drive_id: string;
};

export async function getGoogleWorkspaceStatus() {
  const requestId = crypto.randomUUID();
  const { data, error } = await supabase.functions.invoke<
    WorkspaceToolResult<GoogleWorkspaceStatus>
  >("nes-workspace-control", {
    body: {
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/call",
      params: {
        name: "get_google_workspace_status",
        arguments: {},
      },
    },
  });

  if (error) throw error;
  if (data?.error) {
    throw new Error(data.error.message || "Google Workspace durumu alınamadı");
  }

  const result = data?.result;
  const content = result?.structuredContent;
  if (!content || result?.isError) {
    throw new Error("Google Workspace durumu alınamadı");
  }
  return content;
}

export type OfferWorkspaceResult = {
  success: boolean;
  created: boolean;
  offer_id?: string;
  offer_folder_id?: string;
  excel_file_id?: string;
  drive_excel_url?: string;
  drive_folder_url?: string;
  error?: string;
};

export async function createOfferDriveWorkspace(offerId: string) {
  const requestId = crypto.randomUUID();
  const { data, error } = await supabase.functions.invoke<
    WorkspaceToolResult<OfferWorkspaceResult>
  >("nes-workspace-control", {
    body: {
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/call",
      params: {
        name: "create_offer_workspace",
        arguments: { offer_id: offerId },
      },
    },
  });

  if (error) throw error;
  if (data?.error) {
    throw new Error(
      data.error.message || "Teklif Drive klasörü oluşturulamadı",
    );
  }

  const result = data?.result;
  const content = result?.structuredContent;
  if (!content || result?.isError || content.success === false) {
    throw new Error(content?.error || "Teklif Drive klasörü oluşturulamadı");
  }
  return content;
}

export async function createProjectDriveWorkspace(projectId: string) {
  const requestId = crypto.randomUUID();
  const { data, error } = await supabase.functions.invoke<
    WorkspaceToolResult<ProjectWorkspaceResult>
  >("nes-workspace-control", {
    body: {
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/call",
      params: {
        name: "create_project_workspace",
        arguments: { project_id: projectId },
      },
    },
  });

  if (error) throw error;
  if (data?.error) {
    throw new Error(data.error.message || "Drive klasörleri oluşturulamadı");
  }

  const result = data?.result;
  const content = result?.structuredContent;
  if (!content || result?.isError || content.success === false) {
    throw new Error(content?.error || "Drive klasörleri oluşturulamadı");
  }
  return content;
}

export type CalendarEventResult = {
  success: boolean;
  event_id?: string;
  event_url?: string;
  error?: string;
};

/** Bağlı Google hesabının takvimine etkinlik ekler (mevcut
 * create_nes_calendar_event aracı). Saatler Europe/Istanbul. */
export async function createGoogleCalendarEvent(input: {
  summary: string;
  description?: string;
  location?: string;
  /** "YYYY-AA-GGTSS:DD:00" (saat dilimsiz, İstanbul saati). */
  start: string;
  end: string;
}) {
  const requestId = crypto.randomUUID();
  const { data, error } = await supabase.functions.invoke<
    WorkspaceToolResult<CalendarEventResult>
  >("nes-workspace-control", {
    body: {
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/call",
      params: {
        name: "create_nes_calendar_event",
        arguments: input,
      },
    },
  });
  if (error) throw error;
  if (data?.error) {
    throw new Error(data.error.message || "Google Takvim etkinliği eklenemedi");
  }
  const result = data?.result;
  const content = result?.structuredContent;
  if (
    !content ||
    result?.isError ||
    content.success === false ||
    !content.event_id
  ) {
    throw new Error(content?.error || "Google Takvim etkinliği eklenemedi");
  }
  return content as Required<Pick<CalendarEventResult, "event_id">> &
    CalendarEventResult;
}

/** Google Workspace bağlantısını başlatır; dönen adres Google onay sayfasıdır. */
export async function startGoogleWorkspaceConnection() {
  const { data, error } = await supabase.functions.invoke<
    WorkspaceToolResult<{ success: boolean; authorization_url?: string }>
  >("nes-workspace-control", {
    body: {
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name: "start_google_workspace_connection", arguments: {} },
    },
  });
  if (error) throw error;
  if (data?.error) {
    throw new Error(data.error.message || "Google bağlantısı başlatılamadı");
  }
  const url = data?.result?.structuredContent?.authorization_url;
  if (!url) throw new Error("Google bağlantısı başlatılamadı");
  return url;
}
