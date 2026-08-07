/**
 * Database types. Overwrite after applying migrations:
 *
 *   npx supabase gen types typescript --project-id zqzctlekmvunyhdxihvf > types/database.ts
 *
 * (Requires `supabase login` or SUPABASE_ACCESS_TOKEN.)
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
          nadir_type: string;
          nadir_logo_path: string | null;
          nadir_logo_source: string;
          nadir_size: number;
          nadir_opacity: number;
          nadir_rotation: number;
          nadir_feather: number;
          intro_effect: string;
          transition_effect: string;
          transition_speed: number;
          transition_zoom: boolean;
          transition_rotation: boolean;
          transition_motion_blur: boolean;
          gyroscope_enabled: boolean;
          vr_enabled: boolean;
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
          nadir_type?: string;
          nadir_logo_path?: string | null;
          nadir_logo_source?: string;
          nadir_size?: number;
          nadir_opacity?: number;
          nadir_rotation?: number;
          nadir_feather?: number;
          intro_effect?: string;
          transition_effect?: string;
          transition_speed?: number;
          transition_zoom?: boolean;
          transition_rotation?: boolean;
          transition_motion_blur?: boolean;
          gyroscope_enabled?: boolean;
          vr_enabled?: boolean;
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
          nadir_type?: string;
          nadir_logo_path?: string | null;
          nadir_logo_source?: string;
          nadir_size?: number;
          nadir_opacity?: number;
          nadir_rotation?: number;
          nadir_feather?: number;
          intro_effect?: string;
          transition_effect?: string;
          transition_speed?: number;
          transition_zoom?: boolean;
          transition_rotation?: boolean;
          transition_motion_blur?: boolean;
          gyroscope_enabled?: boolean;
          vr_enabled?: boolean;
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
          compat_path: string | null;
          width: number | null;
          height: number | null;
          file_size: number | null;
          nadir_patch_path: string | null;
          nadir_disabled: boolean;
          adjust_brightness: number;
          adjust_contrast: number;
          adjust_saturation: number;
          position: number;
          initial_yaw: number;
          initial_pitch: number;
          group_id: string | null;
          floor_plan_id: string | null;
          plan_x: number | null;
          plan_y: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          name?: string;
          storage_path: string;
          thumbnail_path?: string | null;
          compat_path?: string | null;
          width?: number | null;
          height?: number | null;
          file_size?: number | null;
          nadir_patch_path?: string | null;
          nadir_disabled?: boolean;
          adjust_brightness?: number;
          adjust_contrast?: number;
          adjust_saturation?: number;
          position?: number;
          initial_yaw?: number;
          initial_pitch?: number;
          group_id?: string | null;
          floor_plan_id?: string | null;
          plan_x?: number | null;
          plan_y?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string;
          name?: string;
          storage_path?: string;
          thumbnail_path?: string | null;
          compat_path?: string | null;
          width?: number | null;
          height?: number | null;
          file_size?: number | null;
          nadir_patch_path?: string | null;
          nadir_disabled?: boolean;
          adjust_brightness?: number;
          adjust_contrast?: number;
          adjust_saturation?: number;
          position?: number;
          initial_yaw?: number;
          initial_pitch?: number;
          group_id?: string | null;
          floor_plan_id?: string | null;
          plan_x?: number | null;
          plan_y?: number | null;
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
          {
            foreignKeyName: "scenes_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "scene_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scenes_floor_plan_id_fkey";
            columns: ["floor_plan_id"];
            isOneToOne: false;
            referencedRelation: "floor_plans";
            referencedColumns: ["id"];
          },
        ];
      };
      floor_plans: {
        Row: {
          id: string;
          tour_id: string;
          group_id: string | null;
          name: string;
          storage_path: string;
          width: number;
          height: number;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          group_id?: string | null;
          name?: string;
          storage_path: string;
          width: number;
          height: number;
          position?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string;
          group_id?: string | null;
          name?: string;
          storage_path?: string;
          width?: number;
          height?: number;
          position?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "floor_plans_tour_id_fkey";
            columns: ["tour_id"];
            isOneToOne: false;
            referencedRelation: "tours";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "floor_plans_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "scene_groups";
            referencedColumns: ["id"];
          },
        ];
      };
      scene_groups: {
        Row: {
          id: string;
          tour_id: string;
          name: string;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          name?: string;
          position?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string;
          name?: string;
          position?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scene_groups_tour_id_fkey";
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
          video_id: string | null;
          video_start: number | null;
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
          video_id?: string | null;
          video_start?: number | null;
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
          video_id?: string | null;
          video_start?: number | null;
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
      hotspot_images: {
        Row: {
          id: string;
          hotspot_id: string;
          storage_path: string;
          thumbnail_path: string | null;
          caption: string | null;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          hotspot_id: string;
          storage_path: string;
          thumbnail_path?: string | null;
          caption?: string | null;
          position?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          hotspot_id?: string;
          storage_path?: string;
          thumbnail_path?: string | null;
          caption?: string | null;
          position?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "hotspot_images_hotspot_id_fkey";
            columns: ["hotspot_id"];
            isOneToOne: false;
            referencedRelation: "hotspots";
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
