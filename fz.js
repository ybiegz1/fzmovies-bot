const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState
} = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const searches = new Map(); // chatId -> { query, results, timestamp }

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
            console.log('✅ Movie Bot online');
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
                await handleMovieSearch(sock, chatId, m, text);
            } else if (/^[1-5]$/.test(text.trim())) {
                const prev = searches.get(chatId);
                if (!prev) {
                    await sock.sendMessage(chatId, { text: '❌ No active search. Use .movie <name> first.' });
                    return;
                }
                await handleMovieChoice(sock, chatId, m, Number(text.trim()));
            }
        } catch (err) {
            console.error(err);
            await sock.sendMessage(chatId, { text: '❌ Something went wrong.' });
        }
    });
}

/* ================= SEARCH ================= */
async function handleMovieSearch(sock, chatId, m, text) {
    const query = text.replace('.movie', '').trim();
    if (!query) {
        await sock.sendMessage(chatId, { text: '🎬 Usage: .movie <movie name>' });
        return;
    }

    await sock.sendMessage(chatId, { text: `🔎 Searching for: *${query}* ...` });

    try {
        // Run Python script to get multiple search results
        const { stdout } = await execAsync(`python3 fzmovies.py "${query}" --list`);
        const lines = stdout.trim().split('\n').filter(Boolean);

        if (!lines.length) {
            await sock.sendMessage(chatId, { text: '❌ No movies found.' });
            return;
        }

        // Save results in memory
        const results = lines.map(line => {
            const parts = line.split('|'); // expecting Python prints: link|title|year|quality
            return {
                link: parts[0],
                title: parts[1],
                year: parts[2],
                quality: parts[3]
            };
        }).slice(0, 5); // show max 5

        searches.set(chatId, {
            query,
            results,
            timestamp: Date.now()
        });

        // Send list to user
        let msg = `🎬 Multiple results found for *${query}*:\n\nReply with 1–${results.length} to pick.\n\n`;
        results.forEach((r, i) => {
            msg += `${i + 1}. ${r.title} | ${r.year} | ${r.quality}\n`;
        });

        await sock.sendMessage(chatId, { text: msg });

    } catch (err) {
        console.error(err);
        await sock.sendMessage(chatId, { text: '❌ Failed to search movies.' });
    }
}

/* ================= CHOICE ================= */
async function handleMovieChoice(sock, chatId, m, num) {
    const data = searches.get(chatId);
    if (!data || !data.results[num - 1]) {
        await sock.sendMessage(chatId, { text: '❌ Invalid choice or search expired.' });
        return;
    }

    const movie = data.results[num - 1];
    await sock.sendMessage(chatId, { text: `🎬 Fetching download links for *${movie.title}* ...` });

    try {
        const { stdout } = await execAsync(`python3 fzmovies.py "${movie.link}"`);
        const links = stdout.trim().split('\n').filter(Boolean);
        if (!links.length) {
            await sock.sendMessage(chatId, { text: '❌ No download links found.' });
            return;
        }

        let msg = `🎬 Download links for *${movie.title}*:\n\n`;
        links.forEach((link, i) => {
            msg += `${i + 1}. ${link}\n`;
        });

        await sock.sendMessage(chatId, { text: msg });
    } catch (err) {
        console.error(err);
        await sock.sendMessage(chatId, { text: '❌ Failed to fetch movie links.' });
    } finally {
        searches.delete(chatId);
    }
}

/* ================= RUN BOT ================= */
start().catch(console.error);
          
