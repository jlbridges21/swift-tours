/**
 * Database types. Overwrite after applying migrations:
 *
 *   npx supabase gen types typescript --project-id zqzctlekmvunyhdxihvf > types/database.ts
 *
 * After 0019_virtual_staging.sql, regenerate so room_type / staging_plan /
 * staging_views / job step columns stay in sync.
 *
 *   npx supabase gen types typescript --project-id zqzctlekmvunyhdxihvf > types/database.ts
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
          start_scene_id: string | null;
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
          walkthrough_enabled: boolean;
          gyroscope_enabled: boolean;
          vr_enabled: boolean;
          staging_plan: Json | null;
          staging_style: string | null;
          staging_seed: number | null;
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
          start_scene_id?: string | null;
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
          walkthrough_enabled?: boolean;
          gyroscope_enabled?: boolean;
          vr_enabled?: boolean;
          staging_plan?: Json | null;
          staging_style?: string | null;
          staging_seed?: number | null;
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
          start_scene_id?: string | null;
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
          walkthrough_enabled?: boolean;
          gyroscope_enabled?: boolean;
          vr_enabled?: boolean;
          staging_plan?: Json | null;
          staging_style?: string | null;
          staging_seed?: number | null;
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
          {
            foreignKeyName: "fk_start_scene";
            columns: ["start_scene_id"];
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
          cleaned_path: string | null;
          cleaned_compat_path: string | null;
          cleaned_enabled: boolean;
          staged_path: string | null;
          staged_compat_path: string | null;
          staged_enabled: boolean;
          room_type: string | null;
          staging_candidate_path: string | null;
          staging_candidate_job_id: string | null;
          adjust_brightness: number;
          adjust_contrast: number;
          adjust_saturation: number;
          position: number;
          initial_yaw: number;
          initial_pitch: number;
          has_initial_view: boolean;
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
          cleaned_path?: string | null;
          cleaned_compat_path?: string | null;
          cleaned_enabled?: boolean;
          staged_path?: string | null;
          staged_compat_path?: string | null;
          staged_enabled?: boolean;
          room_type?: string | null;
          staging_candidate_path?: string | null;
          staging_candidate_job_id?: string | null;
          adjust_brightness?: number;
          adjust_contrast?: number;
          adjust_saturation?: number;
          position?: number;
          initial_yaw?: number;
          initial_pitch?: number;
          has_initial_view?: boolean;
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
          cleaned_path?: string | null;
          cleaned_compat_path?: string | null;
          cleaned_enabled?: boolean;
          staged_path?: string | null;
          staged_compat_path?: string | null;
          staged_enabled?: boolean;
          room_type?: string | null;
          staging_candidate_path?: string | null;
          staging_candidate_job_id?: string | null;
          adjust_brightness?: number;
          adjust_contrast?: number;
          adjust_saturation?: number;
          position?: number;
          initial_yaw?: number;
          initial_pitch?: number;
          has_initial_view?: boolean;
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
          position_mode: string;
          style_rotation: number;
          orient_yaw: number;
          orient_pitch: number;
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
          position_mode?: string;
          style_rotation?: number;
          orient_yaw?: number;
          orient_pitch?: number;
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
          position_mode?: string;
          style_rotation?: number;
          orient_yaw?: number;
          orient_pitch?: number;
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
      tour_sessions: {
        Row: {
          id: string;
          tour_id: string;
          visitor_id: string;
          is_embed: boolean;
          started_at: string;
          duration_ms: number;
        };
        Insert: {
          id: string;
          tour_id: string;
          visitor_id: string;
          is_embed?: boolean;
          started_at?: string;
          duration_ms?: number;
        };
        Update: {
          id?: string;
          tour_id?: string;
          visitor_id?: string;
          is_embed?: boolean;
          started_at?: string;
          duration_ms?: number;
        };
        Relationships: [
          {
            foreignKeyName: "tour_sessions_tour_id_fkey";
            columns: ["tour_id"];
            isOneToOne: false;
            referencedRelation: "tours";
            referencedColumns: ["id"];
          },
        ];
      };
      scene_dwell: {
        Row: {
          id: string;
          session_id: string;
          scene_id: string;
          dwell_ms: number;
        };
        Insert: {
          id?: string;
          session_id: string;
          scene_id: string;
          dwell_ms?: number;
        };
        Update: {
          id?: string;
          session_id?: string;
          scene_id?: string;
          dwell_ms?: number;
        };
        Relationships: [
          {
            foreignKeyName: "scene_dwell_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "tour_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scene_dwell_scene_id_fkey";
            columns: ["scene_id"];
            isOneToOne: false;
            referencedRelation: "scenes";
            referencedColumns: ["id"];
          },
        ];
      };
      hotspot_clicks: {
        Row: {
          id: string;
          session_id: string;
          hotspot_id: string;
          clicked_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          hotspot_id: string;
          clicked_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          hotspot_id?: string;
          clicked_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "hotspot_clicks_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "tour_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hotspot_clicks_hotspot_id_fkey";
            columns: ["hotspot_id"];
            isOneToOne: false;
            referencedRelation: "hotspots";
            referencedColumns: ["id"];
          },
        ];
      };
      staging_jobs: {
        Row: {
          id: string;
          tour_id: string;
          scene_id: string | null;
          kind: string;
          status: string;
          params: Json;
          result_path: string | null;
          error: string | null;
          cost_cents: number | null;
          provider: string | null;
          provider_job_id: string | null;
          step: number;
          total_steps: number | null;
          view_results: Json;
          reference_paths: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          scene_id?: string | null;
          kind: string;
          status?: string;
          params?: Json;
          result_path?: string | null;
          error?: string | null;
          cost_cents?: number | null;
          provider?: string | null;
          provider_job_id?: string | null;
          step?: number;
          total_steps?: number | null;
          view_results?: Json;
          reference_paths?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string;
          scene_id?: string | null;
          kind?: string;
          status?: string;
          params?: Json;
          result_path?: string | null;
          error?: string | null;
          cost_cents?: number | null;
          provider?: string | null;
          provider_job_id?: string | null;
          step?: number;
          total_steps?: number | null;
          view_results?: Json;
          reference_paths?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staging_jobs_tour_id_fkey";
            columns: ["tour_id"];
            isOneToOne: false;
            referencedRelation: "tours";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staging_jobs_scene_id_fkey";
            columns: ["scene_id"];
            isOneToOne: false;
            referencedRelation: "scenes";
            referencedColumns: ["id"];
          },
        ];
      };
      staging_views: {
        Row: {
          id: string;
          scene_id: string;
          job_id: string;
          view_index: number;
          yaw: number;
          pitch: number;
          fov: number;
          source_path: string | null;
          result_path: string | null;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          scene_id: string;
          job_id: string;
          view_index: number;
          yaw: number;
          pitch: number;
          fov: number;
          source_path?: string | null;
          result_path?: string | null;
          status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          scene_id?: string;
          job_id?: string;
          view_index?: number;
          yaw?: number;
          pitch?: number;
          fov?: number;
          source_path?: string | null;
          result_path?: string | null;
          status?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staging_views_scene_id_fkey";
            columns: ["scene_id"];
            isOneToOne: false;
            referencedRelation: "scenes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staging_views_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "staging_jobs";
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
      tour_analytics_summary: {
        Args: {
          p_tour_id: string;
          p_since?: string | null;
        };
        Returns: Json;
      };
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
