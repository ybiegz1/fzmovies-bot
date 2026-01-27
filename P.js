// index.js — WhatsApp .play bot (yt-dlp + MP3 + auto PTT + trim intro + 128kbps + queue + repeatable .play)

const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState
} = require('@whiskeysockets/baileys');

const readline = require('readline');
const ytsr = require('ytsr');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, r));

const searches = new Map();        // chatId -> { videos, time }
const downloadQueue = new Map();   // chatId -> promise

const MAX_AUDIO_MB = 15;
const TRIM_SECONDS = 5;
const BITRATE = 128;
const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

/* ================= BOT START ================= */

async function start() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'close') {
            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) start();
            else console.log('Logged out. Delete session folder.');
        }

        if (connection === 'open') {
            console.log('✅ Yossi’s Music Bot online');
            console.log('Use: .play <song>');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m?.message) return;

        const chatId = m.key.remoteJid;
        const text =
            m.message.conversation ||
            m.message.extendedTextMessage?.text ||
            '';

        try {
            if (text.startsWith('.play')) {
                downloadQueue.delete(chatId);
                await handlePlay(sock, chatId, m, text);
            } else if (/^[1-5]$/.test(text.trim())) {
                const prev = downloadQueue.get(chatId) || Promise.resolve();
                const next = prev.then(() =>
                    handleChoice(sock, chatId, m, Number(text.trim()))
                );
                downloadQueue.set(chatId, next);
                await next;
                downloadQueue.delete(chatId);
            }
        } catch (err) {
            console.error('Message handler error:', err);
            await sock.sendMessage(chatId, { text: '❌ Something went wrong.' });
        }
    });

    if (!state.creds.registered) {
        const phone = await ask('Enter phone number (+123...): ');
        const code = await sock.requestPairingCode(phone.trim());
        console.log('Pairing code:', code);
    }
}

/* ================= SEARCH ================= */

async function handlePlay(sock, chatId, m, text) {
    const query = text.replace('.play', '').trim();
    if (!query) {
        await sock.sendMessage(chatId, {
            text: '🎶 *Yossi’s Music Bot*\n\nExample:\n.play shape of you'
        });
        return;
    }

    const search = await ytsr(query, { limit: 10 });

    const videos = search.items
        .filter(v =>
            v.type === 'video' &&
            v.url &&
            !v.isLive &&
            !v.url.includes('shorts') &&
            v.duration
        )
        .slice(0, 5);

    if (!videos.length) {
        await sock.sendMessage(chatId, { text: 'No valid MP3-ready videos found.' });
        return;
    }

    let msg =
        `🎶 *Yossi’s Music Bot*\n` +
        `━━━━━━━━━━━━━━━\n` +
        `🎵 *Results for:* ${query}\n` +
        `Reply with *1–5* to download\n\n`;

    videos.forEach((v, i) => {
        msg += `${i + 1}. ${v.title} (${v.duration})\n`;
    });

    searches.set(chatId, { videos, time: Date.now() });

    await sock.sendMessage(chatId, { text: msg });
}

/* ================= DOWNLOAD ================= */

async function handleChoice(sock, chatId, m, num) {
    const data = searches.get(chatId);
    if (!data || Date.now() - data.time > 300000) {
        await sock.sendMessage(chatId, {
            text: 'Search expired. Use .play again.'
        });
        return;
    }

    const video = data.videos[num - 1];
    if (!video) {
        await sock.sendMessage(chatId, {
            text: 'Choose a number between 1 and 5.'
        });
        return;
    }

    const safeTitle = video.title.replace(/[^\w\s-]/g, '').slice(0, 60);
    const base = path.join(__dirname, `song_${Date.now()}`);
    const mp3File = `${base}.mp3`;

    try {
        await sock.sendMessage(chatId, {
            text: `⬇️ Downloading:\n*${video.title}*`
        });

        await execAsync(`
yt-dlp "${video.url}" \
-f bestaudio \
--extract-audio \
--audio-format mp3 \
--audio-quality 5 \
--postprocessor-args "-ss ${TRIM_SECONDS} -b:a ${BITRATE}k" \
--user-agent "${USER_AGENT}" \
-o "${base}.%(ext)s"
        `);

        await new Promise(r => setTimeout(r, 1500));

        if (!fs.existsSync(mp3File)) throw new Error('MP3 not created');

        const buffer = fs.readFileSync(mp3File);
        const sizeMB = buffer.length / 1024 / 1024;

        await sock.sendMessage(
            chatId,
            {
                audio: buffer,
                mimetype: 'audio/mpeg',
                fileName: `${safeTitle}.mp3`,
                ptt: sizeMB > MAX_AUDIO_MB
            },
            { quoted: m }
        );

        await sock.sendMessage(chatId, {
            react: { text: '✅', key: m.key }
        });

        searches.delete(chatId);

    } catch (err) {
        console.error('Download/send failed:', err);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to download or send audio.'
        });
    } finally {
        if (fs.existsSync(mp3File)) fs.unlinkSync(mp3File);
    }
}

/* ================= RUN BOT ================= */

start().catch(console.error);

