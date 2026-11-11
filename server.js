const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.use(cors());
app.use(express.json());

const server = app.listen(process.env.PORT || 3000, () => console.log('Server jalan di port 3000'));
const wss = new WebSocketServer({ server });

let sock = null;
let isConnected = false;

async function connectToWhatsApp() {
    // Menyimpan sesi login di folder 'auth_info_baileys'
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Kita pake Pairing Code, bukan QR
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

// Handle WebSocket dari Frontend
wss.on('connection', (ws) => {
    console.log('Frontend terhubung ke WebSocket');
    
    ws.on('message', async (message) => {
        const msg = JSON.parse(message);
        
        if (msg.type === 'request_pairing' && msg.phone) {
            if (!sock) await connectToWhatsApp();
            
            // Bersihin nomor HP dari karakter aneh
            const phoneNumber = msg.phone.replace(/[^0-9]/g, '');
            
            try {
                // Minta kode pairing ke WhatsApp
                const code = await sock.requestPairingCode(phoneNumber);
                ws.send(JSON.stringify({ type: 'pairing_code', data: code }));
            } catch (err) {
                ws.send(JSON.stringify({ type: 'error', data: err.message }));
            }
        }
    });
});

// API buat Kirim Pesan (Buat nanti)
app.post('/api/send', async (req, res) => {
    if (!isConnected || !sock) return res.status(400).json({ success: false, message: 'WhatsApp belum terhubung!' });
    const { target, message } = req.body;
    if (!target || !message) return res.status(400).json({ success: false, message: 'Target dan pesan wajib diisi!' });

    try {
        const formattedTarget = target.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        await sock.sendMessage(formattedTarget, { text: message });
        res.json({ success: true, message: 'Pesan berhasil terkirim!' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

connectToWhatsApp();
