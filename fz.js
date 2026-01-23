const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState
} = require('@whiskeysockets/baileys');

const { exec } = require('child_process');
const util = require('util');
const readline = require('readline');

const execAsync = util.promisify(exec);
const searches = new Map();

/* ================= START ================= */
async function start() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    // 🔑 Pairing Code Login
    if (!state.creds.registered) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question('📱 Enter phone number (country code, no +): ', async (number) => {
            const code = await sock.requestPairingCode(number.trim());
            console.log(`\n🔑 Pairing Code: ${code}\n`);
            rl.close();
        });
    }

    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'close') {
            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) start();
            else console.log('❌ Logged out. Delete session folder.');
        }

        if (connection === 'open') {
            console.log('✅ Movie Bot Online');
            console.log('Use: .movie <movie name>');
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
            if (text.startsWith('.movie')) {
                await handleMovieSearch(sock, chatId, text);
            } else if (/^[1-5]$/.test(text.trim())) {
                await handleMovieChoice(sock, chatId, Number(text.trim()));
            }
        } catch (e) {
            console.error(e);
            await sock.sendMessage(chatId, { text: '❌ Error occurred.' });
        }
    });
}

/* ================= SEARCH ================= */
async function handleMovieSearch(sock, chatId, text) {
    const query = text.replace('.movie', '').trim();
    if (!query) {
        await sock.sendMessage(chatId, { text: '🎬 Usage: .movie <name>' });
        return;
    }

    await sock.sendMessage(chatId, { text: `🔎 Searching *${query}*...` });

    const { stdout } = await execAsync(`python3 fzmovies.py "${query}" --list`);
    const lines = stdout.trim().split('\n').filter(Boolean);

    if (!lines.length) {
        await sock.sendMessage(chatId, { text: '❌ No results found.' });
        return;
    }

    const results = lines.slice(0, 5).map(l => {
        const [link, title, year, quality] = l.split('|');
        return { link, title, year, quality };
    });

    searches.set(chatId, { results });

    let msg = `🎬 Results:\n\nReply with 1–${results.length}\n\n`;
    results.forEach((r, i) => {
        msg += `${i + 1}. ${r.title} (${r.year}) | ${r.quality}\n`;
    });

    await sock.sendMessage(chatId, { text: msg });
}

/* ================= CHOICE ================= */
async function handleMovieChoice(sock, chatId, num) {
    const data = searches.get(chatId);
    if (!data || !data.results[num - 1]) {
        await sock.sendMessage(chatId, { text: '❌ Invalid choice.' });
        return;
    }

    const movie = data.results[num - 1];
    await sock.sendMessage(chatId, { text: `🎬 Fetching *${movie.title}*...` });

    const { stdout } = await execAsync(`python3 fzmovies.py "${movie.link}"`);
    const links = stdout.trim().split('\n').filter(Boolean);

    if (!links.length) {
        await sock.sendMessage(chatId, { text: '❌ No download links.' });
        return;
    }

    let msg = `🎬 Download Links:\n\n`;
    links.forEach((l, i) => msg += `${i + 1}. ${l}\n`);

    await sock.sendMessage(chatId, { text: msg });
    searches.delete(chatId);
}

/* ================= RUN ================= */
start().catch(console.error);
