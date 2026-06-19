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
      terms_acceptances: {
        Row: {
          id: string
          user_id: string
          terms_version: string
          accepted_at: string
          ip: string | null
          user_agent: string | null
        }
        Insert: {
          id?: string
          user_id: string
          terms_version: string
          accepted_at?: string
          ip?: string | null
          user_agent?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          terms_version?: string
          accepted_at?: string
          ip?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      ai_usage_daily: {
        Row: {
          store_id: string
          day: string
          model: string
          prompt_tokens: number
          completion_tokens: number
          total_tokens: number
          cached_tokens: number
          calls: number
          updated_at: string
        }
        Insert: {
          store_id: string
          day: string
          model?: string
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
          cached_tokens?: number
          calls?: number
          updated_at?: string
        }
        Update: {
          store_id?: string
          day?: string
          model?: string
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
          cached_tokens?: number
          calls?: number
          updated_at?: string
        }
        Relationships: []
      }
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
          stock_min: number
          is_available: boolean
          image_urls: string[] | null
          video_url: string | null
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
          stock_min?: number
          image_urls?: string[] | null
          video_url?: string | null
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
          stock_min?: number
          image_urls?: string[] | null
          video_url?: string | null
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
          store_id: string | null
          last_read_at: string | null
          closed_at: string | null
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
          store_id?: string | null
          last_read_at?: string | null
          closed_at?: string | null
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
          store_id?: string | null
          last_read_at?: string | null
          closed_at?: string | null
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
          message_type: 'text' | 'image' | 'audio'
          media_path: string | null
          store_id: string
          latency_ms: number | null
          reply_to_message_id: string | null
        }
        Insert: {
          id?: string
          conversation_id: string
          role: 'user' | 'assistant' | 'operator' | 'system'
          content: string
          metadata?: Json
          created_at?: string
          message_type?: 'text' | 'image' | 'audio'
          media_path?: string | null
          store_id?: string
          latency_ms?: number | null
          reply_to_message_id?: string | null
        }
        Update: {
          id?: string
          conversation_id?: string
          role?: 'user' | 'assistant' | 'operator' | 'system'
          content?: string
          metadata?: Json
          message_type?: 'text' | 'image' | 'audio'
          media_path?: string | null
          store_id?: string
          latency_ms?: number | null
          reply_to_message_id?: string | null
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
          store_id: string | null
          conversation_id: string | null
          cep: string | null
          interest_summary: string | null
          contacted_at: string | null
          contacted_by: string | null
          contacted_by_name: string | null
          pedido: Json
          forma_pagamento: string | null
          forma_entrega: string | null
          valor_total: number | null
          tipo_cliente: string
          carro_chefe: string | null
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
          store_id?: string | null
          conversation_id?: string | null
          cep?: string | null
          interest_summary?: string | null
          contacted_at?: string | null
          contacted_by?: string | null
          contacted_by_name?: string | null
          pedido?: Json
          forma_pagamento?: string | null
          forma_entrega?: string | null
          valor_total?: number | null
          tipo_cliente?: string
          carro_chefe?: string | null
        }
        Update: {
          id?: string
          whatsapp?: string | null
          name?: string | null
          email?: string | null
          source?: string
          last_seen_at?: string
          metadata?: Json
          store_id?: string | null
          conversation_id?: string | null
          cep?: string | null
          interest_summary?: string | null
          contacted_at?: string | null
          contacted_by?: string | null
          contacted_by_name?: string | null
          pedido?: Json
          forma_pagamento?: string | null
          forma_entrega?: string | null
          valor_total?: number | null
          tipo_cliente?: string
          carro_chefe?: string | null
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
          default_stock_min: number
          created_at: string
          updated_at: string
          chat_slug: string
          seller_phone: string
          instagram_handle: string
          store_bio: string
          logo_url: string
          min_order_enabled: boolean
          min_order_quantity: number | null
          min_order_value: number | null
          min_order_logic: 'all' | 'any'
          inventory_source_url: string | null
          inventory_last_synced_at: string | null
          inventory_last_error: string | null
          faq: Array<{ pergunta: string; resposta: string }>
          discount_type: 'percent_piece' | 'percent_order' | 'fixed_piece' | 'custom' | null
          discount_value: number | null
          discount_custom: string | null
        }
        Insert: {
          id: string
          store_name: string
          service_steps?: string[]
          service_instructions?: string
          payment_methods?: string[]
          delivery_methods?: string[]
          categories?: string[]
          default_stock_min?: number
          created_at?: string
          updated_at?: string
          chat_slug?: string
          seller_phone?: string
          instagram_handle?: string
          store_bio?: string
          logo_url?: string
          min_order_enabled?: boolean
          min_order_quantity?: number | null
          min_order_value?: number | null
          min_order_logic?: 'all' | 'any'
          inventory_source_url?: string | null
          inventory_last_synced_at?: string | null
          inventory_last_error?: string | null
          faq?: Array<{ pergunta: string; resposta: string }>
          discount_type?: 'percent_piece' | 'percent_order' | 'fixed_piece' | 'custom' | null
          discount_value?: number | null
          discount_custom?: string | null
        }
        Update: {
          id?: string
          store_name?: string
          service_steps?: string[]
          service_instructions?: string
          payment_methods?: string[]
          delivery_methods?: string[]
          categories?: string[]
          default_stock_min?: number
          updated_at?: string
          chat_slug?: string
          seller_phone?: string
          instagram_handle?: string
          store_bio?: string
          logo_url?: string
          min_order_enabled?: boolean
          min_order_quantity?: number | null
          min_order_value?: number | null
          min_order_logic?: 'all' | 'any'
          inventory_source_url?: string | null
          inventory_last_synced_at?: string | null
          inventory_last_error?: string | null
          faq?: Array<{ pergunta: string; resposta: string }>
          discount_type?: 'percent_piece' | 'percent_order' | 'fixed_piece' | 'custom' | null
          discount_value?: number | null
          discount_custom?: string | null
        }
        Relationships: []
      }
      store_members: {
        Row: {
          id: string
          store_id: string
          user_id: string
          role: 'owner' | 'agent'
          full_name: string
          created_at: string
        }
        Insert: {
          id?: string
          store_id: string
          user_id: string
          role?: 'owner' | 'agent'
          full_name: string
          created_at?: string
        }
        Update: {
          id?: string
          store_id?: string
          user_id?: string
          role?: 'owner' | 'agent'
          full_name?: string
          created_at?: string
        }
        Relationships: []
      }
      store_invites: {
        Row: {
          id: string
          store_id: string
          email: string
          full_name: string
          token: string
          invited_by: string
          expires_at: string
          accepted_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          store_id: string
          email: string
          full_name: string
          token: string
          invited_by: string
          expires_at: string
          accepted_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          store_id?: string
          email?: string
          full_name?: string
          token?: string
          invited_by?: string
          expires_at?: string
          accepted_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      knowledge_gaps: {
        Row: {
          id: string
          store_id: string
          question: string
          tag: string
          resolved_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          store_id: string
          question: string
          tag?: string
          resolved_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          store_id?: string
          question?: string
          tag?: string
          resolved_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      product_mentions: {
        Row: {
          id: string
          store_id: string
          conversation_id: string | null
          product_id: string
          source: 'ai_shown' | 'customer_asked'
          created_at: string
        }
        Insert: {
          id?: string
          store_id: string
          conversation_id?: string | null
          product_id: string
          source: 'ai_shown' | 'customer_asked'
          created_at?: string
        }
        Update: {
          id?: string
          store_id?: string
          conversation_id?: string | null
          product_id?: string
          source?: 'ai_shown' | 'customer_asked'
          created_at?: string
        }
        Relationships: []
      }
      store_subscriptions: {
        Row: {
          id: string
          store_id: string
          plan_id: string
          provider: 'stripe' | 'mercadopago' | 'manual'
          status: 'active' | 'past_due' | 'canceled' | 'pending' | 'incomplete'
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          stripe_price_id: string | null
          mp_customer_id: string | null
          mp_subscription_id: string | null
          mp_payment_id: string | null
          current_period_end: string | null
          cancel_at_period_end: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          store_id: string
          plan_id: string
          provider: 'stripe' | 'mercadopago' | 'manual'
          status: 'active' | 'past_due' | 'canceled' | 'pending' | 'incomplete'
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          stripe_price_id?: string | null
          mp_customer_id?: string | null
          mp_subscription_id?: string | null
          mp_payment_id?: string | null
          current_period_end?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          store_id?: string
          plan_id?: string
          provider?: 'stripe' | 'mercadopago' | 'manual'
          status?: 'active' | 'past_due' | 'canceled' | 'pending' | 'incomplete'
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          stripe_price_id?: string | null
          mp_customer_id?: string | null
          mp_subscription_id?: string | null
          mp_payment_id?: string | null
          current_period_end?: string | null
          cancel_at_period_end?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      payment_events: {
        Row: {
          id: string
          provider: 'stripe' | 'mercadopago'
          type: string
          payload: Json
          processed_at: string
        }
        Insert: {
          id: string
          provider: 'stripe' | 'mercadopago'
          type: string
          payload: Json
          processed_at?: string
        }
        Update: {
          id?: string
          provider?: 'stripe' | 'mercadopago'
          type?: string
          payload?: Json
          processed_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      painel_atividade_ia: {
        Args: { p_inicio: string }
        Returns: {
          store_id: string
          ia_mensagens: number
          atendimentos: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
  }
}
