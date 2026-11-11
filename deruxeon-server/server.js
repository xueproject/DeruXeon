const express = require('express');
const path = require('path');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 1. SERVE FILE FRONTEND (HTML/CSS/JS)
// ==========================================
// Ini ngebuat Express nampilin file dari folder 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Kalau orang buka URL utama (/) arahkan ke index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 2. SETUP SERVER & WEBSOCKET
// ==========================================
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let sock = null;
let isConnected = false;

// ==========================================
// 3. LOGIC BAILEYS (WHATSAPP)
// ==========================================
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Pake Pairing Code
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
            else broadcast({ type: 'status', data: 'disconnected' });
        } else if (connection === 'open') {
            isConnected = true;
            console.log('✅ WhatsApp Berhasil Terhubung!');
            broadcast({ type: 'status', data: 'connected' });
        }
    });
}

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(JSON.stringify(data));
    });
}

// Handle WebSocket dari Frontend (Pairing)
wss.on('connection', (ws) => {
    console.log('Frontend terhubung ke WebSocket');
    ws.on('message', async (message) => {
        const msg = JSON.parse(message);
        
        if (msg.type === 'request_pairing' && msg.phone) {
            if (!sock) await connectToWhatsApp();
            const phoneNumber = msg.phone.replace(/[^0-9]/g, '');
            
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                ws.send(JSON.stringify({ type: 'pairing_code', data: code }));
            } catch (err) {
                ws.send(JSON.stringify({ type: 'error', data: err.message }));
            }
        }
    });
});

// ==========================================
// 4. API UNTUK KIRIM PESAN
// ==========================================
app.post('/api/send', async (req, res) => {
    if (!isConnected || !sock) {
        return res.status(400).json({ success: false, message: 'WhatsApp belum terhubung!' });
    }

    const { target, message } = req.body;
    if (!target || !message) {
        return res.status(400).json({ success: false, message: 'Target dan pesan wajib diisi!' });
    }

    try {
        const formattedTarget = target.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        await sock.sendMessage(formattedTarget, { text: message });
        res.json({ success: true, message: 'Pesan berhasil terkirim!' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// 5. JALANKAN SERVER
// ==========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server DeruXeon jalan di port ${PORT}`);
    connectToWhatsApp(); // Nyalain Baileys pas server nyala
});
