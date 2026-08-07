/**
 * Placeholder Database types matching the schema in
 * supabase/migrations/0001_initial_schema.sql (+ 0002–0004).
 *
 * Overwrite this file after applying migrations:
 *
 *   npx supabase gen types typescript --project-id zqzctlekmvunyhdxihvf > types/database.ts
 *
 * Project ref: Supabase Dashboard → Project Settings → General → Reference ID
 * (also the subdomain in NEXT_PUBLIC_SUPABASE_URL).
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      tours: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          description: string | null;
          slug: string;
          cover_scene_id: string | null;
          is_public: boolean;
          password_hash: string | null;
          default_hotspot_shape: string;
          default_hotspot_color: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          title?: string;
          description?: string | null;
          slug: string;
          cover_scene_id?: string | null;
          is_public?: boolean;
          password_hash?: string | null;
          default_hotspot_shape?: string;
          default_hotspot_color?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          title?: string;
          description?: string | null;
          slug?: string;
          cover_scene_id?: string | null;
          is_public?: boolean;
          password_hash?: string | null;
          default_hotspot_shape?: string;
          default_hotspot_color?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tours_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_cover_scene";
            columns: ["cover_scene_id"];
            isOneToOne: false;
            referencedRelation: "scenes";
            referencedColumns: ["id"];
          },
        ];
      };
      scenes: {
        Row: {
          id: string;
          tour_id: string;
          name: string;
          storage_path: string;
          thumbnail_path: string | null;
          position: number;
          initial_yaw: number;
          initial_pitch: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          name?: string;
          storage_path: string;
          thumbnail_path?: string | null;
          position?: number;
          initial_yaw?: number;
          initial_pitch?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string;
          name?: string;
          storage_path?: string;
          thumbnail_path?: string | null;
          position?: number;
          initial_yaw?: number;
          initial_pitch?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scenes_tour_id_fkey";
            columns: ["tour_id"];
            isOneToOne: false;
            referencedRelation: "tours";
            referencedColumns: ["id"];
          },
        ];
      };
      hotspots: {
        Row: {
          id: string;
          scene_id: string;
          target_scene_id: string | null;
          type: string;
          yaw: number;
          pitch: number;
          label: string | null;
          content: string | null;
          style_shape: string;
          style_color: string;
          style_size: number;
          style_animation: string;
          label_visibility: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          scene_id: string;
          target_scene_id?: string | null;
          type?: string;
          yaw: number;
          pitch: number;
          label?: string | null;
          content?: string | null;
          style_shape?: string;
          style_color?: string;
          style_size?: number;
          style_animation?: string;
          label_visibility?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          scene_id?: string;
          target_scene_id?: string | null;
          type?: string;
          yaw?: number;
          pitch?: number;
          label?: string | null;
          content?: string | null;
          style_shape?: string;
          style_color?: string;
          style_size?: number;
          style_animation?: string;
          label_visibility?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "hotspots_scene_id_fkey";
            columns: ["scene_id"];
            isOneToOne: false;
            referencedRelation: "scenes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hotspots_target_scene_id_fkey";
            columns: ["target_scene_id"];
            isOneToOne: false;
            referencedRelation: "scenes";
            referencedColumns: ["id"];
          },
        ];
      };
      tour_views: {
        Row: {
          id: string;
          tour_id: string;
          viewed_at: string;
          referrer: string | null;
        };
        Insert: {
          id?: string;
          tour_id: string;
          viewed_at?: string;
          referrer?: string | null;
        };
        Update: {
          id?: string;
          tour_id?: string;
          viewed_at?: string;
          referrer?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tour_views_tour_id_fkey";
            columns: ["tour_id"];
            isOneToOne: false;
            referencedRelation: "tours";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      tour_view_counts: {
        Row: {
          tour_id: string;
          view_count: number;
        };
        Relationships: [
          {
            foreignKeyName: "tour_views_tour_id_fkey";
            columns: ["tour_id"];
            isOneToOne: true;
            referencedRelation: "tours";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
