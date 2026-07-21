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
      work_orders: {
        Row: {
          created_at: string;
          created_by: string | null;
          customer_id: string;
          description: string | null;
          id: string;
          location: string | null;
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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      approve_progress: {
        Args: {
          approved_pct_value: number;
          target_work_order_id: string;
        };
        Returns: number;
      };
      consume_stock_item: {
        Args: {
          consumed_quantity: number;
          movement_note?: string | null;
          target_stock_item_id: string;
          target_work_order_id: string;
        };
        Returns: undefined;
      };
      create_work_order: {
        Args: {
          assigned_contractor_id?: string | null;
          order_description: string;
          order_location: string;
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
          progress_note?: string | null;
          target_work_order_id: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: "admin" | "contractor" | "customer";
      photo_type: "saha" | "montaj_sonrasi" | "malzeme" | "diger";
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
      stock_unit: ["adet", "metre"],
      work_status: ["planned", "in_progress", "completed", "cancelled"],
    },
  },
} as const;
