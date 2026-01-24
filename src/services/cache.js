/**
 * Frontend Cache Service
 * Provides in-memory and localStorage caching for API responses
 */

// In-memory cache (fastest, survives navigation)
const memoryCache = new Map();

// Cache configuration
const CACHE_CONFIG = {
  reports: { ttl: 10 * 60 * 1000, persist: true },      // 10 minutes, persist to localStorage
  dashboard: { ttl: 5 * 60 * 1000, persist: true },     // 5 minutes, persist to localStorage
  users: { ttl: 15 * 60 * 1000, persist: false },       // 15 minutes, memory only
  challenges: { ttl: 10 * 60 * 1000, persist: true },   // 10 minutes, persist to localStorage
  stats: { ttl: 5 * 60 * 1000, persist: true },         // 5 minutes, persist to localStorage
};

// Storage key prefix
const STORAGE_PREFIX = 'pcl_cache_';

/**
 * Generate cache key from type and params
 */
const getCacheKey = (type, params = {}) => {
  const paramStr = Object.entries(params)
    .filter(([_, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `${type}:${paramStr || 'default'}`;
};

/**
 * Get item from cache (memory first, then localStorage)
 */
export const cacheGet = (type, params = {}) => {
  const key = getCacheKey(type, params);
  const config = CACHE_CONFIG[type] || { ttl: 5 * 60 * 1000, persist: false };
  
  // Check memory cache first
  const memItem = memoryCache.get(key);
  if (memItem && Date.now() < memItem.expires) {
    return { data: memItem.data, cached: true, source: 'memory' };
  }
  
  // Check localStorage if persistence enabled
  if (config.persist) {
    try {
      const stored = localStorage.getItem(STORAGE_PREFIX + key);
      if (stored) {
        const item = JSON.parse(stored);
        if (Date.now() < item.expires) {
          // Restore to memory cache
          memoryCache.set(key, item);
          return { data: item.data, cached: true, source: 'storage' };
        } else {
          // Expired, remove from storage
          localStorage.removeItem(STORAGE_PREFIX + key);
        }
      }
    } catch (e) {
      console.warn('Cache read error:', e);
    }
  }
  
  return null;
};

/**
 * Set item in cache
 */
export const cacheSet = (type, params, data) => {
  const key = getCacheKey(type, params);
  const config = CACHE_CONFIG[type] || { ttl: 5 * 60 * 1000, persist: false };
  
  const item = {
    data,
    expires: Date.now() + config.ttl,
    timestamp: Date.now(),
  };
  
  // Always store in memory
  memoryCache.set(key, item);
  
  // Persist to localStorage if enabled
  if (config.persist) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(item));
    } catch (e) {
      // Storage full or disabled, continue with memory cache only
      console.warn('Cache write error:', e);
    }
  }
};

/**
 * Invalidate cache entries
 */
export const cacheInvalidate = (type, params = null) => {
  if (params) {
    // Invalidate specific key
    const key = getCacheKey(type, params);
    memoryCache.delete(key);
    localStorage.removeItem(STORAGE_PREFIX + key);
  } else {
    // Invalidate all entries of this type
    const prefix = `${type}:`;
    
    // Clear from memory
    for (const key of memoryCache.keys()) {
      if (key.startsWith(prefix)) {
        memoryCache.delete(key);
      }
    }
    
    // Clear from localStorage
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX + prefix)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  }
};

/**
 * Clear all cache
 */
export const cacheClear = () => {
  memoryCache.clear();
  
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
};

/**
 * Get cache stats (for debugging)
 */
export const cacheStats = () => {
  let memorySize = 0;
  let memoryCount = 0;
  let storageCount = 0;
  
  memoryCache.forEach((value, key) => {
    memoryCount++;
    memorySize += JSON.stringify(value).length;
  });
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) {
      storageCount++;
    }
  }
  
  return {
    memory: { count: memoryCount, sizeKB: Math.round(memorySize / 1024) },
    storage: { count: storageCount },
  };
};

/**
 * Higher-order function for cached API calls
 */
export const withCache = async (type, params, fetchFn) => {
  // Check cache first
  const cached = cacheGet(type, params);
  if (cached) {
    return { ...cached.data, _cached: true, _source: cached.source };
  }
  
  // Fetch fresh data
  const result = await fetchFn();
  
  // Cache successful results
  if (result.success) {
    cacheSet(type, params, result);
  }
  
  return { ...result, _cached: false };
};

export default {
  get: cacheGet,
  set: cacheSet,
  invalidate: cacheInvalidate,
  clear: cacheClear,
  stats: cacheStats,
  withCache,
};
