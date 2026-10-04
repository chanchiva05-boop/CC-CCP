/**
 * ============================================
 *  CASE MANAGER - DATABASE MODULE
 *  Multi-User Support with Data Isolation
 *  ============================================
 */

const UserDB = {
  dbName: 'CaseManagerUsers',
  version: 1,
  db: null,
  storeName: 'users',
  metaStore: 'meta',

  async init() {
    if (this.db) return this.db;
    
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.version);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        this.db = req.result;
        console.log('✅ UserDB initialized');
        resolve(this.db);
      };
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        console.log('🔧 Upgrading UserDB...');
        
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('username', 'username', { unique: true });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('lastLogin', 'lastLogin', { unique: false });
        }
        
        if (!db.objectStoreNames.contains(this.metaStore)) {
          db.createObjectStore(this.metaStore, { keyPath: 'key' });
        }
      };
    });
  },

  async _tx(storeName, mode, callback) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const req = callback(store);
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      req.onerror = () => reject(req.error);
    });
  },

  async createUser({ name, username, password, role = 'admin' }) {
    await this.init();
    const existing = await this.findByUsername(username);
    if (existing) throw new Error('USERNAME_EXISTS');
    
    const hashedPass = await this.hashPassword(password);
    const user = {
      id: 'usr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      name: name.trim(),
      username: username.trim().toLowerCase(),
      password: hashedPass,
      role,
      createdAt: new Date().toISOString(),
      lastLogin: null,
      loginCount: 0,
      settings: { theme: 'light', language: 'km', notifications: true }
    };
    
    await this._tx(this.storeName, 'readwrite', (store) => store.add(user));
    return user;
  },

  async findByUsername(username) {
    await this.init();
    const uname = username.trim().toLowerCase();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const idx = tx.objectStore(this.storeName).index('username');
      const req = idx.get(uname);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async getUser(id) {
    return this._tx(this.storeName, 'readonly', (store) => store.get(id));
  },

  async getAllUsers() {
    return this._tx(this.storeName, 'readonly', (store) => store.getAll());
  },

  async updateUser(id, updates) {
    const user = await this.getUser(id);
    if (!user) throw new Error('USER_NOT_FOUND');
    delete updates.password;
    delete updates.id;
    delete updates.username;
    const updated = { ...user, ...updates };
    await this._tx(this.storeName, 'readwrite', (store) => store.put(updated));
    return updated;
  },

  async recordLogin(id) {
    const user = await this.getUser(id);
    if (!user) return;
    user.lastLogin = new Date().toISOString();
    user.loginCount = (user.loginCount || 0) + 1;
    await this._tx(this.storeName, 'readwrite', (store) => store.put(user));
    return user;
  },

  async changePassword(id, oldPass, newPass) {
    const user = await this.getUser(id);
    if (!user) throw new Error('USER_NOT_FOUND');
    const oldHash = await this.hashPassword(oldPass);
    if (user.password !== oldHash) throw new Error('WRONG_PASSWORD');
    user.password = await this.hashPassword(newPass);
    user.passwordChangedAt = new Date().toISOString();
    await this._tx(this.storeName, 'readwrite', (store) => store.put(user));
    return true;
  },

  async deleteUser(id) {
    await this._tx(this.storeName, 'readwrite', (store) => store.delete(id));
    await UserData.clearAll(id);
    await UserFileDB.clearUser(id);
    return true;
  },

  async setMeta(key, value) {
    return this._tx(this.metaStore, 'readwrite', (store) => store.put({ key, value }));
  },

  async getMeta(key) {
    const result = await this._tx(this.metaStore, 'readonly', (store) => store.get(key));
    return result?.value;
  },

  async setCurrentUser(userId) {
    return this.setMeta('currentUserId', userId);
  },

  async getCurrentUser() {
    return this.getMeta('currentUserId');
  },

  async clearCurrentUser() {
    return this.setMeta('currentUserId', null);
  },

  async hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + '|case-manager-v2-salt');
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  async verifyPassword(userId, password) {
    const user = await this.getUser(userId);
    if (!user) return false;
    const hash = await this.hashPassword(password);
    return user.password === hash;
  }
};


const UserData = {
  prefix(uid) { return `cm_${uid}_`; },

  get(uid, key, def = []) {
    try {
      const fullKey = this.prefix(uid) + key;
      const raw = localStorage.getItem(fullKey);
      return raw ? JSON.parse(raw) : def;
    } catch { return def; }
  },

  set(uid, key, value) {
    const fullKey = this.prefix(uid) + key;
    localStorage.setItem(fullKey, JSON.stringify(value));
  },

  remove(uid, key) {
    localStorage.removeItem(this.prefix(uid) + key);
  },

  clearAll(uid) {
    const pfx = this.prefix(uid);
    const keys = Object.keys(localStorage).filter(k => k.startsWith(pfx));
    keys.forEach(k => localStorage.removeItem(k));
    console.log(`🗑️ Cleared ${keys.length} keys for user ${uid}`);
  },

  async copyTo(fromUid, toUid) {
    const keys = ['cases', 'clients'];
    for (const key of keys) {
      const data = this.get(fromUid, key);
      this.set(toUid, key, data);
    }
  },

  getStats(uid) {
    return {
      cases: this.get(uid, 'cases').length,
      clients: this.get(uid, 'clients').length
    };
  },

  async migrateFromLegacy(userId) {
    try {
      const legacyCases = JSON.parse(localStorage.getItem('cases') || '[]');
      const legacyClients = JSON.parse(localStorage.getItem('clients') || '[]');
      
      if (legacyCases.length || legacyClients.length) {
        this.set(userId, 'cases', legacyCases);
        this.set(userId, 'clients', legacyClients);
        
        localStorage.setItem('_migrated_cases_backup', JSON.stringify(legacyCases));
        localStorage.setItem('_migrated_clients_backup', JSON.stringify(legacyClients));
        
        localStorage.removeItem('cases');
        localStorage.removeItem('clients');
        
        console.log(`✅ Migrated ${legacyCases.length} cases, ${legacyClients.length} clients`);
        return { cases: legacyCases.length, clients: legacyClients.length };
      }
    } catch (e) {
      console.error('Migration error:', e);
    }
    return null;
  }
};


const UserFileDB = {
  dbName: 'CaseManagerFilesV2',
  storeName: 'documents',
  db: null,

  async init() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('caseId', 'caseId', { unique: false });
          store.createIndex('user_case', ['userId', 'caseId'], { unique: false });
          store.createIndex('uploadedAt', 'uploadedAt', { unique: false });
        }
      };
    });
  },

  async add(doc) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).put(doc);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async get(id, userId) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).get(id);
      req.onsuccess = () => {
        const doc = req.result;
        if (doc && userId && doc.userId !== userId) resolve(null);
        else resolve(doc);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async getByUser(userId) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const idx = tx.objectStore(this.storeName).index('userId');
      const req = idx.getAll(userId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async getByCase(userId, caseId) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const idx = tx.objectStore(this.storeName).index('user_case');
      const req = idx.getAll([userId, Number(caseId)]);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async delete(id, userId) {
    if (!this.db) await this.init();
    const doc = await this.get(id, userId);
    if (!doc) throw new Error('NOT_FOUND_OR_NO_PERMISSION');
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  async clearUser(userId) {
    if (!this.db) await this.init();
    const docs = await this.getByUser(userId);
    for (const doc of docs) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction(this.storeName, 'readwrite');
        const req = tx.objectStore(this.storeName).delete(doc.id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
    console.log(`🗑️ Cleared ${docs.length} files for user ${userId}`);
  },

  async getStats(userId) {
    const docs = await this.getByUser(userId);
    return {
      count: docs.length,
      totalSize: docs.reduce((s, d) => s + (d.size || 0), 0)
    };
  }
};


const Session = {
  KEY: 'cm_session',
  DURATION: 8 * 60 * 60 * 1000,

  create(userId, remember = false) {
    const session = {
      userId,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.DURATION,
      remember
    };
    const storage = remember ? localStorage : sessionStorage;
    storage.setItem(this.KEY, JSON.stringify(session));
  },

  get() {
    try {
      const raw = localStorage.getItem(this.KEY) || sessionStorage.getItem(this.KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (session.expiresAt < Date.now()) {
        this.destroy();
        return null;
      }
      return session;
    } catch { return null; }
  },

  refresh() {
    const session = this.get();
    if (!session) return;
    session.expiresAt = Date.now() + this.DURATION;
    const storage = session.remember ? localStorage : sessionStorage;
    storage.setItem(this.KEY, JSON.stringify(session));
  },

  destroy() {
    localStorage.removeItem(this.KEY);
    sessionStorage.removeItem(this.KEY);
  },

  isValid() {
    return this.get() !== null;
  }
};


// Legacy FileDB (for migration only)
const FileDB = {
  dbName: 'CaseManagerFiles',
  storeName: 'documents',
  db: null,
  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('caseId', 'caseId', { unique: false });
        }
      };
    });
  },
  async getAll() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },
  async clear() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
};


window.UserDB = UserDB;
window.UserData = UserData;
window.UserFileDB = UserFileDB;
window.Session = Session;
window.FileDB = FileDB;
