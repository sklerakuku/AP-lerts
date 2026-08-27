require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;
const SP_CARD_ID = process.env.SP_CARD_ID;
const SP_CARD_TOKEN = process.env.SP_CARD_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://4fxk5xm4-3000.euw.devtunnels.ms';

if (!SP_CARD_ID || !SP_CARD_TOKEN) {
    console.error('❌ Нет SP_CARD_ID или SP_CARD_TOKEN в .env');
    process.exit(1);
}

const API_KEY = Buffer.from(`${SP_CARD_ID}:${SP_CARD_TOKEN}`).toString('base64');

console.log('🔐 Card ID:', SP_CARD_ID.substring(0, 8) + '...');
console.log('🔑 API Key:', API_KEY);
console.log('📡 Webhook URL:', PUBLIC_URL + '/webhook');

// Хранилище для игры
const games = new Map(); // gameId -> { word, guessed, attempts, players }

app.use(express.json({ verify: (req, res, buf) => {
    req.rawBody = buf.toString();
}}));

if (!fs.existsSync('public')) fs.mkdirSync('public');
if (fs.existsSync('index.html') && !fs.existsSync('public/index.html')) {
    fs.copyFileSync('index.html', 'public/index.html');
}

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/guess', (req, res) => {
    const word = req.query.w || 'MINECRAFT';
    const duration = parseInt(req.query.d) || 120;  // длительность из параметра d
    const cardNumber = req.query.card || '0000';    // номер карты из параметра card
    const gameId = Date.now().toString();
    
    games.set(gameId, {
        word: word.toUpperCase(),
        guessed: new Set(),
        attempts: [],
        players: new Map()
    });
    
    const html = generateGameHTML(gameId, word.toUpperCase(), duration, cardNumber);
    res.send(html);
});

// API для получения состояния игры
app.get('/api/game/:gameId/state', (req, res) => {
    const game = games.get(req.params.gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    
    res.json({
        word: game.word,
        guessed: Array.from(game.guessed),
        attempts: game.attempts,
        players: Array.from(game.players.entries()).map(([name, data]) => ({
            username: name,
            avatar: data.avatar
        }))
    });
});

function generateGameHTML(gameId, word, duration = 120, cardNumber = '00000') {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title></title>
    <style>
        @font-face {
            font-family: 'Minecraft';
            src: url('minecraft.ttf') format('truetype');
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Minecraft', monospace;
            background: transparent !important;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
        }
        
        .game-wrapper {
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        .title {
            padding-top: 10px;
            color: #FFFFFF;
            font-size: 18px;
            text-shadow: 2px 2px 0 #000;
            text-align: center;
        }
        
        .prize-section {
            text-align: center;
            margin-bottom: 10px;
            width: 100%;
            min-width: 400px;
        }
        
        .prize-label {
            color: #55ff55;
            font-size: 18px;
            text-shadow: 2px 2px 0 #000;
            margin-bottom: 5px;
        }
        
        .progress-bar-container {
            margin-bottom: 0px;
        }
        
        .progress-bg {
            width: 100%;
            height: 10px;
            background: url('https://minecraft.wiki/images/Villager_experience_bar_background.png?cfffa') repeat-x;
            image-rendering: pixelated;
            border-radius: 4px;
            overflow: hidden;
        }
        
        .progress-fill {
            height: 100%;
            background: url('https://minecraft.wiki/images/Green_progress.png?57252') repeat-x;
            image-rendering: pixelated;
            transition: width 0.3s ease;
            width: 0%;
        }
        
        .game-container {
            background: rgba(0, 0, 0, 0.75);
            border: 4px solid #DBDBDB;
            padding: 20px 40px 20px 40px;
            border-radius: 4px;
            min-width: 400px;
        }
        
        .word-display {
            display: flex;
            justify-content: center;
            gap: 8px;
            flex-wrap: wrap;
            margin: 15px 0;
        }
        
        .letter-slot {
            width: 64px;
            height: 64px;
            background: url('https://minecraft.wiki/images/GUI_slot.png?7d6a1') center/cover;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 32px;
            font-weight: bold;
            color: #fff;
            text-shadow: 2px 2px 0 #000;
        }
        
        .letter-slot.revealed {
            background: url('https://minecraft.wiki/images/Task_frame_obtained.png?e756f') center/cover;
        }
        
        .letter-slot.locked {
            background: url('https://minecraft.wiki/images/Task_frame_unobtained.png?f78f3') center/cover;
        }
        
        .attempts-list {
            margin: 10px 0 5px;
            padding: 5px;
            max-height: 150px;
            overflow-y: auto;
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            justify-content: center;
        }
        
        .attempt-item {
            display: inline-block;
            padding: 4px 10px;
            background: rgba(0,0,0,0.6);
            border: 2px solid #5a5a5a;
            max-width: 240px;
            font-size: 14px;
            color: #FFFFFF;
            word-break: normal;
            text-shadow: 1px 1px 0 #000;
        }
        
        .attempt-item.correct {
            border-color: #55ff55;
            color: #FFFFFF;
        }
        
        .attempt-item.wrong {
            border-color: #ff5555;
            color: #FFFFFF;
            text-decoration: line-through;
        }
        
        .timer-section {
            margin-top: 15px;
            width: 100%;
            min-width: 400px;
        }
        
        .timer-bar-bg {
            width: 100%;
            height: 12px;
            background: url('https://minecraft.wiki/images/White_background.png?88672') repeat-x;
            image-rendering: pixelated;
            border-radius: 2px;
            overflow: hidden;
            margin-bottom: 8px;
        }
        
        .timer-bar-fill {
            height: 100%;
            background: url('https://minecraft.wiki/images/White_progress.png?db609') repeat-x;
            image-rendering: pixelated;
            transition: width 0.3s linear;
            width: 100%;
        }
        
        .timer-text {
            font-size: 18px;
            color: white;
            text-shadow: 2px 2px 0 #000;
            text-align: center;
        }
        
        .players-container {
            position: fixed;
            right: 20px;
            top: 20px;
            display: flex;
            flex-direction: column-reverse;
            gap: 8px;
            max-height: 80vh;
            overflow-y: auto;
            pointer-events: none;
        }
        
        .player-wrapper {
            width: 64px;
            height: 64px;
            background-size: cover;
            image-rendering: pixelated;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            animation: slideIn 0.3s ease-out;
        }
        
        .player-avatar {
            width: 40px;
            height: 40px;
            image-rendering: pixelated;
            border: none;
            border-radius: 2px;
        }
        
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateX(50px);
            }
            to {
                opacity: 1;
                transform: translateX(0);
            }
        }
        
        .victory-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.95);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            animation: fadeIn 0.5s;
        }
        
        .victory-content {
            text-align: center;
            background: rgba(20, 20, 30, 0.95);
            border: 4px solid #DBDBDB;
            padding: 30px 50px;
            border-radius: 8px;
            min-width: 400px;
        }
        
        .victory-icon {
            margin: 15px 0;
        }
        
        .victory-icon img {
            width: 256px;
            height: auto;
            image-rendering: pixelated;
        }
        
        .victory-content h2 {
            font-size: 24px;
            color: #FFFFFF;
            margin-bottom: 10px;
            text-shadow: 3px 3px 0 #000;
        }
        
        .victory-content p {
            font-size: 16px;
            margin: 8px 0;
            color: #FFFFFF;
            text-shadow: 2px 2px 0 #000;
        }
        
        .victory-content .prize {
            font-size: 22px;
            color: #55ff55;
            margin: 15px 0;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        .attempts-list::-webkit-scrollbar {
            width: 8px;
        }
        .attempts-list::-webkit-scrollbar-track {
            background: #2a2a2a;
        }
        .attempts-list::-webkit-scrollbar-thumb {
            background: #ffaa00;
        }
        
        .attempt-item .correct {
            color: #55ff55;
        }
        
        .attempt-item .wrong {
            color: #ff5555;
            text-decoration: line-through;
        }
    </style>
</head>
<body>
    <!-- Звуки -->
    <audio id="sound-donate" preload="auto">
        <source src="https://minecraft.wiki/images/Random_levelup.ogg?3bb41&format=original" type="audio/ogg">
    </audio>
    <audio id="sound-correct" preload="auto">
        <source src="https://minecraft.wiki/images/Challenge_complete.ogg?89047&format=original" type="audio/ogg">
    </audio>
    <audio id="sound-wrong" preload="auto">
        <source src="https://minecraft.wiki/images/In.ogg?25988&format=original" type="audio/ogg">
    </audio>
    <audio id="sound-letter" preload="auto">
        <source src="https://minecraft.wiki/images/Thorns1.ogg" type="audio/ogg">
    </audio>
    <audio id="sound-bubble" preload="auto">
        <source src="https://minecraft.wiki/images/Hud_bubble.wav?138a5&format=original" type="audio/wav">
    </audio>

    <div class="players-container" id="playersContainer"></div>
    
    <div class="game-wrapper">
        <div class="prize-section">
            <div class="prize-label" id="prizeLabel">0 АР</div>
            <div class="progress-bar-container">
                <div class="progress-bg">
                    <div class="progress-fill" id="progressFill"></div>
                </div>
            </div>
        </div>
        
        <div class="game-container">
            <p class="title">УГАДАЙ СЛОВО - КАРТА ${cardNumber}</p>
            <div class="word-display" id="wordDisplay"></div>
            <div class="attempts-list" id="attemptsList"></div>
        </div>
        
        <div class="timer-section">
            <div class="timer-bar-bg">
                <div class="timer-bar-fill" id="timerFill"></div>
            </div>
            <div class="timer-text" id="timerText">00:00</div>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const gameId = '${gameId}';
        const socket = io(window.location.origin);
        let currentWord = '${word}';
        let guessedLetters = new Set();
        let attempts = [];
        let gameActive = true;
        let totalPrize = 0;
        let timeLeft = ${duration};
        let timerInterval;
        let initialTime = timeLeft;
        let playerGuesses = new Map();
        
        function playSound(elementId) {
            const sound = document.getElementById(elementId);
            if (sound) {
                sound.currentTime = 0;
                sound.play().catch(e => console.log("Звук не воспроизвелся:", e));
            }
        }

        function playRandomThorns() {
            const thornsCount = 4;
            const randomNum = Math.floor(Math.random() * thornsCount) + 1;
            const audio = new Audio(\`https://minecraft.wiki/images/Thorns\${randomNum}.ogg\`);
            audio.play().catch(e => console.log("Звук Thorns не воспроизвелся:", e));
        }

        function playRandomFailed() {
            const failSounds = [
                'https://minecraft.wiki/images/Firework_twinkle_far.ogg',
                'https://minecraft.wiki/images/Sad1.ogg',
                'https://minecraft.wiki/images/Hurt_Old.ogg?16921&format=original'
            ];

            const randomIndex = Math.floor(Math.random() * failSounds.length);
            const randomUrl = failSounds[randomIndex];

            const audio = new Audio(randomUrl);
            audio.play().catch(e => console.log("Звук не воспроизвелся:", e));
        }
        // ---------------------------------------
        
        const RANKS = [
            { threshold: 0, frame: 'https://minecraft.wiki/images/Pattern_selected.png?b00c6' },
            { threshold: 19, frame: 'https://minecraft.wiki/images/Task_frame_unobtained.png?f78f3' },
            { threshold: 25, frame: 'https://minecraft.wiki/images/Goal_frame_unobtained.png?2c592' },
            { threshold: 59, frame: 'https://minecraft.wiki/images/Challenge_frame_unobtained.png?a7cd8' },
            { threshold: 100, frame: 'https://minecraft.wiki/images/Challenge_frame_obtained.png?28243' }
        ];
        
        function getRankFrame(amount) {
            let rank = RANKS[0];
            for (let i = RANKS.length - 1; i >= 0; i--) {
                if (amount >= RANKS[i].threshold) {
                    rank = RANKS[i];
                    break;
                }
            }
            return rank.frame;
        }
        
        function formatTime(seconds) {
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return \`\${mins.toString().padStart(2, '0')}:\${secs.toString().padStart(2, '0')}\`;
        }
        
        function updateTimer() {
            if (!gameActive) return;
            
            const timerText = document.getElementById('timerText');
            const timerFill = document.getElementById('timerFill');
            
            timerText.textContent = formatTime(Math.max(0, timeLeft));
            const percent = Math.max(0, (timeLeft / initialTime) * 100);
            timerFill.style.width = percent + '%';
            
            if (timeLeft <= 0 && gameActive) {
                clearInterval(timerInterval);
                gameActive = false;
                showVictory(null, true);
            }
            timeLeft--;
        }
        
        function startTimer() {
            updateTimer();
            timerInterval = setInterval(updateTimer, 1000);
        }
        
        function updateProgress() {
            const percent = Math.min((totalPrize / 1000) * 100, 100);
            document.getElementById('progressFill').style.width = percent + '%';
            document.getElementById('prizeLabel').textContent = Math.floor(totalPrize) + ' АР';
        }
        
                function updateDisplay() {
            if (!gameActive) return;
            
            const wordDisplay = document.getElementById('wordDisplay');
            wordDisplay.innerHTML = currentWord.split('').map(letter => {
                const isRevealed = guessedLetters.has(letter);
                const className = isRevealed ? 'letter-slot revealed' : 'letter-slot locked';
                return \`<div class="\${className}">\${isRevealed ? letter : '?'}</div>\`;
            }).join('');
            
            // Группируем попытки по игрокам
            const attemptsDiv = document.getElementById('attemptsList');
            let attemptsHtml = '';
            
            // Преобразуем Map в массив и сортируем по времени последней попытки
            const playersArray = Array.from(playerGuesses.entries());
            
            for (const [username, guesses] of playersArray) {
                const correctStr = guesses.correct.length > 0 ? guesses.correct.join(', ') : '';
                const wrongStr = guesses.wrong.length > 0 ? guesses.wrong.join(', ') : '';
                
                let line = '<div class="attempt-item">' + username + ': ';
                
                if (correctStr) {
                    line += '<span class="correct">' + correctStr + '</span>';
                }
                if (correctStr && wrongStr) {
                    line += ' ';
                }
                if (wrongStr) {
                    line += '<span class="wrong">' + wrongStr + '</span>';
                }
                line += '</div>';
                attemptsHtml += line;
            }
            
            attemptsDiv.innerHTML = attemptsHtml || '<div class="attempt-item" style="opacity:0.5;">Ожидаем попытки...</div>';
            
            updateProgress();
        }
        
        function showVictory(winner, isTimeout = false) {
            gameActive = false;
            clearInterval(timerInterval);
            
            const timeoutImages = [
                'https://minecraft.wiki/images/thumb/AMCM_Bee_Flying.gif/120px-AMCM_Bee_Flying.gif?12370',
                'https://minecraft.wiki/images/thumb/Item_Frame_rotation.gif/120px-Item_Frame_rotation.gif?7c822',
                'https://minecraft.wiki/images/thumb/Terminal.gif/120px-Terminal.gif?d58e7',
                'https://minecraft.wiki/images/thumb/Goat_Stare.gif/120px-Goat_Stare.gif?abcf4',
                'https://minecraft.wiki/images/thumb/Makena_places.gif/120px-Makena_places.gif?00f31',
                'https://minecraft.wiki/images/thumb/Winter_is_coming.gif/120px-Winter_is_coming.gif?480eb',
                'https://minecraft.wiki/images/thumb/AMCM_Cow_Walking.gif/120px-AMCM_Cow_Walking.gif?b0412',
                'https://minecraft.wiki/images/Snapshot_realms.png?51f22',
                'https://minecraft.wiki/images/thumb/AMCM_Zombie_Standing_Up.gif/120px-AMCM_Zombie_Standing_Up.gif?2c0b8'
            ];
            
            const victoryImages = [
                'https://minecraft.wiki/images/No_realms.png?4fa0e',
                'https://minecraft.wiki/images/thumb/ParrotDancing.gif/120px-ParrotDancing.gif?4f80f',
                'https://minecraft.wiki/images/thumb/Good_Morning%2C_Yes%21.gif/120px-Good_Morning%2C_Yes%21.gif?47ad1',
                'https://minecraft.wiki/images/thumb/Oh_no_OMG.gif/120px-Oh_no_OMG.gif?b9f3b',
                'https://minecraft.wiki/images/thumb/Silence%2C_Alex.gif/120px-Silence%2C_Alex.gif?13a63',
                'https://minecraft.wiki/images/thumb/Zombie_chases_goat.gif/120px-Zombie_chases_goat.gif?63b79'
            ];

            const randomIndex = Math.floor(Math.random() * (isTimeout ? timeoutImages.length : victoryImages.length));
            const randomImage = isTimeout ? timeoutImages[randomIndex] : victoryImages[randomIndex];

            setTimeout(() => {
                const victoryDiv = document.createElement('div');
                victoryDiv.className = 'victory-overlay';
                
                if (isTimeout) {
                    playRandomFailed()
                    victoryDiv.innerHTML = \`
                        <div class="victory-content">
                            <h2>ВРЕМЯ ВЫШЛО</h2>
                            <div class="victory-icon">
                                <img src="\${randomImage}" alt="Время вышло"> 
                                
                            </div>
                            <p>Слово: \${currentWord}</p>
                            <p class="prize">\${Math.floor(totalPrize)} АР</p>
                        </div>
                    \`;
                } else {
                    playSound('sound-correct');
                    victoryDiv.innerHTML = \`
                        <div class="victory-content">
                            <h2>ПОБЕДА!</h2>
                            <div class="victory-icon">
                                <img src="\${randomImage}" alt="Победа">
                            </div>
                            <p>\${winner.username} отгадал слово</p>
                            <p>Слово: \${currentWord}</p>
                            <p class="prize">\${Math.floor(totalPrize)} АР</p>
                        </div>
                    \`;
                }
                document.body.appendChild(victoryDiv);
            }, 500);
        }
        
        async function getAvatarUrl(username) {
            // Пробуем получить через SPWorlds API
            const spWorldsUrl = 'https://mc-heads.net/head/' + username + '/40/left';
            
            // Проверяем, загружается ли аватар
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve(spWorldsUrl);
                img.onerror = () => {
                    // Fallback на стандартный скин Minecraft
                    resolve('https://avatars.spworlds.ru/face/' + username + '?w=40');
                };
                img.src = spWorldsUrl;
                setTimeout(() => {
                    resolve('https://minotar.net/helm/steve/40.png');
                }, 2000);
            });
        }
        
        let playerTotals = new Map();
        
        async function addPlayer(username, donationAmount) {
            const container = document.getElementById('playersContainer');
            let existing = document.querySelector(\`.player-wrapper[data-user="\${username}"]\`);
            
            const currentTotal = playerTotals.get(username) || 0;
            const newTotal = currentTotal + donationAmount;
            playerTotals.set(username, newTotal);
            
            const rankFrame = getRankFrame(newTotal);
            const avatarUrl = await getAvatarUrl(username);
            
            if (existing) {
                existing.style.background = \`url('\${rankFrame}')\`;
                existing.style.backgroundSize = 'cover';
                existing.title = \`\${username} | Всего: \${Math.floor(newTotal)} АР\`;
                return;
            }
            
            const wrapper = document.createElement('div');
            wrapper.className = 'player-wrapper';
            wrapper.setAttribute('data-user', username);
            wrapper.style.background = \`url('\${rankFrame}')\`;
            wrapper.style.backgroundSize = 'cover';
            wrapper.title = \`\${username} | Всего: \${Math.floor(newTotal)} АР\`;
            
            const avatarImg = document.createElement('img');
            avatarImg.className = 'player-avatar';
            avatarImg.src = avatarUrl;
            avatarImg.alt = username;
            avatarImg.onerror = () => {
                avatarImg.src = 'https://avatars.spworlds.ru/face/steve?w=40';
            };
            
            wrapper.appendChild(avatarImg);
            container.appendChild(wrapper);
        }
        
                socket.on('new_donation', async (data) => {
            if (!gameActive) return;
            
            const amount = data.amount || 0;
            totalPrize += amount;
            updateProgress();
            
            playSound('sound-donate');
            
            const text = data.comment || '';
            const guess = text.split(' ')[0].toUpperCase();
            const username = data.username;
            
            await addPlayer(username, amount);
            
            // Инициализируем запись для игрока, если её нет
            if (!playerGuesses.has(username)) {
                playerGuesses.set(username, { correct: [], wrong: [] });
            }
            const playerEntry = playerGuesses.get(username);
            
            const isSingleLetter = guess.length === 1 && /^[A-ZА-ЯЁ]$/i.test(guess);
            
            if (isSingleLetter) {
                if (currentWord.includes(guess)) {
                    // Буква есть в слове
                    if (!guessedLetters.has(guess) && !playerEntry.correct.includes(guess)) {
                        guessedLetters.add(guess);
                        playerEntry.correct.push(guess);
                        playRandomThorns();
                        
                        // Проверка победы
                        const allRevealed = currentWord.split('').every(letter => guessedLetters.has(letter));
                        if (allRevealed && gameActive) {
                            showVictory({ username: username });
                        }
                    } else if (!currentWord.includes(guess)) {
                        // Если буквы нет в слове (дубликат или ошибка)
                        if (!playerEntry.wrong.includes(guess)) {
                            playerEntry.wrong.push(guess);
                            playSound('sound-wrong');
                        }
                    }
                } else {
                    // Буквы нет в слове
                    if (!playerEntry.wrong.includes(guess)) {
                        playerEntry.wrong.push(guess);
                        playSound('sound-wrong');
                    }
                }
                updateDisplay();
            }
            else if (guess.length > 1) {
                // Попытка угадать слово целиком
                if (guess === currentWord) {
                    playerEntry.correct.push(guess);
                    updateDisplay();
                    showVictory({ username: username });
                } else {
                    if (!playerEntry.wrong.includes(guess)) {
                        playerEntry.wrong.push(guess);
                        playSound('sound-bubble');
                    }
                    updateDisplay();
                }
            }
        });
        
        startTimer();
        updateDisplay();
    </script>
</body>
</html>`;
}

app.post('/webhook', (req, res) => {
    const signature = req.headers['x-body-hash'];
    
    if (!signature) {
        console.log('❌ Нет подписи X-Body-Hash');
        return res.status(400).json({ error: 'Missing signature' });
    }
    
    const expectedHash = crypto
        .createHmac('sha256', SP_CARD_TOKEN)
        .update(Buffer.from(req.rawBody, 'utf8'))
        .digest('base64');
    
    if (signature !== expectedHash) {
        console.log('❌ Неверная подпись');
        return res.status(403).json({ error: 'Invalid signature' });
    }
    
    const { amount, type, sender, comment } = req.body;
    
    console.log(`📨 Вебхук: ${type} | ${amount} АР | от ${sender?.username || 'anon'}`);
    
    if (amount > 0) {
        const donationData = {
            amount: amount,
            username: sender?.username || 'Аноним',
            comment: comment || ''
        };
        
        console.log(`🎉 ДОНАТ: ${amount} АР от ${donationData.username}`);
        io.emit('new_donation', donationData);
    }
    
    res.json({ status: 'OK' });
});

app.get('/api/test', (req, res) => {
    const data = {
        amount: parseInt(req.query.amount) || 100,
        username: req.query.username || 'TestPlayer',
        comment: req.query.comment || 'Тест 🎮'
    };
    console.log(`🧪 Тест: ${data.amount} АР от ${data.username}`);
    io.emit('new_donation', data);
    res.json({ ok: true, data });
});

io.on('connection', (socket) => {
    console.log('👤 Клиент подключен');
    socket.on('disconnect', () => console.log('👋 Клиент отключен'));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Сервер: http://localhost:${PORT}`);
    console.log(`🎮 Игра: ${PUBLIC_URL}/guess?w=MINECRAFT`);
    console.log(`🧪 Тест: ${PUBLIC_URL}/api/test?amount=100&username=Steve\n`);
});
