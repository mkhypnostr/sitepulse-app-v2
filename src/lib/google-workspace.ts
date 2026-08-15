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
