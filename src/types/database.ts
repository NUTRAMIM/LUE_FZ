export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      products: {
        Row: {
          id: string
          user_id: string
          sku: string
          name: string
          description: string | null
          price: number
          compare_at_price: number | null
          currency: string
          category: string | null
          brand: string | null
          stock_quantity: number
          is_available: boolean
          image_urls: string[] | null
          variants: Json
          cores: string[]
          tamanhos: string[]
          attributes: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          sku: string
          name: string
          description?: string | null
          price: number
          compare_at_price?: number | null
          currency?: string
          category?: string | null
          brand?: string | null
          stock_quantity?: number
          image_urls?: string[] | null
          variants?: Json
          cores?: string[]
          tamanhos?: string[]
          attributes?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          sku?: string
          name?: string
          description?: string | null
          price?: number
          compare_at_price?: number | null
          currency?: string
          category?: string | null
          brand?: string | null
          stock_quantity?: number
          image_urls?: string[] | null
          variants?: Json
          cores?: string[]
          tamanhos?: string[]
          attributes?: Json
          updated_at?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          id: string
          status: 'ai_active' | 'human_active' | 'closed'
          assigned_to: string | null
          lead_id: string | null
          visitor_id: string
          title: string | null
          metadata: Json
          last_message_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          status?: 'ai_active' | 'human_active' | 'closed'
          assigned_to?: string | null
          lead_id?: string | null
          visitor_id: string
          title?: string | null
          metadata?: Json
          last_message_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          status?: 'ai_active' | 'human_active' | 'closed'
          assigned_to?: string | null
          lead_id?: string | null
          visitor_id?: string
          title?: string | null
          metadata?: Json
          last_message_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          id: string
          conversation_id: string
          role: 'user' | 'assistant' | 'operator' | 'system'
          content: string
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          conversation_id: string
          role: 'user' | 'assistant' | 'operator' | 'system'
          content: string
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          conversation_id?: string
          role?: 'user' | 'assistant' | 'operator' | 'system'
          content?: string
          metadata?: Json
        }
        Relationships: []
      }
      leads: {
        Row: {
          id: string
          whatsapp: string | null
          name: string | null
          email: string | null
          source: string
          first_seen_at: string
          last_seen_at: string
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          whatsapp?: string | null
          name?: string | null
          email?: string | null
          source?: string
          first_seen_at?: string
          last_seen_at?: string
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          whatsapp?: string | null
          name?: string | null
          email?: string | null
          source?: string
          last_seen_at?: string
          metadata?: Json
        }
        Relationships: []
      }
      n8n_webhook_log: {
        Row: {
          id: string
          message_id: string
          status: 'pending' | 'processing' | 'completed' | 'failed'
          error: string | null
          created_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          message_id: string
          status?: 'pending' | 'processing' | 'completed' | 'failed'
          error?: string | null
          created_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          message_id?: string
          status?: 'pending' | 'processing' | 'completed' | 'failed'
          error?: string | null
          completed_at?: string | null
        }
        Relationships: []
      }
      store_settings: {
        Row: {
          id: string
          store_name: string
          service_steps: string[]
          service_instructions: string
          payment_methods: string[]
          delivery_methods: string[]
          categories: string[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          store_name: string
          service_steps?: string[]
          service_instructions?: string
          payment_methods?: string[]
          delivery_methods?: string[]
          categories?: string[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          store_name?: string
          service_steps?: string[]
          service_instructions?: string
          payment_methods?: string[]
          delivery_methods?: string[]
          categories?: string[]
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
