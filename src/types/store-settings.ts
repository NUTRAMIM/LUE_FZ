import type { Database } from './database'

export type StoreSettings = Database['public']['Tables']['store_settings']['Row']
export type StoreSettingsInsert = Database['public']['Tables']['store_settings']['Insert']
export type StoreSettingsUpdate = Database['public']['Tables']['store_settings']['Update']
