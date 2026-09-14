import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

/**
 * App namespace for storage keys
 */
const APP_NAMESPACE = '@meapp:';

/**
 * Storage keys used throughout the app
 */
export const STORAGE_KEYS = {
  REMEMBER_ME: `${APP_NAMESPACE}rememberMe`,
  SELECTED_CONVERSATION_ID: `${APP_NAMESPACE}selectedConversationId`,
} as const;

/**
 * Generic storage service for managing persistent data
 */
export const StorageService = {
  /**
   * Save data to storage
   */
  async setItem<T>(key: string, value: T): Promise<void> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Failed to save item with key "${key}":`, error);
      throw error;
    }
  },

  /**
   * Get data from storage with optional Zod schema validation
   * Returns null if not found or validation fails
   */
  async getItem<T>(key: string, schema?: z.ZodSchema<T>): Promise<T | null> {
    try {
      const item = await AsyncStorage.getItem(key);

      if (!item) {
        return null;
      }

      const parsedData: unknown = JSON.parse(item);

      // If schema provided, validate the data
      if (schema) {
        return schema.parse(parsedData);
      }

      return parsedData as T;
    } catch (error) {
      console.error(`Failed to get item with key "${key}":`, error);
      // Clear corrupted data
      await this.removeItem(key);
      return null;
    }
  },

  /**
   * Remove data from storage
   */
  async removeItem(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      console.error(`Failed to remove item with key "${key}":`, error);
      throw error;
    }
  },

  /**
   * Check if a key exists in storage
   */
  async hasItem(key: string): Promise<boolean> {
    try {
      const item = await AsyncStorage.getItem(key);
      return item !== null;
    } catch (error) {
      console.error(`Failed to check item with key "${key}":`, error);
      return false;
    }
  },

  /**
   * Clear all app data from storage
   */
  async clearAll(): Promise<void> {
    try {
      await AsyncStorage.clear();
    } catch (error) {
      console.error('Failed to clear storage:', error);
      throw error;
    }
  },
};

/**
 * Helper functions for remember me flag
 */
export const RememberMeStorage = {
  save: async () => StorageService.setItem(STORAGE_KEYS.REMEMBER_ME, true),

  get: async () => StorageService.getItem<boolean>(STORAGE_KEYS.REMEMBER_ME),

  clear: () => StorageService.removeItem(STORAGE_KEYS.REMEMBER_ME),

  has: () => StorageService.hasItem(STORAGE_KEYS.REMEMBER_ME),
};

/**
 * Helper functions for selected conversation ID
 */
export const ConversationStorage = {
  save: (id: string) =>
    StorageService.setItem(STORAGE_KEYS.SELECTED_CONVERSATION_ID, id),

  get: () =>
    StorageService.getItem<string>(STORAGE_KEYS.SELECTED_CONVERSATION_ID),

  clear: () => StorageService.removeItem(STORAGE_KEYS.SELECTED_CONVERSATION_ID),
};
