export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      customers: {
        Row: {
          contact: string | null;
          contact_user_id: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
        };
        Insert: {
          contact?: string | null;
          contact_user_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
        };
        Update: {
          contact?: string | null;
          contact_user_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      photos: {
        Row: {
          caption: string | null;
          created_at: string;
          id: string;
          photo_type: Database["public"]["Enums"]["photo_type"];
          show_to_customer: boolean;
          storage_path: string;
          uploaded_by: string | null;
          work_order_id: string;
        };
        Insert: {
          caption?: string | null;
          created_at?: string;
          id?: string;
          photo_type?: Database["public"]["Enums"]["photo_type"];
          show_to_customer?: boolean;
          storage_path: string;
          uploaded_by?: string | null;
          work_order_id: string;
        };
        Update: {
          caption?: string | null;
          created_at?: string;
          id?: string;
          photo_type?: Database["public"]["Enums"]["photo_type"];
          show_to_customer?: boolean;
          storage_path?: string;
          uploaded_by?: string | null;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "photos_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          company_name: string | null;
          created_at: string;
          full_name: string;
          id: string;
          phone: string | null;
        };
        Insert: {
          company_name?: string | null;
          created_at?: string;
          full_name?: string;
          id: string;
          phone?: string | null;
        };
        Update: {
          company_name?: string | null;
          created_at?: string;
          full_name?: string;
          id?: string;
          phone?: string | null;
        };
        Relationships: [];
      };
      progress_approvals: {
        Row: {
          approved_amount: number;
          approved_at: string;
          approved_by: string | null;
          approved_pct: number;
          id: string;
          work_order_id: string;
        };
        Insert: {
          approved_amount: number;
          approved_at?: string;
          approved_by?: string | null;
          approved_pct: number;
          id?: string;
          work_order_id: string;
        };
        Update: {
          approved_amount?: number;
          approved_at?: string;
          approved_by?: string | null;
          approved_pct?: number;
          id?: string;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "progress_approvals_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      progress_updates: {
        Row: {
          contractor_id: string;
          created_at: string;
          id: string;
          note: string | null;
          pct: number;
          work_order_id: string;
        };
        Insert: {
          contractor_id: string;
          created_at?: string;
          id?: string;
          note?: string | null;
          pct: number;
          work_order_id: string;
        };
        Update: {
          contractor_id?: string;
          created_at?: string;
          id?: string;
          note?: string | null;
          pct?: number;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "progress_updates_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      project_number_counters: {
        Row: {
          last_value: number;
          year: number;
        };
        Insert: {
          last_value?: number;
          year: number;
        };
        Update: {
          last_value?: number;
          year?: number;
        };
        Relationships: [];
      };
      project_processes: {
        Row: {
          created_at: string;
          id: string;
          position: number;
          process_type: Database["public"]["Enums"]["project_type"];
          project_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          position?: number;
          process_type: Database["public"]["Enums"]["project_type"];
          project_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          position?: number;
          process_type?: Database["public"]["Enums"]["project_type"];
          project_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_processes_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_task_activity: {
        Row: {
          actor_user_id: string;
          created_at: string;
          id: string;
          new_status: Database["public"]["Enums"]["project_task_status"];
          note: string | null;
          old_status: Database["public"]["Enums"]["project_task_status"] | null;
          project_task_id: string;
        };
        Insert: {
          actor_user_id: string;
          created_at?: string;
          id?: string;
          new_status: Database["public"]["Enums"]["project_task_status"];
          note?: string | null;
          old_status?: Database["public"]["Enums"]["project_task_status"] | null;
          project_task_id: string;
        };
        Update: {
          actor_user_id?: string;
          created_at?: string;
          id?: string;
          new_status?: Database["public"]["Enums"]["project_task_status"];
          note?: string | null;
          old_status?: Database["public"]["Enums"]["project_task_status"] | null;
          project_task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_task_activity_actor_user_id_fkey";
            columns: ["actor_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_task_activity_project_task_id_fkey";
            columns: ["project_task_id"];
            isOneToOne: false;
            referencedRelation: "project_tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      project_tasks: {
        Row: {
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          external_system: string | null;
          id: string;
          note: string | null;
          phase_name: string;
          phase_order: number;
          planned_date: string | null;
          process_id: string;
          project_id: string;
          requires_document: boolean;
          requires_photo: boolean;
          responsible_id: string | null;
          status: Database["public"]["Enums"]["project_task_status"];
          task_name: string;
          task_order: number;
          template_id: string | null;
          updated_at: string;
        };
        Insert: {
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          external_system?: string | null;
          id?: string;
          note?: string | null;
          phase_name: string;
          phase_order: number;
          planned_date?: string | null;
          process_id: string;
          project_id: string;
          requires_document?: boolean;
          requires_photo?: boolean;
          responsible_id?: string | null;
          status?: Database["public"]["Enums"]["project_task_status"];
          task_name: string;
          task_order: number;
          template_id?: string | null;
          updated_at?: string;
        };
        Update: {
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          external_system?: string | null;
          id?: string;
          note?: string | null;
          phase_name?: string;
          phase_order?: number;
          planned_date?: string | null;
          process_id?: string;
          project_id?: string;
          requires_document?: boolean;
          requires_photo?: boolean;
          responsible_id?: string | null;
          status?: Database["public"]["Enums"]["project_task_status"];
          task_name?: string;
          task_order?: number;
          template_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_tasks_completed_by_fkey";
            columns: ["completed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_tasks_process_id_fkey";
            columns: ["process_id"];
            isOneToOne: false;
            referencedRelation: "project_processes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_tasks_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_tasks_responsible_id_fkey";
            columns: ["responsible_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_tasks_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "workflow_task_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      projects: {
        Row: {
          admin_notes: string | null;
          area: number | null;
          block_no: string | null;
          created_at: string;
          created_by: string;
          customer_id: string;
          description: string | null;
          district: string | null;
          external_reference_no: string | null;
          id: string;
          location_url: string | null;
          manager_id: string | null;
          name: string;
          neighborhood: string | null;
          parcel_no: string | null;
          project_no: string;
          province: string | null;
          show_to_customer: boolean;
          start_date: string | null;
          status: Database["public"]["Enums"]["project_status"];
          target_end_date: string | null;
          updated_at: string;
        };
        Insert: {
          admin_notes?: string | null;
          area?: number | null;
          block_no?: string | null;
          created_at?: string;
          created_by: string;
          customer_id: string;
          description?: string | null;
          district?: string | null;
          external_reference_no?: string | null;
          id?: string;
          location_url?: string | null;
          manager_id?: string | null;
          name: string;
          neighborhood?: string | null;
          parcel_no?: string | null;
          project_no: string;
          province?: string | null;
          show_to_customer?: boolean;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          target_end_date?: string | null;
          updated_at?: string;
        };
        Update: {
          admin_notes?: string | null;
          area?: number | null;
          block_no?: string | null;
          created_at?: string;
          created_by?: string;
          customer_id?: string;
          description?: string | null;
          district?: string | null;
          external_reference_no?: string | null;
          id?: string;
          location_url?: string | null;
          manager_id?: string | null;
          name?: string;
          neighborhood?: string | null;
          parcel_no?: string | null;
          project_no?: string;
          province?: string | null;
          show_to_customer?: boolean;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          target_end_date?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_manager_id_fkey";
            columns: ["manager_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_items: {
        Row: {
          code: string | null;
          created_at: string;
          description: string | null;
          id: string;
          location: string | null;
          min_quantity: number;
          name: string;
          quantity: number;
          unit: Database["public"]["Enums"]["stock_unit"];
        };
        Insert: {
          code?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          location?: string | null;
          min_quantity?: number;
          name: string;
          quantity?: number;
          unit?: Database["public"]["Enums"]["stock_unit"];
        };
        Update: {
          code?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          location?: string | null;
          min_quantity?: number;
          name?: string;
          quantity?: number;
          unit?: Database["public"]["Enums"]["stock_unit"];
        };
        Relationships: [];
      };
      stock_movements: {
        Row: {
          contractor_id: string | null;
          created_at: string;
          id: string;
          note: string | null;
          quantity: number;
          stock_item_id: string;
          work_order_id: string | null;
        };
        Insert: {
          contractor_id?: string | null;
          created_at?: string;
          id?: string;
          note?: string | null;
          quantity: number;
          stock_item_id: string;
          work_order_id?: string | null;
        };
        Update: {
          contractor_id?: string | null;
          created_at?: string;
          id?: string;
          note?: string | null;
          quantity?: number;
          stock_item_id?: string;
          work_order_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "stock_movements_stock_item_id_fkey";
            columns: ["stock_item_id"];
            isOneToOne: false;
            referencedRelation: "stock_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      user_management_audit: {
        Row: {
          action: string;
          actor_user_id: string | null;
          created_at: string;
          error_code: string | null;
          id: string;
          outcome: string;
          request_id: string;
          requested_role: Database["public"]["Enums"]["app_role"];
          target_email: string;
          target_user_id: string | null;
        };
        Insert: {
          action: string;
          actor_user_id?: string | null;
          created_at?: string;
          error_code?: string | null;
          id?: string;
          outcome: string;
          request_id: string;
          requested_role: Database["public"]["Enums"]["app_role"];
          target_email: string;
          target_user_id?: string | null;
        };
        Update: {
          action?: string;
          actor_user_id?: string | null;
          created_at?: string;
          error_code?: string | null;
          id?: string;
          outcome?: string;
          request_id?: string;
          requested_role?: Database["public"]["Enums"]["app_role"];
          target_email?: string;
          target_user_id?: string | null;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      work_order_assignments: {
        Row: {
          contractor_id: string;
          created_at: string;
          id: string;
          work_order_id: string;
        };
        Insert: {
          contractor_id: string;
          created_at?: string;
          id?: string;
          work_order_id: string;
        };
        Update: {
          contractor_id?: string;
          created_at?: string;
          id?: string;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_order_assignments_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      work_order_financials: {
        Row: {
          approved_progress_pct: number;
          total_amount: number;
          updated_at: string;
          work_order_id: string;
        };
        Insert: {
          approved_progress_pct?: number;
          total_amount?: number;
          updated_at?: string;
          work_order_id: string;
        };
        Update: {
          approved_progress_pct?: number;
          total_amount?: number;
          updated_at?: string;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_order_financials_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: true;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      work_order_materials: {
        Row: {
          added_by: string;
          created_at: string;
          custom_material_name: string | null;
          id: string;
          is_nes_stock: boolean;
          quantity: number;
          stock_item_id: string | null;
          unit: string;
          work_order_id: string;
        };
        Insert: {
          added_by: string;
          created_at?: string;
          custom_material_name?: string | null;
          id?: string;
          is_nes_stock?: boolean;
          quantity: number;
          stock_item_id?: string | null;
          unit: string;
          work_order_id: string;
        };
        Update: {
          added_by?: string;
          created_at?: string;
          custom_material_name?: string | null;
          id?: string;
          is_nes_stock?: boolean;
          quantity?: number;
          stock_item_id?: string | null;
          unit?: string;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_order_materials_stock_item_id_fkey";
            columns: ["stock_item_id"];
            isOneToOne: false;
            referencedRelation: "stock_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_materials_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      work_orders: {
        Row: {
          created_at: string;
          created_by: string | null;
          customer_id: string;
          description: string | null;
          id: string;
          location: string | null;
          location_url: string | null;
          progress_pct: number;
          scheduled_at: string;
          show_to_customer: boolean;
          status: Database["public"]["Enums"]["work_status"];
          title: string;
          updated_at: string;
          work_order_no: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          customer_id: string;
          description?: string | null;
          id?: string;
          location?: string | null;
          location_url?: string | null;
          progress_pct?: number;
          scheduled_at: string;
          show_to_customer?: boolean;
          status?: Database["public"]["Enums"]["work_status"];
          title: string;
          updated_at?: string;
          work_order_no?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          customer_id?: string;
          description?: string | null;
          id?: string;
          location?: string | null;
          location_url?: string | null;
          progress_pct?: number;
          scheduled_at?: string;
          show_to_customer?: boolean;
          status?: Database["public"]["Enums"]["work_status"];
          title?: string;
          updated_at?: string;
          work_order_no?: number;
        };
        Relationships: [
          {
            foreignKeyName: "work_orders_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      workflow_task_templates: {
        Row: {
          active: boolean;
          created_at: string;
          external_system: string | null;
          id: string;
          phase_name: string;
          phase_order: number;
          process_type: Database["public"]["Enums"]["project_type"];
          requires_document: boolean;
          requires_photo: boolean;
          task_name: string;
          task_order: number;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          external_system?: string | null;
          id?: string;
          phase_name: string;
          phase_order: number;
          process_type: Database["public"]["Enums"]["project_type"];
          requires_document?: boolean;
          requires_photo?: boolean;
          task_name: string;
          task_order: number;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          external_system?: string | null;
          id?: string;
          phase_name?: string;
          phase_order?: number;
          process_type?: Database["public"]["Enums"]["project_type"];
          requires_document?: boolean;
          requires_photo?: boolean;
          task_name?: string;
          task_order?: number;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      approve_progress: {
        Args: { approved_pct_value: number; target_work_order_id: string };
        Returns: number;
      };
      consume_stock_item: {
        Args: {
          consumed_quantity: number;
          movement_note?: string;
          target_stock_item_id: string;
          target_work_order_id: string;
        };
        Returns: undefined;
      };
      contractor_can_access_customer: {
        Args: { target_contractor_id: string; target_customer_id: string };
        Returns: boolean;
      };
      create_project_with_workflow: {
        Args: {
          project_admin_notes?: string;
          project_area?: number;
          project_block_no?: string;
          project_description?: string;
          project_district?: string;
          project_external_reference_no?: string;
          project_location_url?: string;
          project_name: string;
          project_neighborhood?: string;
          project_parcel_no?: string;
          project_province?: string;
          project_start_date?: string;
          project_state?: Database["public"]["Enums"]["project_status"];
          project_target_end_date?: string;
          selected_processes: Database["public"]["Enums"]["project_type"][];
          target_customer_id: string;
          target_manager_id?: string;
          visible_to_customer?: boolean;
        };
        Returns: string;
      };
      create_work_order: {
        Args: {
          assigned_contractor_id?: string;
          order_description: string;
          order_location: string;
          order_location_url?: string;
          order_scheduled_at: string;
          order_title: string;
          order_total_amount: number;
          target_customer_id: string;
          visible_to_customer: boolean;
        };
        Returns: string;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      set_user_role: {
        Args: {
          new_role: Database["public"]["Enums"]["app_role"];
          target_user_id: string;
        };
        Returns: undefined;
      };
      submit_progress_update: {
        Args: {
          new_pct: number;
          progress_note?: string;
          target_work_order_id: string;
        };
        Returns: undefined;
      };
      update_project_task: {
        Args: {
          assigned_user_id?: string;
          new_status: Database["public"]["Enums"]["project_task_status"];
          planned_on?: string;
          target_task_id: string;
          task_note?: string;
          task_system?: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: "admin" | "contractor" | "customer";
      photo_type: "saha" | "montaj_sonrasi" | "malzeme" | "diger";
      project_status: "draft" | "active" | "on_hold" | "completed" | "cancelled";
      project_task_status:
        | "not_started"
        | "in_progress"
        | "external_approval"
        | "revision_required"
        | "blocked"
        | "completed"
        | "not_applicable";
      project_type: "electric_permit" | "site_project" | "connection_line";
      stock_unit: "adet" | "metre";
      work_status: "planned" | "in_progress" | "completed" | "cancelled";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "contractor", "customer"],
      photo_type: ["saha", "montaj_sonrasi", "malzeme", "diger"],
      project_status: ["draft", "active", "on_hold", "completed", "cancelled"],
      project_task_status: [
        "not_started",
        "in_progress",
        "external_approval",
        "revision_required",
        "blocked",
        "completed",
        "not_applicable",
      ],
      project_type: ["electric_permit", "site_project", "connection_line"],
      stock_unit: ["adet", "metre"],
      work_status: ["planned", "in_progress", "completed", "cancelled"],
    },
  },
} as const;
