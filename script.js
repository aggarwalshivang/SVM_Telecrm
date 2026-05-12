/**
 * State & Configuration
 */
let config = {
    supabaseUrl: 'https://kwzywcyjbawhtomswwtt.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3enl3Y3lqYmF3aHRvbXN3d3R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MjI5ODMsImV4cCI6MjA5NDA5ODk4M30.VSt5R7v5kesVIdczXkJjtQH8zklxV9If_4oai0-nKck',
    sendWebhookUrl: 'https://n8n.saraswatividyamandir.com/webhook/telecrm',
    pollIntervalSeconds: 10,
    authHeader: ''
};

let state = {
    contacts: [],
    messagesByContact: {},
    activeContactId: null,
    isPolling: false,
    pollTimer: null,
    searchQuery: '',
    demoMode: false
};

// DOM Elements
const DOM = {
    contactList: document.getElementById('contactList'),
    chatMessages: document.getElementById('chatMessages'),
    chatHeader: document.getElementById('chatHeader'),
    chatInputArea: document.getElementById('chatInputArea'),
    headerName: document.getElementById('headerName'),
    headerPhone: document.getElementById('headerPhone'),
    messageInput: document.getElementById('messageInput'),
    btnSend: document.getElementById('btnSend'),
    btnMarkRead: document.getElementById('btnMarkRead'),
    btnManualRefresh: document.getElementById('btnManualRefresh'),
    btnNewChat: document.getElementById('btnNewChat'),
    newChatModal: document.getElementById('newChatModal'),
    btnCloseNewChat: document.getElementById('btnCloseNewChat'),
    btnCancelNewChat: document.getElementById('btnCancelNewChat'),
    btnStartChat: document.getElementById('btnStartChat'),
    newChatPhone: document.getElementById('newChatPhone'),
    newChatName: document.getElementById('newChatName'),
    searchInput: document.getElementById('searchInput'),
    settingsModal: document.getElementById('settingsModal'),
    syncIndicator: document.getElementById('syncIndicator'),
    syncText: document.getElementById('syncText'),
    demoBanner: document.getElementById('demoBanner'),
    toastContainer: document.getElementById('toastContainer')
};

/**
 * Initialization
 */
function init() {
    loadConfig();
    setupEventListeners();

    if (!config.supabaseUrl || !config.supabaseAnonKey) {
        state.demoMode = true;
        DOM.demoBanner.style.display = 'block';
        loadDemoData();
        showSettings();
    } else {
        state.demoMode = false;
        DOM.demoBanner.style.display = 'none';
        startPolling();
        // Initial fetch
        pollTick();
    }
}

function setupEventListeners() {
    // Settings Modal
    document.getElementById('btnSettings').addEventListener('click', showSettings);
    document.getElementById('btnCloseSettings').addEventListener('click', hideSettings);
    document.getElementById('btnCancelSettings').addEventListener('click', hideSettings);
    document.getElementById('btnSaveSettings').addEventListener('click', saveConfig);

    // Guide Toggle
    document.getElementById('btnToggleGuide').addEventListener('click', () => {
        document.getElementById('guideContent').classList.toggle('open');
    });

    // New Chat Modal
    DOM.btnNewChat.addEventListener('click', showNewChat);
    DOM.btnCloseNewChat.addEventListener('click', hideNewChat);
    DOM.btnCancelNewChat.addEventListener('click', hideNewChat);
    DOM.btnStartChat.addEventListener('click', startNewChat);

    // Chat actions
    DOM.btnManualRefresh.addEventListener('click', () => {
        showToast('Manual refresh triggered', 'info');
        pollTick(true); // force
    });

    // Input handling
    DOM.messageInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        DOM.btnSend.disabled = this.value.trim().length === 0;
    });

    DOM.messageInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            triggerSend();
        }
    });

    DOM.btnSend.addEventListener('click', triggerSend);

    // Search
    DOM.searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.toLowerCase();
        renderSidebar();
    });
}

/**
 * Config Management
 */
function loadConfig() {
    const saved = localStorage.getItem('wad_config');
    if (saved) {
        try {
            config = { ...config, ...JSON.parse(saved) };
        } catch (e) { console.error('Failed to parse config'); }
    }
}

function saveConfig() {
    config.supabaseUrl = document.getElementById('configSupabaseUrl').value.trim();
    config.supabaseAnonKey = document.getElementById('configSupabaseKey').value.trim();
    config.sendWebhookUrl = document.getElementById('configWebhookUrl').value.trim();
    config.authHeader = document.getElementById('configAuthHeader').value.trim();
    config.pollIntervalSeconds = parseInt(document.getElementById('configPollInterval').value, 10);

    localStorage.setItem('wad_config', JSON.stringify(config));
    hideSettings();
    showToast('Configuration saved successfully', 'success');

    // Restart with new config
    stopPolling();
    init();
}

function showSettings() {
    document.getElementById('configSupabaseUrl').value = config.supabaseUrl;
    document.getElementById('configSupabaseKey').value = config.supabaseAnonKey;
    document.getElementById('configWebhookUrl').value = config.sendWebhookUrl;
    document.getElementById('configAuthHeader').value = config.authHeader;
    document.getElementById('configPollInterval').value = config.pollIntervalSeconds;
    DOM.settingsModal.classList.add('active');
}

function hideSettings() {
    DOM.settingsModal.classList.remove('active');
}

function showNewChat() {
    DOM.newChatPhone.value = '';
    DOM.newChatName.value = '';
    DOM.newChatModal.classList.add('active');
    setTimeout(() => DOM.newChatPhone.focus(), 100);
}

function hideNewChat() {
    DOM.newChatModal.classList.remove('active');
}

function startNewChat() {
    let phone = DOM.newChatPhone.value.replace(/[^0-9]/g, '');
    let name = DOM.newChatName.value.trim();

    if (!phone) {
        showToast('Please enter a valid phone number', 'error');
        return;
    }

    // Check if contact already exists
    let contact = state.contacts.find(c => c.id === phone);
    
    if (!contact) {
        // Create local optimistic contact
        contact = {
            id: phone,
            phone: phone,
            name: name,
            updated_at: new Date().toISOString()
        };
        // Add to beginning of array
        state.contacts.unshift(contact);
        state.messagesByContact[phone] = [];
    } else if (name && !contact.name) {
        // Update name if it was empty
        contact.name = name;
    }

    hideNewChat();
    selectContact(phone);
    showToast('Conversation started', 'success');
}

/**
 * API Calls
 */
function getHeaders() {
    return {
        'apikey': config.supabaseAnonKey,
        'Authorization': `Bearer ${config.supabaseAnonKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    };
}

async function fetchContacts() {
    if (state.demoMode) return;

    try {
        // Fetch from the view instead of the contacts table
        const url = `${config.supabaseUrl}/rest/v1/contacts_view?select=*&order=updated_at.desc`;
        const res = await fetch(url, { headers: getHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        
        // Preserve local optimistic contacts that haven't synced to DB yet
        const localOptimistic = state.contacts.filter(oldC => {
            const inDb = data.some(newC => newC.id === oldC.id);
            if (inDb) return false;
            
            // Keep if it's the active chat OR if we've sent optimistic messages to it
            const hasMessages = state.messagesByContact[oldC.id] && state.messagesByContact[oldC.id].length > 0;
            return oldC.id === state.activeContactId || hasMessages;
        });

        state.contacts = [...localOptimistic, ...data];
        renderSidebar();
    } catch (err) {
        console.error('Fetch contacts error:', err);
        setSyncStatus('error');
    }
}

async function fetchMessages(phone) {
    if (state.demoMode) return;

    try {
        // Query messages by phone
        const url = `${config.supabaseUrl}/rest/v1/messages?phone=eq.${phone}&order=timestamp.asc`;
        const res = await fetch(url, { headers: getHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        
        // Merge with optimistic messages (ones we just sent that haven't synced yet)
        const oldMessages = state.messagesByContact[phone] || [];
        const optimisticMessages = oldMessages.filter(m => String(m.id).startsWith('temp_'));
        
        const survivingOptimistic = optimisticMessages.filter(optMsg => {
            // Check if DB already has this message (same body and direction)
            const dbHasIt = data.some(dbMsg => 
                dbMsg.body === optMsg.body && 
                dbMsg.direction === optMsg.direction
            );
            return !dbHasIt; // keep if DB doesn't have it yet
        });

        state.messagesByContact[phone] = [...data, ...survivingOptimistic];
        
        if (state.activeContactId === phone) {
            renderChat();
        }
    } catch (err) {
        console.error('Fetch messages error:', err);
    }
}

async function triggerSend() {
    const text = DOM.messageInput.value.trim();
    if (!text || !state.activeContactId) return;

    const contact = state.contacts.find(c => c.id === state.activeContactId);
    if (!contact) return;

    // Optimistic update
    const tempId = 'temp_' + Date.now();
    const optimisticMsg = {
        id: tempId,
        phone: contact.phone,
        name: contact.name,
        direction: 'outbound',
        body: text,
        timestamp: new Date().toISOString()
    };

    if (!state.messagesByContact[contact.id]) {
        state.messagesByContact[contact.id] = [];
    }
    state.messagesByContact[contact.id].push(optimisticMsg);

    DOM.messageInput.value = '';
    DOM.messageInput.style.height = 'auto';
    DOM.btnSend.disabled = true;
    renderChat();

    if (state.demoMode) {
        setTimeout(() => {
            renderChat();
            showToast('Demo mode: message sent', 'success');
        }, 1000);
        return;
    }

    // Real API Call
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (config.authHeader) {
            headers['Authorization'] = config.authHeader;
        }

        const res = await fetch(config.sendWebhookUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                to: contact.phone,
                name: contact.name || '',
                message: text
            })
        });

        if (!res.ok) throw new Error('Webhook rejected request');

        // Assume success if webhook responds 2xx
        showToast('Message sent', 'success');
        renderChat();

        // Force a poll to sync the DB status
        setTimeout(() => pollTick(true), 2000);

    } catch (err) {
        console.error('Send error:', err);
        showToast('Failed to send message', 'error');
        // Remove optimistic message or mark as failed
        state.messagesByContact[contact.id] = state.messagesByContact[contact.id].filter(m => m.id !== tempId);
        renderChat();
        // Restore text
        DOM.messageInput.value = text;
    }
}

// markAsRead functionality removed as status field was deleted

/**
 * Polling Logic
 */
function startPolling() {
    stopPolling();
    if (config.pollIntervalSeconds > 0) {
        state.pollTimer = setInterval(pollTick, config.pollIntervalSeconds * 1000);
    }
}

function stopPolling() {
    if (state.pollTimer) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
    }
}

async function pollTick(force = false) {
    if (state.isPolling && !force) return;
    state.isPolling = true;
    setSyncStatus('syncing');

    await fetchContacts();
    if (state.activeContactId) {
        await fetchMessages(state.activeContactId);
    }

    setSyncStatus('live');
    state.isPolling = false;
}

function setSyncStatus(status) {
    DOM.syncIndicator.className = 'sync-indicator';
    if (status === 'live') {
        DOM.syncIndicator.classList.add('live');
        DOM.syncText.textContent = 'Live';
    } else if (status === 'syncing') {
        DOM.syncText.textContent = 'Syncing...';
    } else if (status === 'error') {
        DOM.syncIndicator.classList.add('error');
        DOM.syncText.textContent = 'Error';
    } else {
        DOM.syncText.textContent = 'Idle';
    }
}

/**
 * UI Rendering
 */
function getInitials(name) {
    if (!name) return '#';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function formatRelativeTime(dateString) {
    if (!dateString) return '';
    const d = new Date(dateString);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function selectContact(id) {
    state.activeContactId = id;
    const contact = state.contacts.find(c => c.id === id);

    // Update Header
    DOM.headerName.textContent = contact.name || contact.phone;
    DOM.headerPhone.textContent = `+${contact.phone}`;
    DOM.chatHeader.style.display = 'flex';
    DOM.chatInputArea.style.display = 'flex';

    // Focus input
    DOM.messageInput.focus();

    renderSidebar(); // Update active highlight

    // Load messages
    if (!state.messagesByContact[id]) {
        DOM.chatMessages.innerHTML = '<div class="empty-state">Loading messages...</div>';
    } else {
        renderChat();
    }

    if (!state.demoMode) {
        fetchMessages(id);
    } else {
        renderChat();
    }
}

// Expose selectContact to global scope for inline handlers created in renderSidebar
window.selectContact = selectContact;

function renderSidebar() {
    let filtered = state.contacts;
    if (state.searchQuery) {
        filtered = filtered.filter(c =>
            (c.name && c.name.toLowerCase().includes(state.searchQuery)) ||
            (c.phone && c.phone.includes(state.searchQuery))
        );
    }

    if (filtered.length === 0) {
        DOM.contactList.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No leads found</div>';
        return;
    }

    const html = filtered.map(c => {
        const isActive = c.id === state.activeContactId ? 'active' : '';

        return `
        <div class="contact-item ${isActive}" onclick="selectContact('${c.id}')">
            <div class="avatar">${getInitials(c.name)}</div>
            <div class="contact-info">
                <div class="contact-top">
                    <span class="contact-name">${c.name || c.phone}</span>
                    <span class="contact-time">${formatRelativeTime(c.updated_at)}</span>
                </div>
                <div class="contact-bottom">
                    <span class="contact-preview">${c.phone}</span>
                </div>
            </div>
        </div>
        `;
    }).join('');

    DOM.contactList.innerHTML = html;
}

function renderChat() {
    if (!state.activeContactId) return;
    const msgs = state.messagesByContact[state.activeContactId] || [];

    if (msgs.length === 0) {
        DOM.chatMessages.innerHTML = '<div class="empty-state">No messages yet. Say hello!</div>';
        return;
    }

    let html = '';
    let lastDate = null;

    msgs.forEach(m => {
        // Date Divider Logic
        const msgDate = new Date(m.timestamp);
        const dateStr = msgDate.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });

        if (dateStr !== lastDate) {
            let displayDate = dateStr;
            const today = new Date().toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
            const yesterdayDate = new Date(Date.now() - 86400000);
            const yesterday = yesterdayDate.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });

            if (dateStr === today) displayDate = 'Today';
            else if (dateStr === yesterday) displayDate = 'Yesterday';

            html += `<div class="date-divider"><span>${displayDate}</span></div>`;
            lastDate = dateStr;
        }

        const timeStr = msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        html += `
        <div class="message-row ${m.direction}">
            <div class="message-bubble">
                <div class="message-body">${escapeHTML(m.body)}</div>
                <div class="message-meta">
                    <span class="message-time">${timeStr}</span>
                </div>
            </div>
        </div>
        `;
    });

    DOM.chatMessages.innerHTML = html;

    // Scroll to bottom safely
    requestAnimationFrame(() => {
        DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
    });
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

/**
 * Utilities
 */
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        ${type === 'success' ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>' : ''}
        ${type === 'error' ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>' : ''}
        <span>${message}</span>
    `;
    DOM.toastContainer.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 3500);
}

function loadDemoData() {
    state.contacts = [
        { id: '9434836393', phone: '9434836393', name: 'Ankit', updated_at: new Date().toISOString() },
        { id: '919876543210', phone: '919876543210', name: 'Alice Smith', updated_at: new Date(Date.now() - 3600000).toISOString() },
        { id: '919876543212', phone: '919876543212', name: 'Charlie Cafe', updated_at: new Date(Date.now() - 86400000).toISOString() }
    ];

    state.messagesByContact = {
        '9434836393': [
            { id: 'm1', phone: '9434836393', name: 'Ankit', direction: 'inbound', body: 'Hi, I would like to know more about your services.', timestamp: new Date(Date.now() - 3600000).toISOString() },
            { id: 'm2', phone: '9434836393', name: 'Ankit', direction: 'outbound', body: 'Hello Ankit! Sure, what specific services are you interested in?', timestamp: new Date(Date.now() - 3000000).toISOString() },
            { id: 'm3', phone: '9434836393', name: 'Ankit', direction: 'inbound', body: 'I am looking for lead generation.', timestamp: new Date().toISOString() }
        ],
        '919876543210': [
            { id: 'm4', phone: '919876543210', name: 'Alice Smith', direction: 'outbound', body: 'Great Alice! Would you like to schedule a quick call?', timestamp: new Date(Date.now() - 3500000).toISOString() }
        ],
        '919876543212': [
            { id: 'm5', phone: '919876543212', name: 'Charlie Cafe', direction: 'outbound', body: 'Hello Charlie Cafe, we help local businesses grow.', timestamp: new Date(Date.now() - 172800000).toISOString() },
            { id: 'm6', phone: '919876543212', name: 'Charlie Cafe', direction: 'inbound', body: 'Please send pricing details.', timestamp: new Date(Date.now() - 86400000).toISOString() }
        ]
    };

    renderSidebar();
    setSyncStatus('live');
}

function checkPinAuth() {
    const pinOverlay = document.getElementById('pinOverlay');
    const pinInput = document.getElementById('pinInput');
    const btnUnlock = document.getElementById('btnUnlock');
    
    // Use sessionStorage so they don't have to re-enter if they just refresh the tab
    if (sessionStorage.getItem('wad_auth') === 'true') {
        pinOverlay.style.display = 'none';
        init();
        return;
    }
    
    // Focus input on load
    setTimeout(() => pinInput.focus(), 100);
    
    function attemptUnlock() {
        if (pinInput.value === 'svmn8n151') {
            sessionStorage.setItem('wad_auth', 'true');
            pinOverlay.style.display = 'none';
            init();
        } else {
            showToast('Incorrect PIN', 'error');
            pinInput.value = '';
            pinInput.focus();
        }
    }
    
    btnUnlock.addEventListener('click', attemptUnlock);
    pinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') attemptUnlock();
    });
}

// Run
document.addEventListener('DOMContentLoaded', checkPinAuth);
