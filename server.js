const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;

// Переменные из окружения Render
const SP_CARD_ID = process.env.SP_CARD_ID;
const SP_CARD_TOKEN = process.env.SP_CARD_TOKEN;

// Проверка наличия переменных при запуске
if (!SP_CARD_ID) {
    console.error('❌ ОШИБКА: Не указан SP_CARD_ID в переменных окружения!');
    process.exit(1);
}

if (!SP_CARD_TOKEN) {
    console.error('❌ ОШИБКА: Не указан SP_CARD_TOKEN в переменных окружения!');
    process.exit(1);
}

// Генерируем ключ для API: base64("ID:TOKEN")
const API_KEY = Buffer.from(`${SP_CARD_ID}:${SP_CARD_TOKEN}`).toString('base64');

console.log('🔐 Конфигурация загружена:');
console.log(`   Card ID: ${SP_CARD_ID.substring(0, 8)}...`);
console.log(`   Token: ${SP_CARD_TOKEN.substring(0, 8)}...`);
console.log(`   API Key: ${API_KEY.substring(0, 20)}...`);

// Для корректного парсинга raw body
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

// Статические файлы
app.use(express.static('public'));

// Главная страница - виджет
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Страница статуса
app.get('/status-page', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'status.html'));
});

// Проверка статуса сервера (API)
app.get('/status', (req, res) => {
    res.json({
        status: 'online',
        timestamp: new Date().toISOString(),
        connections: io.engine.clientsCount,
        uptime: process.uptime(),
        hosting: 'spmtv.onrender.com',
        cardId: SP_CARD_ID.substring(0, 8) + '...'
    });
});

// Проверка баланса карты
app.get('/balance', async (req, res) => {
    try {
        const response = await fetch('https://spworlds.ru/api/public/card', {
            headers: {
                'Authorization': `Bearer ${API_KEY}`
            }
        });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Тестовый эндпоинт для имитации доната
app.post('/test-donation-post', (req, res) => {
    console.log('🧪 Имитация вебхука через POST');
    
    const testData = {
        id: 'test_' + Date.now(),
        amount: req.body.amount || 500,
        type: 'incoming',
        sender: { username: req.body.username || 'TestPlayer' },
        receiver: { username: 'Streamer' },
        comment: req.body.comment || 'Тестовый донат!',
        createdAt: new Date().toISOString()
    };
    
    io.emit('new_donation', {
        username: testData.sender.username,
        amount: testData.amount,
        comment: testData.comment,
        type: testData.type,
        id: testData.id,
        createdAt: testData.createdAt
    });
    
    res.json({ success: true, message: 'Тестовый донат отправлен', data: testData });
});

// GET тестовый донат (простой)
app.get('/test-donation', (req, res) => {
    const testKey = req.query.key;
    if (testKey !== 'test123') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    io.emit('new_donation', {
        username: "Тестовый_Игрок",
        amount: 500,
        comment: "Тестовый донат! Спасибо за стрим! 🎮",
        type: "incoming",
        id: 'test_' + Date.now(),
        createdAt: new Date().toISOString()
    });
    
    res.json({ success: true, message: 'Тестовый донат отправлен' });
});

// Обработка вебхука от SPWorlds
app.post('/webhook', (req, res) => {
    const rawBody = req.rawBody;
    const signature = req.headers['x-body-hash'];
    
    // ВСЕГДА ЛОГИРУЕМ ФАКТ ПОЛУЧЕНИЯ ВЕБХУКА
    console.log(`\n📨📨📨 [${new Date().toISOString()}] ПОЛУЧЕН ВЕБХУК!`);
    console.log(`   Signature header: ${signature ? 'ЕСТЬ' : '❌ ОТСУТСТВУЕТ'}`);
    console.log(`   Body length: ${rawBody?.length || 0} байт`);
    
    // Проверка наличия подписи
    if (!signature) {
        console.error('❌ Отсутствует заголовок X-Body-Hash');
        console.log('   Все заголовки:', JSON.stringify(req.headers, null, 2));
        return res.status(400).json({ error: 'Missing signature header' });
    }
    
    // Генерируем хеш для проверки
    const hash = crypto
        .createHmac('sha256', SP_CARD_TOKEN)
        .update(Buffer.from(rawBody, 'utf8'))
        .digest('base64');
    
    const isValid = signature === hash;
    
    console.log(`🔐 Проверка подписи: ${isValid ? '✅ УСПЕШНО' : '❌ ОШИБКА'}`);
    console.log(`   Ожидалось: ${hash.substring(0, 30)}...`);
    console.log(`   Получено:  ${signature.substring(0, 30)}...`);
    
    if (!isValid) {
        console.error('❌ Неверная подпись вебхука!');
        console.log('   Raw body (первые 200 символов):', rawBody?.substring(0, 200));
        return res.status(403).json({ error: 'Invalid signature' });
    }
    
    try {
        const { amount, type, sender, receiver, comment, createdAt, id } = req.body;
        
        console.log(`\n✅✅✅ ТРАНЗАКЦИЯ ОБРАБОТАНА!`);
        console.log(`   🆔 ID: ${id}`);
        console.log(`   💰 Сумма: ${amount} АР`);
        console.log(`   📝 Тип: ${type}`);
        console.log(`   👤 Отправитель: ${sender?.username || 'Неизвестный'}`);
        console.log(`   👥 Получатель: ${receiver?.username || 'Неизвестный'}`);
        console.log(`   💬 Комментарий: ${comment || 'Нет'}`);
        console.log(`   📅 Дата: ${createdAt}`);
        
        // ВСЕГДА отправляем в виджет (для отладки все типы транзакций)
        const donationData = {
            id: id,
            amount: amount,
            type: type,
            username: sender?.username || receiver?.username || "Система",
            comment: comment || `Транзакция типа: ${type}`,
            createdAt: createdAt,
            timestamp: new Date().toISOString()
        };
        
        io.emit('new_donation', donationData);
        
        console.log(`\n📤 Донат отправлен ${io.engine.clientsCount} подключенным клиентам`);
        
        res.status(200).json({ 
            status: 'OK', 
            message: 'Webhook processed successfully',
            clientsNotified: io.engine.clientsCount
        });
        
    } catch (error) {
        console.error('❌ Ошибка обработки вебхука:', error);
        console.log('   Body:', rawBody);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// Периодическая проверка баланса (на случай если вебхуки не работают)
let lastBalance = null;
let lastBalanceCheck = null;

async function checkBalanceChange() {
    try {
        const response = await fetch('https://spworlds.ru/api/public/card', {
            headers: {
                'Authorization': `Bearer ${API_KEY}`
            }
        });
        const data = await response.json();
        
        if (data.balance !== undefined) {
            const currentBalance = data.balance;
            const currentTime = new Date().toISOString();
            
            if (lastBalance !== null && currentBalance > lastBalance) {
                const diff = currentBalance - lastBalance;
                console.log(`\n💰💰💰 [${currentTime}] БАЛАНС УВЕЛИЧИЛСЯ!`);
                console.log(`   Было: ${lastBalance} АР`);
                console.log(`   Стало: ${currentBalance} АР`);
                console.log(`   Разница: +${diff} АР`);
                
                // Отправляем уведомление о пополнении
                io.emit('new_donation', {
                    username: "Пополнение баланса",
                    amount: diff,
                    comment: `Баланс увеличился на ${diff} АР`,
                    type: "balance_increase",
                    id: 'balance_' + Date.now(),
                    createdAt: currentTime
                });
            } else if (lastBalance !== null && currentBalance < lastBalance) {
                const diff = lastBalance - currentBalance;
                console.log(`\n💸 [${currentTime}] Баланс уменьшился на ${diff} АР`);
            }
            
            lastBalance = currentBalance;
            lastBalanceCheck = currentTime;
        }
    } catch (error) {
        console.error('⚠️ Ошибка проверки баланса:', error.message);
    }
}

// Запускаем проверку баланса каждые 30 секунд
setInterval(checkBalanceChange, 30000);
checkBalanceChange(); // Первая проверка сразу

// Обработка подключений Socket.io
io.on('connection', (socket) => {
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    
    console.log(`\n🔌 [${new Date().toISOString()}] Новое подключение:`);
    console.log(`   ID: ${socket.id}`);
    console.log(`   IP: ${clientIp}`);
    console.log(`   Всего подключений: ${io.engine.clientsCount}`);
    
    // Отправляем приветственное сообщение
    socket.emit('welcome', {
        message: 'Подключено к серверу донатов SPWorlds',
        server: 'spmtv.onrender.com',
        timestamp: new Date().toISOString()
    });
    
    socket.on('disconnect', (reason) => {
        console.log(`\n🔌 [${new Date().toISOString()}] Отключение:`);
        console.log(`   ID: ${socket.id}`);
        console.log(`   Причина: ${reason}`);
        console.log(`   Осталось подключений: ${io.engine.clientsCount}`);
    });
    
    socket.on('error', (error) => {
        console.error(`❌ Ошибка сокета ${socket.id}:`, error);
    });
    
    // Пинг для поддержания соединения на Render
    socket.on('ping', () => {
        socket.emit('pong', { timestamp: Date.now() });
    });
});

// Запуск сервера
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n🚀 ====================================');
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Хостинг: spmtv.onrender.com`);
    console.log(`📡 Webhook URL: https://spmtv.onrender.com/webhook`);
    console.log(`🎮 Виджет: https://spmtv.onrender.com`);
    console.log(`📊 Статус: https://spmtv.onrender.com/status`);
    console.log(`💰 Баланс: https://spmtv.onrender.com/balance`);
    console.log(`🧪 Тест POST: https://spmtv.onrender.com/test-donation-post`);
    console.log(`🔑 Card ID: ${SP_CARD_ID.substring(0, 8)}...`);
    console.log('');
    console.log('📋 Команда для проверки вебхука (имитация):');
    console.log(`curl -X POST https://spmtv.onrender.com/test-donation-post -H "Content-Type: application/json" -d "{\\"amount\\":500,\\"username\\":\\"TestPlayer\\",\\"comment\\":\\"Тест\\"}"`);
    console.log('');
    console.log('📋 Команда для настройки вебхука в SPWorlds:');
    console.log(`curl -X PUT https://spworlds.ru/api/public/card/webhook -H "Authorization: Bearer ${API_KEY}" -H "Content-Type: application/json" -d "{\\"url\\":\\"https://spmtv.onrender.com/webhook\\"}"`);
    console.log('🚀 ====================================\n');
});

// Graceful shutdown для Render
process.on('SIGTERM', () => {
    console.log('📴 Получен SIGTERM, закрываем сервер...');
    server.close(() => {
        console.log('✅ Сервер остановлен');
        process.exit(0);
    });
});