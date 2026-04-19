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

// Генерируем Basic Auth токен: base64("ID:TOKEN")
const BASIC_AUTH_TOKEN = Buffer.from(`${SP_CARD_ID}:${SP_CARD_TOKEN}`).toString('base64');

console.log('🔐 Конфигурация загружена:');
console.log(`   Card ID: ${SP_CARD_ID.substring(0, 8)}...`);
console.log(`   Token: ${SP_CARD_TOKEN.substring(0, 8)}...`);
console.log(`   Basic Auth: ${BASIC_AUTH_TOKEN.substring(0, 20)}...`);

// Для корректного парсинга raw body
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

// Статические файлы
app.use(express.static('public'));

// Главная страница с информацией
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Страница статуса
app.get('/status-page', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'status.html'));
});

// Проверка статуса сервера
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

// Тестовый эндпоинт
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

// Эндпоинт для получения Basic Auth токена (для настройки вебхука)
app.get('/get-auth-token', (req, res) => {
    // Простая защита
    const authKey = req.query.key;
    if (authKey !== 'admin123') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    res.json({
        cardId: SP_CARD_ID,
        basicAuthToken: BASIC_AUTH_TOKEN,
        usage: 'Используйте этот токен в заголовке Authorization: Basic ' + BASIC_AUTH_TOKEN,
        webhookSetupCommand: `curl -X PUT https://spworlds.ru/api/public/card/webhook -H "Authorization: Basic ${BASIC_AUTH_TOKEN}" -H "Content-Type: application/json" -d '{"url": "https://spmtv.onrender.com/webhook"}'`
    });
});

// Обработка вебхука от SPWorlds
app.post('/webhook', (req, res) => {
    const rawBody = req.rawBody;
    const signature = req.headers['x-body-hash'];
    
    console.log(`📨 [${new Date().toISOString()}] Получен вебхук`);
    
    // Проверка наличия подписи
    if (!signature) {
        console.error('❌ Отсутствует заголовок X-Body-Hash');
        return res.status(400).json({ error: 'Missing signature header' });
    }
    
    // Генерируем хеш для проверки (используем SP_CARD_TOKEN как ключ)
    const hash = crypto
        .createHmac('sha256', SP_CARD_TOKEN)
        .update(Buffer.from(rawBody, 'utf8'))
        .digest('base64');
    
    const isValid = signature === hash;
    
    console.log(`🔐 Проверка подписи: ${isValid ? '✅ УСПЕШНО' : '❌ ОШИБКА'}`);
    
    if (!isValid) {
        console.error('❌ Неверная подпись вебхука!');
        return res.status(403).json({ error: 'Invalid signature' });
    }
    
    try {
        const { amount, type, sender, receiver, comment, createdAt, id } = req.body;
        
        console.log(`✅ Транзакция ${id}:`);
        console.log(`   💰 Сумма: ${amount} АР`);
        console.log(`   📝 Тип: ${type}`);
        console.log(`   👤 Отправитель: ${sender?.username || 'Неизвестный'}`);
        console.log(`   👥 Получатель: ${receiver?.username || 'Неизвестный'}`);
        console.log(`   💬 Комментарий: ${comment || 'Нет'}`);
        console.log(`   📅 Дата: ${createdAt}`);
        
        // Формируем данные для отправки в виджет
        const donationData = {
            id: id,
            amount: amount,
            type: type,
            username: sender?.username || "Анонимный даритель",
            senderNumber: sender?.number || null,
            receiver: receiver?.username || null,
            comment: comment || "",
            createdAt: createdAt,
            timestamp: new Date().toISOString()
        };
        
        // Отправляем всем подключенным виджетам
        io.emit('new_donation', donationData);
        
        console.log(`📤 Донат отправлен ${io.engine.clientsCount} подключенным клиентам`);
        
        res.status(200).json({ 
            status: 'OK', 
            message: 'Webhook processed successfully',
            clientsNotified: io.engine.clientsCount
        });
        
    } catch (error) {
        console.error('❌ Ошибка обработки вебхука:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Обработка подключений Socket.io
io.on('connection', (socket) => {
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    
    console.log(`🔌 [${new Date().toISOString()}] Новое подключение:`);
    console.log(`   ID: ${socket.id}`);
    console.log(`   IP: ${clientIp}`);
    console.log(`   Всего подключений: ${io.engine.clientsCount}`);
    
    socket.emit('welcome', {
        message: 'Подключено к серверу донатов SPWorlds',
        server: 'spmtv.onrender.com',
        timestamp: new Date().toISOString()
    });
    
    socket.on('disconnect', (reason) => {
        console.log(`🔌 [${new Date().toISOString()}] Отключение:`);
        console.log(`   ID: ${socket.id}`);
        console.log(`   Причина: ${reason}`);
        console.log(`   Осталось подключений: ${io.engine.clientsCount}`);
    });
    
    socket.on('error', (error) => {
        console.error(`❌ Ошибка сокета ${socket.id}:`, error);
    });
    
    socket.on('ping', () => {
        socket.emit('pong', { timestamp: Date.now() });
    });
});

// Запуск сервера
server.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 ====================================');
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Хостинг: spmtv.onrender.com`);
    console.log(`📡 Webhook URL: https://spmtv.onrender.com/webhook`);
    console.log(`🎮 Виджет: https://spmtv.onrender.com`);
    console.log(`📊 Статус: https://spmtv.onrender.com/status`);
    console.log(`🔑 Card ID: ${SP_CARD_ID.substring(0, 8)}...`);
    console.log(`🔐 Basic Auth Token сгенерирован`);
    console.log('');
    console.log('📋 Команда для настройки вебхука:');
    console.log(`curl -X PUT https://spworlds.ru/api/public/card/webhook \\`);
    console.log(`  -H "Authorization: Basic ${BASIC_AUTH_TOKEN}" \\`);
    console.log(`  -H "Content-Type: application/json" \\`);
    console.log(`  -d '{"url": "https://spmtv.onrender.com/webhook"}'`);
    console.log('🚀 ====================================');
});

// Graceful shutdown для Render
process.on('SIGTERM', () => {
    console.log('📴 Получен SIGTERM, закрываем сервер...');
    server.close(() => {
        console.log('✅ Сервер остановлен');
        process.exit(0);
    });
});