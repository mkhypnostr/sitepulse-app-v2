export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          entity_id: string;
          entity_type: string;
          id: string;
          new_data: Json | null;
          old_data: Json | null;
          project_id: string | null;
          work_order_id: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_data?: Json | null;
          old_data?: Json | null;
          project_id?: string | null;
          work_order_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_data?: Json | null;
          old_data?: Json | null;
          project_id?: string | null;
          work_order_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "activity_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_logs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_logs_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      calendar_events: {
        Row: {
          created_at: string;
          created_by: string;
          end_date: string | null;
          event_type: string;
          id: string;
          notes: string | null;
          project_id: string | null;
          responsible_id: string | null;
          scheduled_date: string;
          scheduled_time: string | null;
          status: string;
          title: string;
          updated_at: string;
          work_order_id: string | null;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          end_date?: string | null;
          event_type?: string;
          id?: string;
          notes?: string | null;
          project_id?: string | null;
          responsible_id?: string | null;
          scheduled_date: string;
          scheduled_time?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
          work_order_id?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          end_date?: string | null;
          event_type?: string;
          id?: string;
          notes?: string | null;
          project_id?: string | null;
          responsible_id?: string | null;
          scheduled_date?: string;
          scheduled_time?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
          work_order_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "calendar_events_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "calendar_events_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "calendar_events_responsible_id_fkey";
            columns: ["responsible_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "calendar_events_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      customers: {
        Row: {
          billing_address: string | null;
          billing_title: string | null;
          contact: string | null;
          contact_user_id: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          tax_no: string | null;
          tax_office: string | null;
        };
        Insert: {
          billing_address?: string | null;
          billing_title?: string | null;
          contact?: string | null;
          contact_user_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          tax_no?: string | null;
          tax_office?: string | null;
        };
        Update: {
          billing_address?: string | null;
          billing_title?: string | null;
          contact?: string | null;
          contact_user_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          tax_no?: string | null;
          tax_office?: string | null;
        };
        Relationships: [];
      };
      offer_line_items: {
        Row: {
          applied_sale_amount: number;
          brand: string | null;
          category: string;
          computed_sale_amount: number;
          created_at: string;
          description: string;
          id: string;
          labor_cost: number;
          logistics_cost: number;
          manual_sale_amount: number | null;
          markup_rate: number;
          material_cost: number;
          offer_id: string;
          quantity: number;
          risk_cost: number;
          sort_order: number;
          subcontractor_cost: number;
          total_cost: number;
          unit: string;
          unit_cost: number;
          updated_at: string;
          visible_to_customer: boolean;
        };
        Insert: {
          applied_sale_amount?: number;
          brand?: string | null;
          category?: string;
          computed_sale_amount?: number;
          created_at?: string;
          description: string;
          id?: string;
          labor_cost?: number;
          logistics_cost?: number;
          manual_sale_amount?: number | null;
          markup_rate?: number;
          material_cost?: number;
          offer_id: string;
          quantity?: number;
          risk_cost?: number;
          sort_order?: number;
          subcontractor_cost?: number;
          total_cost?: number;
          unit?: string;
          unit_cost?: number;
          updated_at?: string;
          visible_to_customer?: boolean;
        };
        Update: {
          applied_sale_amount?: number;
          brand?: string | null;
          category?: string;
          computed_sale_amount?: number;
          created_at?: string;
          description?: string;
          id?: string;
          labor_cost?: number;
          logistics_cost?: number;
          manual_sale_amount?: number | null;
          markup_rate?: number;
          material_cost?: number;
          offer_id?: string;
          quantity?: number;
          risk_cost?: number;
          sort_order?: number;
          subcontractor_cost?: number;
          total_cost?: number;
          unit?: string;
          unit_cost?: number;
          updated_at?: string;
          visible_to_customer?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "offer_line_items_offer_id_fkey";
            columns: ["offer_id"];
            isOneToOne: false;
            referencedRelation: "offers";
            referencedColumns: ["id"];
          },
        ];
      };
      offer_number_sequences: {
        Row: {
          last_value: number;
          period: string;
        };
        Insert: {
          last_value?: number;
          period: string;
        };
        Update: {
          last_value?: number;
          period?: string;
        };
        Relationships: [];
      };
      offers: {
        Row: {
          created_at: string;
          created_by: string;
          currency: string;
          customer_approved_at: string | null;
          customer_id: string | null;
          drive_excel_url: string | null;
          drive_folder_url: string | null;
          id: string;
          notes: string | null;
          offer_no: string;
          offer_type: string;
          primary_item_description: string | null;
          primary_item_quantity: number;
          primary_item_unit: string;
          project_id: string | null;
          source_summary: string | null;
          status: string;
          title: string;
          total_amount: number;
          total_amount_mode: string;
          updated_at: string;
          valid_until: string | null;
          vat_rate: number;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          currency?: string;
          customer_approved_at?: string | null;
          customer_id?: string | null;
          drive_excel_url?: string | null;
          drive_folder_url?: string | null;
          id?: string;
          notes?: string | null;
          offer_no?: string;
          offer_type?: string;
          primary_item_description?: string | null;
          primary_item_quantity?: number;
          primary_item_unit?: string;
          project_id?: string | null;
          source_summary?: string | null;
          status?: string;
          title: string;
          total_amount?: number;
          total_amount_mode?: string;
          updated_at?: string;
          valid_until?: string | null;
          vat_rate?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          currency?: string;
          customer_approved_at?: string | null;
          customer_id?: string | null;
          drive_excel_url?: string | null;
          drive_folder_url?: string | null;
          id?: string;
          notes?: string | null;
          offer_no?: string;
          offer_type?: string;
          primary_item_description?: string | null;
          primary_item_quantity?: number;
          primary_item_unit?: string;
          project_id?: string | null;
          source_summary?: string | null;
          status?: string;
          title?: string;
          total_amount?: number;
          total_amount_mode?: string;
          updated_at?: string;
          valid_until?: string | null;
          vat_rate?: number;
        };
        Relationships: [
          {
            foreignKeyName: "offers_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "offers_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "offers_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      operational_tasks: {
        Row: {
          assigned_to: string | null;
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          created_by: string;
          customer_id: string | null;
          description: string | null;
          id: string;
          overdue_notified_at: string | null;
          planned_date: string | null;
          project_id: string | null;
          status: Database["public"]["Enums"]["project_task_status"];
          title: string;
          updated_at: string;
        };
        Insert: {
          assigned_to?: string | null;
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          created_by: string;
          customer_id?: string | null;
          description?: string | null;
          id?: string;
          overdue_notified_at?: string | null;
          planned_date?: string | null;
          project_id?: string | null;
          status?: Database["public"]["Enums"]["project_task_status"];
          title: string;
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          created_by?: string;
          customer_id?: string | null;
          description?: string | null;
          id?: string;
          overdue_notified_at?: string | null;
          planned_date?: string | null;
          project_id?: string | null;
          status?: Database["public"]["Enums"]["project_task_status"];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "operational_tasks_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operational_tasks_completed_by_fkey";
            columns: ["completed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operational_tasks_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operational_tasks_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operational_tasks_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      photos: {
        Row: {
          caption: string | null;
          created_at: string;
          id: string;
          is_document: boolean;
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
          is_document?: boolean;
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
          is_document?: boolean;
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
          evidence_photo_id: string | null;
          id: string;
          note: string | null;
          pct: number;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          work_order_id: string;
        };
        Insert: {
          contractor_id: string;
          created_at?: string;
          evidence_photo_id?: string | null;
          id?: string;
          note?: string | null;
          pct: number;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          work_order_id: string;
        };
        Update: {
          contractor_id?: string;
          created_at?: string;
          evidence_photo_id?: string | null;
          id?: string;
          note?: string | null;
          pct?: number;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "progress_updates_evidence_photo_id_fkey";
            columns: ["evidence_photo_id"];
            isOneToOne: false;
            referencedRelation: "photos";
            referencedColumns: ["id"];
          },
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
          old_status?:
            Database["public"]["Enums"]["project_task_status"] | null;
          project_task_id: string;
        };
        Update: {
          actor_user_id?: string;
          created_at?: string;
          id?: string;
          new_status?: Database["public"]["Enums"]["project_task_status"];
          note?: string | null;
          old_status?:
            Database["public"]["Enums"]["project_task_status"] | null;
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
      project_task_evidence: {
        Row: {
          created_at: string;
          description: string | null;
          evidence_type: string;
          file_name: string;
          id: string;
          mime_type: string;
          project_task_id: string;
          size_bytes: number;
          storage_path: string;
          submission_id: string | null;
          uploaded_by: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          evidence_type: string;
          file_name: string;
          id?: string;
          mime_type: string;
          project_task_id: string;
          size_bytes: number;
          storage_path: string;
          submission_id?: string | null;
          uploaded_by: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          evidence_type?: string;
          file_name?: string;
          id?: string;
          mime_type?: string;
          project_task_id?: string;
          size_bytes?: number;
          storage_path?: string;
          submission_id?: string | null;
          uploaded_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_task_evidence_project_task_id_fkey";
            columns: ["project_task_id"];
            isOneToOne: false;
            referencedRelation: "project_tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_task_evidence_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "project_task_progress_submissions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_task_evidence_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      project_task_progress_submissions: {
        Row: {
          id: string;
          note: string;
          project_task_id: string;
          proposed_actual_date: string | null;
          proposed_pct: number;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database["public"]["Enums"]["project_progress_submission_status"];
          submitted_at: string;
          submitted_by: string;
        };
        Insert: {
          id?: string;
          note: string;
          project_task_id: string;
          proposed_actual_date?: string | null;
          proposed_pct: number;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["project_progress_submission_status"];
          submitted_at?: string;
          submitted_by: string;
        };
        Update: {
          id?: string;
          note?: string;
          project_task_id?: string;
          proposed_actual_date?: string | null;
          proposed_pct?: number;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["project_progress_submission_status"];
          submitted_at?: string;
          submitted_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_task_progress_submissions_project_task_id_fkey";
            columns: ["project_task_id"];
            isOneToOne: false;
            referencedRelation: "project_tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_task_progress_submissions_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_task_progress_submissions_submitted_by_fkey";
            columns: ["submitted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      project_tasks: {
        Row: {
          actual_date: string | null;
          approved_progress_pct: number;
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          external_system: string | null;
          id: string;
          note: string | null;
          overdue_notified_at: string | null;
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
          actual_date?: string | null;
          approved_progress_pct?: number;
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          external_system?: string | null;
          id?: string;
          note?: string | null;
          overdue_notified_at?: string | null;
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
          actual_date?: string | null;
          approved_progress_pct?: number;
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          external_system?: string | null;
          id?: string;
          note?: string | null;
          overdue_notified_at?: string | null;
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
          customer_id: string | null;
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
          contract_amount: number | null;
          quoted_amount: number | null;
          referring_architect: string | null;
          province: string | null;
          show_to_customer: boolean;
          start_date: string | null;
          status: Database["public"]["Enums"]["project_status"];
          status_changed_at: string;
          status_note: string | null;
          target_end_date: string | null;
          updated_at: string;
        };
        Insert: {
          admin_notes?: string | null;
          area?: number | null;
          block_no?: string | null;
          created_at?: string;
          created_by: string;
          contract_amount?: number | null;
          customer_id?: string | null;
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
          quoted_amount?: number | null;
          referring_architect?: string | null;
          province?: string | null;
          show_to_customer?: boolean;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          status_changed_at?: string;
          status_note?: string | null;
          target_end_date?: string | null;
          updated_at?: string;
        };
        Update: {
          admin_notes?: string | null;
          area?: number | null;
          block_no?: string | null;
          created_at?: string;
          created_by?: string;
          contract_amount?: number | null;
          customer_id?: string | null;
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
          quoted_amount?: number | null;
          referring_architect?: string | null;
          province?: string | null;
          show_to_customer?: boolean;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          status_changed_at?: string;
          status_note?: string | null;
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
          unit_price: number;
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
          unit_price?: number;
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
          unit_price?: number;
        };
        Relationships: [];
      };
      transformer_responsibility_contracts: {
        Row: {
          id: string;
          customer_name: string;
          facility_name: string;
          location: string | null;
          transformer_power_kva: number | null;
          voltage_level: string | null;
          responsible_engineer: string | null;
          contract_start_date: string;
          contract_end_date: string;
          monthly_fee: number;
          status: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          customer_name: string;
          facility_name: string;
          location?: string | null;
          transformer_power_kva?: number | null;
          voltage_level?: string | null;
          responsible_engineer?: string | null;
          contract_start_date: string;
          contract_end_date: string;
          monthly_fee?: number;
          status?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          customer_name?: string;
          facility_name?: string;
          location?: string | null;
          transformer_power_kva?: number | null;
          voltage_level?: string | null;
          responsible_engineer?: string | null;
          contract_start_date?: string;
          contract_end_date?: string;
          monthly_fee?: number;
          status?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      transformer_monthly_checks: {
        Row: {
          id: string;
          contract_id: string;
          check_month: string;
          checked_at: string | null;
          checker_name: string | null;
          signed_by: string | null;
          status: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          contract_id: string;
          check_month: string;
          checked_at?: string | null;
          checker_name?: string | null;
          signed_by?: string | null;
          status?: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          contract_id?: string;
          check_month?: string;
          checked_at?: string | null;
          checker_name?: string | null;
          signed_by?: string | null;
          status?: string;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      measurement_service_records: {
        Row: {
          id: string;
          service_date: string | null;
          customer_name: string;
          contact_name: string | null;
          contact_phone: string | null;
          location: string | null;
          service_type: string;
          report_status: string;
          payment_status: string;
          agreed_amount: number;
          vat_rate: number;
          collected_amount: number;
          due_date: string | null;
          project_id: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          service_date?: string | null;
          customer_name: string;
          contact_name?: string | null;
          contact_phone?: string | null;
          location?: string | null;
          service_type: string;
          report_status?: string;
          payment_status?: string;
          agreed_amount?: number;
          vat_rate?: number;
          collected_amount?: number;
          due_date?: string | null;
          project_id?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          service_date?: string | null;
          customer_name?: string;
          contact_name?: string | null;
          contact_phone?: string | null;
          location?: string | null;
          service_type?: string;
          report_status?: string;
          payment_status?: string;
          agreed_amount?: number;
          vat_rate?: number;
          collected_amount?: number;
          due_date?: string | null;
          project_id?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
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
      user_login_profiles: {
        Row: {
          created_at: string;
          updated_at: string;
          user_id: string;
          username: string;
        };
        Insert: {
          created_at?: string;
          updated_at?: string;
          user_id: string;
          username: string;
        };
        Update: {
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          username?: string;
        };
        Relationships: [];
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
      work_completion_evidence: {
        Row: {
          photo_id: string;
          submission_id: string;
        };
        Insert: {
          photo_id: string;
          submission_id: string;
        };
        Update: {
          photo_id?: string;
          submission_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_completion_evidence_photo_id_fkey";
            columns: ["photo_id"];
            isOneToOne: false;
            referencedRelation: "photos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_completion_evidence_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "work_completion_submissions";
            referencedColumns: ["id"];
          },
        ];
      };
      work_completion_submissions: {
        Row: {
          id: string;
          note: string;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          submitted_at: string;
          submitted_by: string;
          work_order_id: string;
        };
        Insert: {
          id?: string;
          note: string;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          submitted_at?: string;
          submitted_by: string;
          work_order_id: string;
        };
        Update: {
          id?: string;
          note?: string;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          submitted_at?: string;
          submitted_by?: string;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_completion_submissions_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_completion_submissions_submitted_by_fkey";
            columns: ["submitted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_completion_submissions_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
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
          contractor_labor_amount: number;
          customer_amount: number;
          customer_labor_amount: number;
          customer_material_amount: number;
          estimated_material_cost: number;
          total_amount: number;
          updated_at: string;
          work_order_id: string;
        };
        Insert: {
          approved_progress_pct?: number;
          contractor_labor_amount?: number;
          customer_amount?: number;
          customer_labor_amount?: number;
          customer_material_amount?: number;
          estimated_material_cost?: number;
          total_amount?: number;
          updated_at?: string;
          work_order_id: string;
        };
        Update: {
          approved_progress_pct?: number;
          contractor_labor_amount?: number;
          customer_amount?: number;
          customer_labor_amount?: number;
          customer_material_amount?: number;
          estimated_material_cost?: number;
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
          material_source: string;
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
          material_source?: string;
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
          material_source?: string;
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
          completion_note: string | null;
          completion_submitted_at: string | null;
          completion_submitted_by: string | null;
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          default_material_source: string;
          description: string | null;
          id: string;
          location: string | null;
          location_url: string | null;
          overdue_notified_at: string | null;
          planned_end_at: string | null;
          progress_pct: number;
          project_id: string | null;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          scheduled_at: string | null;
          show_to_customer: boolean;
          status: Database["public"]["Enums"]["work_status"];
          title: string;
          updated_at: string;
          work_order_no: number;
          work_scope_type: string;
        };
        Insert: {
          completion_note?: string | null;
          completion_submitted_at?: string | null;
          completion_submitted_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          default_material_source?: string;
          description?: string | null;
          id?: string;
          location?: string | null;
          location_url?: string | null;
          overdue_notified_at?: string | null;
          planned_end_at?: string | null;
          progress_pct?: number;
          project_id?: string | null;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          scheduled_at?: string | null;
          show_to_customer?: boolean;
          status?: Database["public"]["Enums"]["work_status"];
          title: string;
          updated_at?: string;
          work_order_no?: number;
          work_scope_type?: string;
        };
        Update: {
          completion_note?: string | null;
          completion_submitted_at?: string | null;
          completion_submitted_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          default_material_source?: string;
          description?: string | null;
          id?: string;
          location?: string | null;
          location_url?: string | null;
          overdue_notified_at?: string | null;
          planned_end_at?: string | null;
          progress_pct?: number;
          project_id?: string | null;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          scheduled_at?: string | null;
          show_to_customer?: boolean;
          status?: Database["public"]["Enums"]["work_status"];
          title?: string;
          updated_at?: string;
          work_order_no?: number;
          work_scope_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_orders_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
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
      add_external_work_order_material: {
        Args: {
          material_name: string;
          material_quantity: number;
          material_unit: string;
          source_type: string;
          target_work_order_id: string;
        };
        Returns: string;
      };
      approve_progress: {
        Args: { approved_pct_value: number; target_work_order_id: string };
        Returns: number;
      };
      can_manage_projects: {
        Args: { target_user_id: string };
        Returns: boolean;
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
      create_operational_task: {
        Args: {
          assigned_user_id?: string;
          planned_on?: string;
          target_customer_id?: string;
          target_project_id?: string;
          task_description?: string;
          task_title: string;
        };
        Returns: string;
      };
      create_project_task: {
        Args: {
          assigned_user_id?: string;
          new_task_name: string;
          planned_on?: string;
          required_document?: boolean;
          required_photo?: boolean;
          target_process_id: string;
          target_project_id: string;
          task_note?: string;
        };
        Returns: string;
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
          order_contractor_labor_amount?: number;
          order_customer_labor_amount?: number;
          order_customer_material_amount?: number;
          order_default_material_source?: string;
          order_description: string;
          order_estimated_material_cost?: number;
          order_location: string;
          order_location_url?: string;
          order_planned_end_at?: string;
          order_scheduled_at?: string;
          order_title: string;
          order_work_scope_type?: string;
          save_as_draft?: boolean;
          target_customer_id: string;
          target_project_id?: string;
          visible_to_customer?: boolean;
        };
        Returns: string;
      };
      create_work_order_technical: {
        Args: {
          assigned_contractor_id?: string;
          order_default_material_source?: string;
          order_description: string;
          order_location: string;
          order_location_url?: string;
          order_planned_end_at?: string;
          order_scheduled_at?: string;
          order_title: string;
          order_work_scope_type?: string;
          save_as_draft?: boolean;
          target_customer_id: string;
          target_project_id?: string;
          visible_to_customer?: boolean;
        };
        Returns: string;
      };
      delete_draft_project: {
        Args: { target_project_id: string };
        Returns: undefined;
      };
      delete_extra_project_task: {
        Args: { target_task_id: string };
        Returns: undefined;
      };
      delete_operational_task: {
        Args: { target_task_id: string };
        Returns: undefined;
      };
      delete_project_permanently: {
        Args: { target_project_id: string };
        Returns: undefined;
      };
      delete_project_task_evidence: {
        Args: { target_evidence_id: string };
        Returns: string;
      };
      delete_work_order_permanently: {
        Args: { target_work_order_id: string };
        Returns: undefined;
      };
      delete_work_photo: { Args: { target_photo_id: string }; Returns: string };
      get_my_app_role: {
        Args: never;
        Returns: Database["public"]["Enums"]["app_role"];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      list_operational_team_members: {
        Args: never;
        Returns: {
          company_name: string;
          email: string | null;
          full_name: string;
          id: string;
          phone: string;
          role: Database["public"]["Enums"]["app_role"];
        }[];
      };
      list_project_assignees: {
        Args: never;
        Returns: {
          full_name: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
        }[];
      };
      list_project_customers: {
        Args: never;
        Returns: {
          id: string;
          name: string;
        }[];
      };
      list_task_assignees: {
        Args: never;
        Returns: {
          full_name: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
        }[];
      };
      manage_project_task_from_task_center: {
        Args: {
          assigned_user_id?: string;
          planned_on?: string;
          target_task_id: string;
          task_note?: string;
          task_title: string;
        };
        Returns: undefined;
      };
      notification_email_for_user: {
        Args: { target_user_id: string };
        Returns: Json;
      };
      notification_emails_for_roles: {
        Args: { target_roles: Database["public"]["Enums"]["app_role"][] };
        Returns: Json;
      };
      notification_phone_for_user: {
        Args: { target_user_id: string };
        Returns: Json;
      };
      notification_phones_for_roles: {
        Args: { target_roles: Database["public"]["Enums"]["app_role"][] };
        Returns: Json;
      };
      notify_overdue_tasks: { Args: never; Returns: undefined };
      remove_project_task_from_task_center: {
        Args: { target_task_id: string };
        Returns: undefined;
      };
      review_progress_update: {
        Args: {
          approve_update: boolean;
          manager_review_note?: string;
          target_progress_update_id: string;
        };
        Returns: undefined;
      };
      review_project_task_progress: {
        Args: {
          approve_submission: boolean;
          decision_note?: string;
          target_submission_id: string;
        };
        Returns: undefined;
      };
      review_work_completion: {
        Args: {
          approve_completion: boolean;
          manager_review_note?: string;
          target_work_order_id: string;
        };
        Returns: undefined;
      };
      save_customer_details: {
        Args: {
          customer_billing_address: string;
          customer_billing_title: string;
          customer_contact: string;
          customer_name: string;
          customer_tax_no: string;
          customer_tax_office: string;
          target_contact_user_id?: string;
          target_customer_id?: string;
        };
        Returns: string;
      };
      send_notification_email: {
        Args: { event_type: string; notification_data: Json; recipients: Json };
        Returns: undefined;
      };
      send_whatsapp_notification: {
        Args: { message: string; recipients: Json };
        Returns: undefined;
      };
      set_user_role: {
        Args: {
          new_role: Database["public"]["Enums"]["app_role"];
          target_user_id: string;
        };
        Returns: undefined;
      };
      set_work_order_customer_visibility: {
        Args: { target_work_order_id: string; visible: boolean };
        Returns: undefined;
      };
      submit_progress_update: {
        Args: {
          evidence_photo_type?: Database["public"]["Enums"]["photo_type"];
          evidence_storage_path: string;
          new_pct: number;
          progress_note: string;
          target_work_order_id: string;
        };
        Returns: string;
      };
      submit_project_task_progress: {
        Args: {
          actual_on?: string;
          progress_note: string;
          proposed_progress: number;
          target_task_id: string;
        };
        Returns: string;
      };
      submit_work_for_review: {
        Args: {
          completion_photo_ids: string[];
          submitted_completion_note: string;
          target_work_order_id: string;
        };
        Returns: string;
      };
      update_operational_task: {
        Args: {
          assigned_user_id?: string;
          new_status?: Database["public"]["Enums"]["project_task_status"];
          planned_on?: string;
          target_customer_id?: string;
          target_project_id?: string;
          target_task_id: string;
          task_description?: string;
          task_title: string;
        };
        Returns: undefined;
      };
      update_operational_task_technical: {
        Args: {
          assigned_user_id?: string;
          new_status?: Database["public"]["Enums"]["project_task_status"];
          planned_on?: string;
          target_customer_id?: string;
          target_project_id?: string;
          target_task_id: string;
          task_description?: string;
          task_title: string;
        };
        Returns: undefined;
      };
      update_project_details: {
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
          project_target_end_date?: string;
          target_manager_id?: string;
          target_project_id: string;
          visible_to_customer?: boolean;
        };
        Returns: undefined;
      };
      update_project_lifecycle: {
        Args: {
          change_note?: string;
          new_status: Database["public"]["Enums"]["project_status"];
          target_project_id: string;
        };
        Returns: Database["public"]["Enums"]["project_status"];
      };
      update_project_task: {
        Args: {
          actual_on?: string;
          assigned_user_id?: string;
          new_status: Database["public"]["Enums"]["project_task_status"];
          planned_on?: string;
          target_task_id: string;
          task_note?: string;
          task_system?: string;
        };
        Returns: undefined;
      };
      update_project_task_technical: {
        Args: {
          actual_on?: string;
          new_status: Database["public"]["Enums"]["project_task_status"];
          planned_on?: string;
          target_task_id: string;
          task_note?: string;
          task_system?: string;
        };
        Returns: undefined;
      };
      update_work_order_commercials: {
        Args: {
          new_contractor_labor_amount: number;
          new_customer_labor_amount: number;
          new_customer_material_amount: number;
          new_default_material_source: string;
          new_estimated_material_cost: number;
          new_work_scope_type: string;
          target_work_order_id: string;
        };
        Returns: undefined;
      };
      update_work_order_schedule: {
        Args: { new_scheduled_at: string; target_work_order_id: string };
        Returns: undefined;
      };
      update_work_order_task: {
        Args: {
          assigned_user_id?: string;
          order_location_url?: string;
          order_planned_end_at?: string;
          planned_at: string;
          save_as_draft?: boolean;
          target_work_order_id: string;
          task_description: string;
          task_title: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: "admin" | "contractor" | "customer" | "technical_office";
      photo_type: "saha" | "montaj_sonrasi" | "malzeme" | "diger";
      project_progress_submission_status:
        "pending" | "approved" | "revision_requested";
      project_status:
        "draft" | "active" | "on_hold" | "completed" | "cancelled";
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
      work_status:
        | "draft"
        | "planned"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "review_pending";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

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
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
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
      app_role: ["admin", "contractor", "customer", "technical_office"],
      photo_type: ["saha", "montaj_sonrasi", "malzeme", "diger"],
      project_progress_submission_status: [
        "pending",
        "approved",
        "revision_requested",
      ],
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
      work_status: [
        "draft",
        "planned",
        "in_progress",
        "completed",
        "cancelled",
        "review_pending",
      ],
    },
  },
} as const;
