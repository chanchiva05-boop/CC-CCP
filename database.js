/**
 * ============================================
 *  CASE MANAGER - DATABASE MODULE
 *  Multi-User Support + Notification System
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
      req.onsuccess = () => { this.db = req.result; console.log('✅ UserDB initialized'); resolve(this.db); };
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
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
    await NotificationDB.clearUser(id);
    return true;
  },

  async setMeta(key, value) {
    return this._tx(this.metaStore, 'readwrite', (store) => store.put({ key, value }));
  },

  async getMeta(key) {
    const result = await this._tx(this.metaStore, 'readonly', (store) => store.get(key));
    return result?.value;
  },

  async setCurrentUser(userId) { return this.setMeta('currentUserId', userId); },
  async getCurrentUser() { return this.getMeta('currentUserId'); },
  async clearCurrentUser() { return this.setMeta('currentUserId', null); },

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
    localStorage.setItem(this.prefix(uid) + key, JSON.stringify(value));
  },
  remove(uid, key) { localStorage.removeItem(this.prefix(uid) + key); },
  clearAll(uid) {
    const pfx = this.prefix(uid);
    const keys = Object.keys(localStorage).filter(k => k.startsWith(pfx));
    keys.forEach(k => localStorage.removeItem(k));
  },
  async copyTo(fromUid, toUid) {
    const keys = ['cases', 'clients'];
    for (const key of keys) {
      this.set(toUid, key, this.get(fromUid, key));
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
        localStorage.removeItem('cases');
        localStorage.removeItem('clients');
        return { cases: legacyCases.length, clients: legacyClients.length };
      }
    } catch (e) { console.error('Migration error:', e); }
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
    return docs.length;
  },
  async getStats(userId) {
    const docs = await this.getByUser(userId);
    return { count: docs.length, totalSize: docs.reduce((s, d) => s + (d.size || 0), 0) };
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
      if (session.expiresAt < Date.now()) { this.destroy(); return null; }
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
  isValid() { return this.get() !== null; }
};


// ============================================================
// NOTIFICATION MODULE
// ============================================================

const NotificationDB = {
  dbName: 'CaseManagerNotifications',
  storeName: 'notifications',
  db: null,

  async init() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { this.db = req.result; console.log('✅ NotificationDB initialized'); resolve(this.db); };
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('caseId', 'caseId', { unique: false });
          store.createIndex('scheduledFor', 'scheduledFor', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('user_status', ['userId', 'status'], { unique: false });
        }
      };
    });
  },

  async add(notif) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).put(notif);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async get(id) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async getByUser(userId, status = null) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      if (status) {
        const idx = store.index('user_status');
        const req = idx.getAll([userId, status]);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      } else {
        const idx = store.index('userId');
        const req = idx.getAll(userId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      }
    });
  },

  async getPending() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const idx = tx.objectStore(this.storeName).index('status');
      const req = idx.getAll('pending');
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async update(id, updates) {
    const notif = await this.get(id);
    if (!notif) throw new Error('NOT_FOUND');
    const updated = { ...notif, ...updates };
    await this.add(updated);
    return updated;
  },

  async delete(id) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  async deleteByCase(caseId, userId) {
    const all = await this.getByUser(userId);
    const toDelete = all.filter(n => n.caseId === caseId);
    for (const n of toDelete) await this.delete(n.id);
    return toDelete.length;
  },

  async clearUser(userId) {
    const all = await this.getByUser(userId);
    for (const n of all) await this.delete(n.id);
    return all.length;
  }
};


const NotificationManager = {
  DAYS_BEFORE: 2,
  CHECK_INTERVAL: 30 * 60 * 1000,
  _intervalId: null,

  async requestPermission() {
    if (!('Notification' in window)) {
      console.warn('⚠️ Browser មិនស្គាល់ Notification');
      return false;
    }
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  },

  getPermissionStatus() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  },

  async scheduleForCase(userId, caseData) {
    if (!caseData.nextHearing || !caseData.id) return null;

    await NotificationDB.deleteByCase(caseData.id, userId);

    const hearingDate = new Date(caseData.nextHearing);
    hearingDate.setHours(0, 0, 0, 0);

    const notifyDate = new Date(hearingDate);
    notifyDate.setDate(notifyDate.getDate() - this.DAYS_BEFORE);
    notifyDate.setHours(9, 0, 0, 0);

    const now = new Date();
    if (hearingDate < now) {
      console.log('⏭️ Hearing date passed, skip:', caseData.caseNumber);
      return null;
    }

    let scheduledFor = notifyDate.getTime();
    if (notifyDate <= now) {
      scheduledFor = now.getTime() + 5000;
    }

    const notif = {
      id: 'ntf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      userId,
      caseId: caseData.id,
      caseNumber: caseData.caseNumber,
      caseTitle: caseData.title,
      court: caseData.court,
      hearingDate: caseData.nextHearing,
      notifyDate: new Date(scheduledFor).toISOString(),
      scheduledFor,
      status: 'pending',
      type: 'hearing_reminder',
      daysBefore: this.DAYS_BEFORE,
      createdAt: new Date().toISOString()
    };

    await NotificationDB.add(notif);
    await this.sendToServiceWorker(notif);
    console.log(`📅 Scheduled: ${caseData.caseNumber} → ${new Date(scheduledFor).toLocaleString('km-KH')}`);
    return notif;
  },

  async sendToServiceWorker(notif) {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!reg.active) return;
      const hearingDate = new Date(notif.hearingDate);
      hearingDate.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const daysLeft = Math.round((hearingDate - today) / 86400000);

      let title, body;
      if (daysLeft === 0) {
        title = '⚖️ ថ្ងៃនេះមានកាលបរិច្ឆេទតុលាការ!';
        body = `${notif.caseNumber} - ${notif.caseTitle}\n🏛️ ${notif.court || ''}`;
      } else if (daysLeft === 1) {
        title = '⚠️ ស្អែកមានកាលបរិច្ឆេទតុលាការ!';
        body = `${notif.caseNumber} - ${notif.caseTitle}\n🏛️ ${notif.court || ''}`;
      } else {
        title = `📅 នៅសល់ ${daysLeft} ថ្ងៃទៀតមានកាលបរិច្ឆេទ`;
        body = `${notif.caseNumber} - ${notif.caseTitle}\n🏛️ ${notif.court || ''}\n📆 ${notif.hearingDate}`;
      }

      reg.active.postMessage({
        type: 'SCHEDULE_NOTIFICATION',
        payload: {
          id: notif.id,
          scheduledFor: notif.scheduledFor,
          title,
          body,
          data: { caseId: notif.caseId, url: './index.html?page=calendar' }
        }
      });
    } catch (e) {
      console.warn('SW send error:', e);
    }
  },

  async checkAndFire() {
    const pending = await NotificationDB.getPending();
    const now = Date.now();
    const fired = [];

    for (const notif of pending) {
      if (notif.scheduledFor <= now) {
        const hearingDate = new Date(notif.hearingDate);
        hearingDate.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const daysLeft = Math.round((hearingDate - today) / 86400000);

        if (daysLeft < 0) {
          await NotificationDB.update(notif.id, { status: 'expired' });
          continue;
        }

        await this.showNotification(notif, daysLeft);
        await NotificationDB.update(notif.id, {
          status: 'sent',
          sentAt: new Date().toISOString()
        });
        fired.push(notif);
      }
    }
    return fired;
  },

  async showNotification(notif, daysLeft) {
    let title, body;

    if (daysLeft === 0) {
      title = '⚖️ ថ្ងៃនេះមានកាលបរិច្ឆេទតុលាការ!';
      body = `${notif.caseNumber} - ${notif.caseTitle}\n🏛️ ${notif.court || ''}`;
    } else if (daysLeft === 1) {
      title = '⚠️ ស្អែកមានកាលបរិច្ឆេទតុលាការ!';
      body = `${notif.caseNumber} - ${notif.caseTitle}\n🏛️ ${notif.court || ''}`;
    } else {
      title = `📅 នៅសល់ ${daysLeft} ថ្ងៃទៀតមានកាលបរិច្ឆេទ`;
      body = `${notif.caseNumber} - ${notif.caseTitle}\n🏛️ ${notif.court || ''}\n📆 ${notif.hearingDate}`;
    }

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const reg = await navigator.serviceWorker?.ready;
        if (reg) {
          await reg.showNotification(title, {
            body,
            icon: './icon-192.png',
            badge: './icon-192.png',
            tag: 'hearing-' + notif.caseId,
            requireInteraction: true,
            vibrate: [200, 100, 200, 100, 200],
            data: { caseId: notif.caseId, url: './index.html?page=calendar' },
            actions: [
              { action: 'view', title: '👁️ មើល' },
              { action: 'dismiss', title: 'បិទ' }
            ]
          });
        } else {
          new Notification(title, { body, icon: './icon-192.png' });
        }
      } catch (e) { console.warn('Notification error:', e); }
    }

    window.dispatchEvent(new CustomEvent('hearing-notification', {
      detail: { notif, daysLeft }
    }));
  },

  async getUserNotifications(userId) {
    const all = await NotificationDB.getByUser(userId);
    return all.sort((a, b) => b.scheduledFor - a.scheduledFor);
  },

  async getUnreadCount(userId) {
    const all = await NotificationDB.getByUser(userId);
    return all.filter(n => n.status === 'sent' && !n.readAt).length;
  },

  async markAsRead(notifId) {
    return NotificationDB.update(notifId, { readAt: new Date().toISOString() });
  },

  async markAllAsRead(userId) {
    const all = await NotificationDB.getByUser(userId);
    for (const n of all) {
      if (n.status === 'sent' && !n.readAt) {
        await NotificationDB.update(n.id, { readAt: new Date().toISOString() });
      }
    }
  },

  startAutoCheck(userId) {
    this.stopAutoCheck();
    this.checkAndFire();
    this._intervalId = setInterval(() => this.checkAndFire(), this.CHECK_INTERVAL);
    console.log('🔔 Notification auto-check started');
  },

  stopAutoCheck() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
      console.log('🔕 Notification auto-check stopped');
    }
  },

  async rescheduleAll(userId, cases) {
    await NotificationDB.clearUser(userId);
    let scheduled = 0;
    for (const c of cases) {
      if (c.nextHearing) {
        const n = await this.scheduleForCase(userId, c);
        if (n) scheduled++;
      }
    }
    console.log(`📅 Rescheduled ${scheduled} notifications`);
    return scheduled;
  }
};


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
window.NotificationDB = NotificationDB;
window.NotificationManager = NotificationManager;
